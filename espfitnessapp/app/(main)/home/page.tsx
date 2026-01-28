import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { getUTCDateString } from '@/app/lib/utils';
import { HomeContent } from './HomeContent';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function getHomeData(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
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

  // Get current, previous, and next workout days - only if plan has started
  // This allows the frontend to decide which one is "today" based on local time
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const currentWorkout = planHasStarted && activePlan?.workoutDays.find((day: any) => {
    if (!day.scheduledDate) return false;
    const scheduledDate = new Date(day.scheduledDate);
    return (
      scheduledDate.getFullYear() === today.getFullYear() &&
      scheduledDate.getMonth() === today.getMonth() &&
      scheduledDate.getDate() === today.getDate()
    );
  });

  const previousWorkout = planHasStarted && activePlan?.workoutDays.find((day: any) => {
    if (!day.scheduledDate) return false;
    const scheduledDate = new Date(day.scheduledDate);
    return (
      scheduledDate.getFullYear() === yesterday.getFullYear() &&
      scheduledDate.getMonth() === yesterday.getMonth() &&
      scheduledDate.getDate() === yesterday.getDate()
    );
  });

  const nextWorkout = planHasStarted && activePlan?.workoutDays.find((day: any) => {
    if (!day.scheduledDate) return false;
    const scheduledDate = new Date(day.scheduledDate);
    return (
      scheduledDate.getFullYear() === tomorrow.getFullYear() &&
      scheduledDate.getMonth() === tomorrow.getMonth() &&
      scheduledDate.getDate() === tomorrow.getDate()
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

  // Get workout logs for current, previous, and next days
  const getWorkoutLog = async (workout: any, date: Date) => {
    if (!workout) return null;
    return await prisma.workoutLog.findFirst({
      where: {
        userId,
        dayId: workout.id,
        workoutDate: {
          gte: date,
          lt: new Date(date.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });
  };

  const [currentLog, previousLog, nextLog] = await Promise.all([
    getWorkoutLog(currentWorkout, today),
    getWorkoutLog(previousWorkout, yesterday),
    getWorkoutLog(nextWorkout, tomorrow),
  ]);

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
    const dayDateStr = getUTCDateString(dayDate);
    
    // Find the workout scheduled for this specific date
    const workoutDay = activePlan?.workoutDays.find((d: any) => {
      if (!d.scheduledDate) return false;
      const scheduledDateStr = getUTCDateString(new Date(d.scheduledDate));
      return scheduledDateStr === dayDateStr;
    });
    
    // Find if there's a log for this workout day on this date
    const log = workoutDay ? weekLogs.find((l: { id: string; dayId: string; workoutDate: Date; status: string }) => {
      const logDateStr = getUTCDateString(new Date(l.workoutDate));
      return logDateStr === dayDateStr && l.dayId === workoutDay.id;
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
        const hasCompletedLog = allCompletedLogs.some((log: { dayId: string; workoutDate: Date }) => {
          const logDate = new Date(log.workoutDate);
          // Use UTC date strings to avoid timezone issues
          return log.dayId === workoutDay.id && 
                 getUTCDateString(logDate) === getUTCDateString(scheduledDate);
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

  const formatWorkout = (workout: any) => {
    if (!workout) return null;
    return {
      id: workout.id,
      dayName: workout.dayName,
      workoutType: workout.workoutType,
      workoutColor: workout.workoutColor,
      scheduledDate: workout.scheduledDate?.toISOString() || null,
      exercises: workout.exercises.map((e: any) => ({
        id: e.id,
        name: e.name,
        sets: e.sets,
        reps: e.reps,
        restTime: e.restTime,
        exerciseType: e.exerciseType,
      })),
    };
  };

  const formatLog = (log: any) => {
    if (!log) return null;
    return {
      id: log.id,
      status: log.status,
    };
  };

  // Calculate current week
  let currentWeek = 1;
  if (activePlan && planHasStarted && activePlan.startDate) {
    const startDate = new Date(activePlan.startDate);
    startDate.setHours(0, 0, 0, 0);
    const daysPassed = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    currentWeek = Math.floor(daysPassed / 7) + 1;
  }

  return {
    user,
    userStats,
    activePlan: activePlan ? {
      id: activePlan.id,
      goal: activePlan.goal,
      status: activePlan.status,
      startDate: activePlan.startDate?.toISOString() || null,
      durationWeeks: activePlan.weeksDuration,
    } : null,
    // Send current, previous, and next workouts so frontend can decide based on local time
    currentWorkout: formatWorkout(currentWorkout),
    previousWorkout: formatWorkout(previousWorkout),
    nextWorkout: formatWorkout(nextWorkout),
    currentLog: formatLog(currentLog),
    previousLog: formatLog(previousLog),
    nextLog: formatLog(nextLog),
    weekPreview,
    daysMissed,
    completedWorkouts,
    weeksRemaining,
    currentWeek,
  };
}

export default async function HomePage() {
  const { session, error } = await validateSession();
  
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const data = await getHomeData(session.user.id);

  return <HomeContent data={data} />;
}
