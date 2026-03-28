import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { HomeContent } from './HomeContent';
import { redirect } from 'next/navigation';
import { getMotivationalMessage } from '@/app/lib/motivationalMessages';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

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
        },
        orderBy: { dayOfWeek: 'asc' },
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

  const DAY_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

  // Compute streak live — walk backwards through scheduled workout days only
  let currentStreak = 0;
  if (activePlan) {
    const assignedDaysSet = new Set(activePlan.dayAssignments.map((d) => d.dayOfWeek));
    const allCompleted = await prisma.workoutSession.findMany({
      where: { userId, planId: activePlan.id, status: 'completed' },
      select: { workoutDate: true },
    });
    const completedDates = new Set(allCompleted.map((s) => s.workoutDate.toISOString().slice(0, 10)));
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const cursor = new Date(todayUTC);
    for (let i = 0; i < 365; i++) {
      const dow = DAY_MAP[cursor.getUTCDay()];
      const dateStr = cursor.toISOString().slice(0, 10);
      if (assignedDaysSet.has(dow)) {
        if (completedDates.has(dateStr)) {
          currentStreak++;
        } else if (cursor < todayUTC) {
          break;
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  // Compute missed workouts + completion rate to date (scheduled so far, not total plan)
  let missedWorkouts = 0;
  let completionRateToDate = 0;
  if (activePlan?.startDate && activePlan.dayAssignments.length > 0) {
    const allCompleted = await prisma.workoutSession.findMany({
      where: { userId, planId: activePlan.id, status: 'completed' },
      select: { workoutDate: true },
    });
    const completedDateSet = new Set(allCompleted.map((s) => s.workoutDate.toISOString().slice(0, 10)));
    const assignedDaySet = new Set(activePlan.dayAssignments.map((d) => d.dayOfWeek));
    // Shift "now" by the user's timezone offset so UTC accessors give local date components.
    // getTimezoneOffset() returns minutes-west-of-UTC (positive for US), so we subtract.
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
        if (!completedDateSet.has(dateStr)) missedWorkouts++;
      }
      missedCursor.setUTCDate(missedCursor.getUTCDate() + 1);
    }
    completionRateToDate = scheduledSoFar > 0
      ? Math.round(((scheduledSoFar - missedWorkouts) / scheduledSoFar) * 100)
      : 100;
  }

  // Compute plan completion percentage when both start and end dates exist
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
          dayAssignments: activePlan.dayAssignments.map((da) => ({
            dayOfWeek: da.dayOfWeek,
            workoutType: {
              id: da.workoutType.id,
              name: da.workoutType.name,
              color: da.workoutType.color,
              exerciseCount: da.workoutType.exercises.length,
              exercises: da.workoutType.exercises.map((e) => ({ id: e.id, name: e.name })),
            },
          })),
        }
      : null,
    recentSessions: recentSessions.map((s) => ({
      id: s.id,
      workoutTypeId: s.workoutTypeId,
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
