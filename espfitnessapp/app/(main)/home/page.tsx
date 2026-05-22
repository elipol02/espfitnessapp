import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { HomeContent } from './HomeContent';
import { redirect } from 'next/navigation';
import { getMotivationalMessage } from '@/app/lib/motivationalMessages';
import { cookies } from 'next/headers';
import { resolveEffectiveWorkoutType } from '@/app/types';

export const dynamic = 'force-dynamic';

const DAY_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

async function getHomeData(userId: string, tzOffsetMinutes: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, bodyweight: true, onboardingCompleted: true },
  });

  const activePlan = await prisma.workoutPlan.findFirst({
    where: { userId, status: 'active' },
    include: {
      dayAssignments: {
        include: {
          workoutType: {
            include: {
              exercises: { orderBy: { order: 'asc' } },
            },
          },
          rotation: {
            include: {
              entries: {
                orderBy: { order: 'asc' },
                include: {
                  workoutType: {
                    include: {
                      exercises: { orderBy: { order: 'asc' } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { order: 'asc' }],
      },
    },
  });

  // Get recent sessions for the week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  oneWeekAgo.setHours(0, 0, 0, 0);

  const oneWeekAhead = new Date();
  oneWeekAhead.setDate(oneWeekAhead.getDate() + 7);

  const recentSessions = activePlan
    ? await prisma.workoutSession.findMany({
        where: {
          userId,
          planId: activePlan.id,
          workoutDate: { gte: oneWeekAgo, lt: oneWeekAhead },
        },
        select: {
          id: true,
          workoutTypeId: true,
          rotationId: true,
          workoutDate: true,
          status: true,
        },
      })
    : [];

  // Count completed workouts for this plan
  const completedWorkouts = activePlan
    ? await prisma.workoutSession.count({
        where: { userId, planId: activePlan.id, status: 'completed' },
      })
    : 0;

  // Build a map of dateStr → Set<workoutTypeId> for completed sessions
  const allCompleted = activePlan
    ? await prisma.workoutSession.findMany({
        where: { userId, planId: activePlan.id, status: 'completed' },
        select: { workoutDate: true, workoutTypeId: true },
      })
    : [];

  // Map: dateStr → Set of completed workoutTypeIds that day
  const completedSlotMap = new Map<string, Set<string>>();
  for (const s of allCompleted) {
    const dateStr = s.workoutDate.toISOString().slice(0, 10);
    if (!completedSlotMap.has(dateStr)) completedSlotMap.set(dateStr, new Set());
    completedSlotMap.get(dateStr)!.add(s.workoutTypeId);
  }

  // Group day assignments by dayOfWeek for slot-count lookups
  // daySlots: dayOfWeek → array of resolved workoutTypeIds (one per slot)
  // For rotation slots, we need ALL workoutTypeIds in the rotation (any one counts as completing that slot)
  type SlotDescriptor = { workoutTypeId: string | null; rotationId: string | null; rotationWorkoutTypeIds: string[] };
  const daySlots = new Map<number, SlotDescriptor[]>();
  if (activePlan) {
    for (const da of activePlan.dayAssignments) {
      if (!daySlots.has(da.dayOfWeek)) daySlots.set(da.dayOfWeek, []);
      if (da.workoutTypeId) {
        daySlots.get(da.dayOfWeek)!.push({ workoutTypeId: da.workoutTypeId, rotationId: null, rotationWorkoutTypeIds: [] });
      } else if (da.rotation) {
        const rotIds = da.rotation.entries.map((e) => e.workoutTypeId);
        daySlots.get(da.dayOfWeek)!.push({ workoutTypeId: null, rotationId: da.rotationId, rotationWorkoutTypeIds: rotIds });
      }
    }
  }

  /** Check if ALL slots for a given day are completed */
  function isDayFullyCompleted(dateStr: string, dow: number): boolean {
    const slots = daySlots.get(dow);
    if (!slots || slots.length === 0) return false;
    const completedIds = completedSlotMap.get(dateStr);
    if (!completedIds) return false;
    return slots.every((slot) => {
      if (slot.workoutTypeId) return completedIds.has(slot.workoutTypeId);
      // rotation slot: any of the rotation's workout types counts
      return slot.rotationWorkoutTypeIds.some((id) => completedIds.has(id));
    });
  }

  /** Check if ANY slot for a given day is missing a completed session (missed) */
  function isDayMissed(dateStr: string, dow: number): boolean {
    const slots = daySlots.get(dow);
    if (!slots || slots.length === 0) return false;
    const completedIds = completedSlotMap.get(dateStr);
    return slots.some((slot) => {
      if (slot.workoutTypeId) return !completedIds?.has(slot.workoutTypeId);
      return !slot.rotationWorkoutTypeIds.some((id) => completedIds?.has(id));
    });
  }

  // Compute streak live — walk backwards through scheduled workout days only
  // A day counts toward the streak only if ALL slots are completed (all-or-nothing)
  let currentStreak = 0;
  if (activePlan) {
    const assignedDaysSet = new Set(activePlan.dayAssignments.map((d) => d.dayOfWeek));
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const cursor = new Date(todayUTC);
    for (let i = 0; i < 365; i++) {
      const dow = DAY_MAP[cursor.getUTCDay()];
      const dateStr = cursor.toISOString().slice(0, 10);
      if (assignedDaysSet.has(dow)) {
        if (isDayFullyCompleted(dateStr, dow)) {
          currentStreak++;
        } else if (cursor < todayUTC) {
          break;
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  // Compute missed workouts + completion rate to date
  // Missed = days where at least one slot has no completed session
  let missedWorkouts = 0;
  let completionRateToDate = 0;
  if (activePlan?.startDate && activePlan.dayAssignments.length > 0) {
    const assignedDaySet = new Set(activePlan.dayAssignments.map((d) => d.dayOfWeek));
    const offsetMs = tzOffsetMinutes * 60 * 1000;
    const localNow = new Date(Date.now() - offsetMs);
    const localYesterday = new Date(Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate() - 1,
    ));
    const planStart = new Date(activePlan.startDate);
    planStart.setUTCHours(0, 0, 0, 0);
    let scheduledSoFar = 0;
    const missedCursor = new Date(planStart);
    while (missedCursor <= localYesterday) {
      const dow = DAY_MAP[missedCursor.getUTCDay()];
      const dateStr = missedCursor.toISOString().slice(0, 10);
      if (assignedDaySet.has(dow)) {
        scheduledSoFar++;
        if (isDayMissed(dateStr, dow)) missedWorkouts++;
      }
      missedCursor.setUTCDate(missedCursor.getUTCDate() + 1);
    }
    completionRateToDate = scheduledSoFar > 0
      ? Math.round(((scheduledSoFar - missedWorkouts) / scheduledSoFar) * 100)
      : 100;
  }

  // Compute plan completion percentage
  let planCompletionPercentage: number | null = null;
  if (activePlan?.startDate && activePlan?.endDate && activePlan.dayAssignments.length > 0) {
    const assignedDays = new Set(activePlan.dayAssignments.map((d) => d.dayOfWeek));
    let totalScheduled = 0;
    const cursor = new Date(activePlan.startDate);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(activePlan.endDate);
    end.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      if (assignedDays.has(DAY_MAP[cursor.getDay()])) totalScheduled++;
      cursor.setDate(cursor.getDate() + 1);
    }
    planCompletionPercentage = totalScheduled > 0
      ? Math.min(100, Math.round((completedWorkouts / totalScheduled) * 100))
      : 0;
  }

  return {
    user,
    currentStreak,
    activePlan: activePlan
      ? {
          id: activePlan.id,
          name: activePlan.name,
          status: activePlan.status,
          startDate: activePlan.startDate?.toISOString() || null,
          endDate: activePlan.endDate?.toISOString() || null,
          planCompletionPercentage,
          dayAssignments: activePlan.dayAssignments.map((da) => {
            const effective = resolveEffectiveWorkoutType(da);
            return {
              id: da.id,
              dayOfWeek: da.dayOfWeek,
              order: da.order,
              rotationId: da.rotationId,
              rotationName: da.rotation?.name ?? null,
              rotationSize: da.rotation?.entries.length ?? 0,
              rotationSlotIndex: da.rotation ? da.rotation.currentIndex % da.rotation.entries.length : 0,
              workoutType: effective
                ? {
                    id: effective.id,
                    name: effective.name,
                    color: effective.color,
                    exerciseCount: effective.exerciseCount,
                    exercises: effective.exercises,
                  }
                : null,
            };
          }),
        }
      : null,
    recentSessions: recentSessions.map((s) => ({
      id: s.id,
      workoutTypeId: s.workoutTypeId,
      rotationId: s.rotationId,
      workoutDate: s.workoutDate.toISOString(),
      status: s.status,
    })),
    completedWorkouts,
    missedWorkouts,
    completionRateToDate,
    motivationalMessage: (() => {
      if (!activePlan?.startDate || !activePlan?.endDate) return null;
      const start = new Date(activePlan.startDate).getTime();
      const end = new Date(activePlan.endDate).getTime();
      const now = Date.now();
      const progressPct = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
      return getMotivationalMessage(progressPct, completionRateToDate);
    })(),
  };
}

export default async function HomePage() {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const cookieStore = await cookies();
  const rawOffset = cookieStore.get('tz-offset')?.value;
  const tzOffset = rawOffset !== undefined ? parseInt(rawOffset, 10) : 0;
  const data = await getHomeData(session.user.id, isNaN(tzOffset) ? 0 : tzOffset);
  return <HomeContent data={data} />;
}
