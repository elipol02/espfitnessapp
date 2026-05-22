import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { HomeContent } from './HomeContent';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { resolveEffectiveWorkoutType } from '@/app/types';

export const dynamic = 'force-dynamic';

const DAY_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

async function getHomeData(userId: string, tzOffsetMinutes: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, bodyweight: true, onboardingCompleted: true, scheduleStartedAt: true },
  });

  const dayAssignments = await prisma.dayAssignment.findMany({
    where: { userId },
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
  });

  const hasSchedule = dayAssignments.length > 0;

  // Get recent sessions for the week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  oneWeekAgo.setHours(0, 0, 0, 0);

  const oneWeekAhead = new Date();
  oneWeekAhead.setDate(oneWeekAhead.getDate() + 7);

  const recentSessions = await prisma.workoutSession.findMany({
    where: {
      userId,
      workoutDate: { gte: oneWeekAgo, lt: oneWeekAhead },
    },
    select: {
      id: true,
      workoutTypeId: true,
      rotationId: true,
      workoutDate: true,
      status: true,
    },
  });

  // Count completed workouts (all-time)
  const completedWorkouts = await prisma.workoutSession.count({
    where: { userId, status: 'completed' },
  });

  // Earliest session date — used to floor the rolling stats / week preview
  const firstSession = await prisma.workoutSession.findFirst({
    where: { userId },
    orderBy: { workoutDate: 'asc' },
    select: { workoutDate: true },
  });

  // Floor for the week preview + stats: when the schedule started (set on creation),
  // falling back to the first session for legacy schedules. Nothing before this shows.
  const floorDate: Date | null = user?.scheduleStartedAt ?? firstSession?.workoutDate ?? null;

  // Build a map of dateStr → Set<workoutTypeId> for completed sessions
  const allCompleted = await prisma.workoutSession.findMany({
    where: { userId, status: 'completed' },
    select: { workoutDate: true, workoutTypeId: true },
  });

  const completedSlotMap = new Map<string, Set<string>>();
  for (const s of allCompleted) {
    const dateStr = s.workoutDate.toISOString().slice(0, 10);
    if (!completedSlotMap.has(dateStr)) completedSlotMap.set(dateStr, new Set());
    completedSlotMap.get(dateStr)!.add(s.workoutTypeId);
  }

  // Group day assignments by dayOfWeek for slot-count lookups.
  // For rotation slots, any of the rotation's workout types counts as completing that slot.
  type SlotDescriptor = { workoutTypeId: string | null; rotationId: string | null; rotationWorkoutTypeIds: string[] };
  const daySlots = new Map<number, SlotDescriptor[]>();
  for (const da of dayAssignments) {
    if (!daySlots.has(da.dayOfWeek)) daySlots.set(da.dayOfWeek, []);
    if (da.workoutTypeId) {
      daySlots.get(da.dayOfWeek)!.push({ workoutTypeId: da.workoutTypeId, rotationId: null, rotationWorkoutTypeIds: [] });
    } else if (da.rotation) {
      const rotIds = da.rotation.entries.map((e) => e.workoutTypeId);
      daySlots.get(da.dayOfWeek)!.push({ workoutTypeId: null, rotationId: da.rotationId, rotationWorkoutTypeIds: rotIds });
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

  // Compute streak live — walk backwards through scheduled workout days only.
  // A day counts only if ALL its slots are completed (all-or-nothing).
  let currentStreak = 0;
  if (hasSchedule) {
    const assignedDaysSet = new Set(dayAssignments.map((d) => d.dayOfWeek));
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

  // Missed + completion rate over a rolling 30-day window, floored at the first session.
  // Missed = a scheduled day with at least one slot lacking a completed session.
  let missedWorkouts = 0;
  let completionRateToDate = 100;
  if (hasSchedule && floorDate) {
    const assignedDaySet = new Set(dayAssignments.map((d) => d.dayOfWeek));
    const offsetMs = tzOffsetMinutes * 60 * 1000;
    const localNow = new Date(Date.now() - offsetMs);
    const todayMs = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
    const yesterday = new Date(todayMs - 24 * 60 * 60 * 1000);
    let windowStart = new Date(todayMs - 29 * 24 * 60 * 60 * 1000);
    const firstDate = new Date(floorDate);
    firstDate.setUTCHours(0, 0, 0, 0);
    if (firstDate > windowStart) windowStart = firstDate;

    let scheduledSoFar = 0;
    const cursor = new Date(windowStart);
    while (cursor <= yesterday) {
      const dow = DAY_MAP[cursor.getUTCDay()];
      const dateStr = cursor.toISOString().slice(0, 10);
      if (assignedDaySet.has(dow)) {
        scheduledSoFar++;
        if (isDayMissed(dateStr, dow)) missedWorkouts++;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    completionRateToDate = scheduledSoFar > 0
      ? Math.round(((scheduledSoFar - missedWorkouts) / scheduledSoFar) * 100)
      : 100;
  }

  return {
    user,
    currentStreak,
    schedule: hasSchedule
      ? {
          dayAssignments: dayAssignments.map((da) => {
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
    scheduleStartDate: floorDate?.toISOString() ?? null,
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
