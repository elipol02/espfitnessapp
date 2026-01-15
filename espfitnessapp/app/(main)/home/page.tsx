import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { HomeContent } from './HomeContent';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function getHomeData(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Get user's active plan with today's workout
  const activePlan = await prisma.workoutPlan.findFirst({
    where: {
      userId,
      status: 'active',
    },
    include: {
      workoutDays: {
        include: {
          exercises: {
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { dayNumber: 'asc' },
      },
    },
  });

  // Check if plan has started
  let planHasStarted = true;
  if (activePlan?.startDate) {
    const startDate = new Date(activePlan.startDate);
    startDate.setHours(0, 0, 0, 0);
    planHasStarted = startDate <= today;
  }

  // Get today's workout day by matching scheduledDate - only if plan has started
  const todayWorkout = planHasStarted && activePlan?.workoutDays.find((day: any) => {
    if (!day.scheduledDate) return false;
    const scheduledDate = new Date(day.scheduledDate);
    return (
      scheduledDate.getFullYear() === today.getFullYear() &&
      scheduledDate.getMonth() === today.getMonth() &&
      scheduledDate.getDate() === today.getDate()
    );
  });

  // Get user stats
  const userStats = await prisma.userStats.findUnique({
    where: { userId },
  });

  // Get user profile
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      bodyweight: true,
      onboardingCompleted: true,
    },
  });

  // Get today's workout log if exists (must match today's workout)
  const todayLog = todayWorkout ? await prisma.workoutLog.findFirst({
    where: {
      userId,
      dayId: todayWorkout.id,
      workoutDate: {
        gte: today,
        lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    },
  }) : null;

  // Get workout logs for the current week
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  
  const weekLogs = activePlan ? await prisma.workoutLog.findMany({
    where: {
      userId,
      planId: activePlan.id,
      workoutDate: {
        gte: startOfWeek,
        lt: endOfWeek,
      },
    },
    select: {
      id: true,
      dayId: true,
      workoutDate: true,
      status: true,
    },
  }) : [];

  // Generate full 7-day week preview for current week based on scheduledDate
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekPreview = daysOfWeek.map((dayName, index) => {
    // Calculate the date for this day of the week
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(startOfWeek.getDate() + index);
    
    // Find the workout scheduled for this specific date
    const workoutDay = activePlan?.workoutDays.find((d: any) => {
      if (!d.scheduledDate) return false;
      const scheduledDate = new Date(d.scheduledDate);
      return (
        scheduledDate.getFullYear() === dayDate.getFullYear() &&
        scheduledDate.getMonth() === dayDate.getMonth() &&
        scheduledDate.getDate() === dayDate.getDate()
      );
    });
    
    // Find if there's a log for this workout day on this date
    const log = workoutDay ? weekLogs.find((l) => {
      const logDate = new Date(l.workoutDate);
      const dateMatches = 
        logDate.getFullYear() === dayDate.getFullYear() &&
        logDate.getMonth() === dayDate.getMonth() &&
        logDate.getDate() === dayDate.getDate();
      return dateMatches && l.dayId === workoutDay.id;
    }) : null;
    
    if (workoutDay) {
      return {
        id: workoutDay.id,
        dayNumber: index,
        dayName: workoutDay.dayName,
        workoutType: workoutDay.workoutType,
        workoutColor: workoutDay.workoutColor,
        exerciseCount: workoutDay.exercises.length,
        isGenerated: (workoutDay as any).isGenerated,
        logId: log?.id || null,
        logStatus: log?.status || null,
        scheduledDate: (workoutDay as any).scheduledDate?.toISOString() || null,
        calculatedDate: dayDate.toISOString(),
      };
    } else {
      return {
        id: null,
        dayNumber: index,
        dayName: dayName,
        workoutType: 'rest',
        workoutColor: '#404040',
        exerciseCount: 0,
        isGenerated: false,
        logId: null,
        logStatus: null,
        scheduledDate: null,
        calculatedDate: dayDate.toISOString(),
      };
    }
  });

  // Calculate missed workout days and completed workouts
  let daysMissed = 0;
  let completedWorkouts = 0;
  if (activePlan && planHasStarted) {
    const startDate = new Date(activePlan.startDate!);
    startDate.setHours(0, 0, 0, 0);

    // Get all completed workout logs for this plan
    const allCompletedLogs = await prisma.workoutLog.findMany({
      where: {
        userId,
        planId: activePlan.id,
        status: 'completed',
      },
      select: {
        dayId: true,
        workoutDate: true,
      },
    });

    // Count total completed workouts
    completedWorkouts = allCompletedLogs.length;

    // Check each scheduled workout day
    for (const workoutDay of activePlan.workoutDays) {
      // Skip if no scheduled date or if it's a rest day
      const dayScheduledDate = (workoutDay as any).scheduledDate;
      if (!dayScheduledDate || workoutDay.workoutType.toLowerCase() === 'rest') {
        continue;
      }

      const scheduledDate = new Date(dayScheduledDate);
      scheduledDate.setHours(0, 0, 0, 0);

      // Only count if the day is in the past (before today) and after plan start
      if (scheduledDate < today && scheduledDate >= startDate) {
        // Check if there's a completed log for this workout day on this date
        const hasCompletedLog = allCompletedLogs.some((log) => {
          const logDate = new Date(log.workoutDate);
          logDate.setHours(0, 0, 0, 0);
          return (
            log.dayId === workoutDay.id &&
            logDate.getFullYear() === scheduledDate.getFullYear() &&
            logDate.getMonth() === scheduledDate.getMonth() &&
            logDate.getDate() === scheduledDate.getDate()
          );
        });

        if (!hasCompletedLog) {
          daysMissed++;
        }
      }
    }
  }

  // Calculate weeks remaining
  let weeksRemaining = 0;
  if (activePlan && planHasStarted && activePlan.startDate) {
    const startDate = new Date(activePlan.startDate);
    startDate.setHours(0, 0, 0, 0);
    
    const daysPassed = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const weeksPassed = Math.floor(daysPassed / 7);
    
    weeksRemaining = Math.max(0, activePlan.weeksDuration - weeksPassed);
  }

  return {
    user,
    userStats,
    activePlan: activePlan ? {
      id: activePlan.id,
      goal: activePlan.goal,
      status: activePlan.status,
      startDate: activePlan.startDate?.toISOString() || null,
    } : null,
    todayWorkout: todayWorkout ? {
      id: todayWorkout.id,
      dayName: todayWorkout.dayName,
      workoutType: todayWorkout.workoutType,
      workoutColor: todayWorkout.workoutColor,
      exercises: todayWorkout.exercises.map((e: any) => ({
        id: e.id,
        name: e.name,
        sets: e.sets,
        reps: e.reps,
        restTime: e.restTime,
        exerciseType: e.exerciseType,
      })),
    } : null,
    todayLog: todayLog ? {
      id: todayLog.id,
      status: todayLog.status,
    } : null,
    weekPreview,
    daysMissed,
    completedWorkouts,
    weeksRemaining,
  };
}

function getDayName(dayNumber: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayNumber];
}

export default async function HomePage() {
  const { session, error } = await validateSession();
  
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const data = await getHomeData(session.user.id);

  return <HomeContent data={data} />;
}
