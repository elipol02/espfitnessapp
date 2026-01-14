import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { HomeContent } from './HomeContent';
import { redirect } from 'next/navigation';

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
    select: {
      id: true,
      goal: true,
      status: true,
      startDate: true,
      workoutDays: {
        select: {
          id: true,
          dayNumber: true,
          dayName: true,
          scheduledDate: true,
          workoutType: true,
          workoutColor: true,
          isGenerated: true,
          exercises: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              name: true,
              sets: true,
              reps: true,
              restTime: true,
              exerciseType: true,
            },
          },
        },
        orderBy: { scheduledDate: 'asc' },
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
  const todayWorkout = planHasStarted && activePlan?.workoutDays.find((day) => {
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

  // Generate full 7-day week preview for current week based on scheduledDate
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekPreview = daysOfWeek.map((dayName, index) => {
    // Calculate the date for this day of the week
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(startOfWeek.getDate() + index);
    
    // Find the workout scheduled for this specific date
    const workoutDay = activePlan?.workoutDays.find((d) => {
      if (!d.scheduledDate) return false;
      const scheduledDate = new Date(d.scheduledDate);
      return (
        scheduledDate.getFullYear() === dayDate.getFullYear() &&
        scheduledDate.getMonth() === dayDate.getMonth() &&
        scheduledDate.getDate() === dayDate.getDate()
      );
    });
    
    if (workoutDay) {
      return {
        id: workoutDay.id,
        dayNumber: index,
        dayName: workoutDay.dayName,
        workoutType: workoutDay.workoutType,
        workoutColor: workoutDay.workoutColor,
        exerciseCount: workoutDay.exercises.length,
        isGenerated: workoutDay.isGenerated,
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
      };
    }
  });

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
      exercises: todayWorkout.exercises.map((e) => ({
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
