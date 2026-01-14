import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { redirect } from 'next/navigation';
import { LiveWorkoutContent } from './LiveWorkoutContent';

async function getWorkoutData(
  userId: string,
  dayId?: string,
  planId?: string,
  logId?: string
) {
  // If resuming an existing workout
  if (logId) {
    const existingLog = await prisma.workoutLog.findUnique({
      where: { id: logId, userId },
      include: {
        day: {
          include: {
            exercises: {
              orderBy: { order: 'asc' },
            },
          },
        },
        exerciseLogs: true,
      },
    });

    if (existingLog) {
      return {
        workoutLog: existingLog,
        workoutDay: existingLog.day,
        exercises: existingLog.day.exercises,
        existingLogs: existingLog.exerciseLogs,
      };
    }
  }

  // Starting a new workout
  if (dayId && planId) {
    const workoutDay = await prisma.workoutDay.findUnique({
      where: { id: dayId },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
        },
        plan: {
          select: { 
            userId: true,
            startDate: true,
          },
        },
      },
    });

    if (!workoutDay) {
      console.error('Workout day not found:', dayId);
      return null;
    }
    
    if (workoutDay.plan.userId !== userId) {
      console.error('Workout day does not belong to user');
      return null;
    }

    // Check if the plan has started
    if (workoutDay.plan.startDate) {
      const startDate = new Date(workoutDay.plan.startDate);
      startDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (today < startDate) {
        console.error('Plan has not started yet:', startDate);
        return null; // Plan hasn't started yet
      }
    }

    // Check if workout has no exercises
    if (!workoutDay.exercises || workoutDay.exercises.length === 0) {
      console.error('Workout day has no exercises:', dayId);
      return null;
    }

    // Create new workout log
    const workoutLog = await prisma.workoutLog.create({
      data: {
        userId,
        planId,
        dayId,
        status: 'in_progress',
        startedAt: new Date(),
        workoutDate: new Date(),
      },
    });

    return {
      workoutLog,
      workoutDay,
      exercises: workoutDay.exercises,
      existingLogs: [],
    };
  }

  return null;
}

export default async function LiveWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ dayId?: string; planId?: string; logId?: string }>;
}) {
  const { session, error } = await validateSession();

  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const params = await searchParams;
  const { dayId, planId, logId } = params;

  // Need either logId or both dayId and planId
  if (!logId && (!dayId || !planId)) {
    redirect('/home');
  }

  const data = await getWorkoutData(session.user.id, dayId, planId, logId);

  if (!data) {
    redirect('/home');
  }

  // Get user's bodyweight for calculations
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { bodyweight: true },
  });

  return (
    <LiveWorkoutContent
      workoutLogId={data.workoutLog.id}
      workoutDay={data.workoutDay}
      exercises={data.exercises}
      existingLogs={data.existingLogs}
      userBodyweight={user?.bodyweight || null}
    />
  );
}
