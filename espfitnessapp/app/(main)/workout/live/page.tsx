import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { redirect } from 'next/navigation';
import { LiveWorkoutContent } from './LiveWorkoutContent';

async function getWorkoutData(
  userId: string,
  dayId?: string,
  planId?: string,
  logId?: string,
  workoutDate?: string,
  isPreview: boolean = false
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
      // Check if there's a pending adjustment for this workout
      let pendingAdjustment = existingLog.status === 'completed' 
        ? await prisma.pendingAdjustment.findFirst({
            where: {
              workoutLogId: existingLog.id,
              userId,
            },
            select: { 
              id: true,
              suggestions: true,
            },
          })
        : null;

      // If workout is completed but has no pending adjustment, create one now
      if (existingLog.status === 'completed' && !pendingAdjustment && existingLog.exerciseLogs.length > 0) {
        const isNotRestDay = existingLog.day.workoutType !== 'Rest';
        if (isNotRestDay) {
          pendingAdjustment = await prisma.pendingAdjustment.create({
            data: {
              userId,
              planId: existingLog.planId,
              workoutLogId: existingLog.id,
              suggestions: [],
              status: 'pending',
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
            select: {
              id: true,
              suggestions: true,
            },
          });
        }
      }

      // Check if there's a chat message with this adjustment (analysis already done)
      let chatSessionId: string | null = null;
      if (pendingAdjustment?.id) {
        const chatMessage = await prisma.chatMessage.findFirst({
          where: {
            userId,
            metadata: {
              path: ['adjustmentId'],
              equals: pendingAdjustment.id,
            },
          },
          select: {
            sessionId: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });
        chatSessionId = chatMessage?.sessionId || null;
      }

      // Check if analysis has been done (has suggestions)
      const hasAnalysis = pendingAdjustment?.suggestions 
        ? Array.isArray(pendingAdjustment.suggestions) && pendingAdjustment.suggestions.length > 0
        : false;

      return {
        workoutLog: existingLog,
        workoutDay: existingLog.day,
        exercises: existingLog.day.exercises,
        existingLogs: existingLog.exerciseLogs,
        pendingAdjustmentId: pendingAdjustment?.id || null,
        hasAnalysis,
        chatSessionId,
        isPreview: false,
        workoutDate: existingLog.workoutDate,
      };
    }
  }

  // Starting a new workout
  if (dayId && planId) {
    // DATE IS REQUIRED - cannot start a workout without a specific date
    if (!workoutDate) {
      console.error('Date parameter is required to start a workout');
      return null;
    }

    // Parse and validate the date
    const targetDate = new Date(workoutDate);
    if (isNaN(targetDate.getTime())) {
      console.error('Invalid workout date provided:', workoutDate);
      return null;
    }

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

    // Check if the workout is scheduled for a future date
    // Only allow starting workouts for today or past dates (unless in preview mode)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDateOnly = new Date(targetDate);
    targetDateOnly.setHours(0, 0, 0, 0);
    
    // Prevent starting workouts for future dates (unless in preview mode)
    if (!isPreview && targetDateOnly > today) {
      console.error('Cannot start workout for future date:', targetDateOnly);
      return null; // Cannot start future workouts
    }

    // Also check if the workout day itself is scheduled for a future date
    if (!isPreview && workoutDay.scheduledDate) {
      const scheduledDate = new Date(workoutDay.scheduledDate);
      scheduledDate.setHours(0, 0, 0, 0);
      
      if (scheduledDate > today) {
        console.error('Cannot start workout scheduled for future date:', scheduledDate);
        return null; // Cannot start future workouts
      }
    }

    // Check if there's already an in-progress workout for this day and date
    // (targetDateOnly was already set above)
    const nextDay = new Date(targetDateOnly);
    nextDay.setDate(nextDay.getDate() + 1);

    const existingWorkout = await prisma.workoutLog.findFirst({
      where: {
        userId,
        dayId,
        status: 'in_progress',
        workoutDate: {
          gte: targetDateOnly,
          lt: nextDay,
        },
      },
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

    // If there's an existing in-progress workout for this date, resume it
    if (existingWorkout) {
      return {
        workoutLog: existingWorkout,
        workoutDay: existingWorkout.day,
        exercises: existingWorkout.day.exercises,
        existingLogs: existingWorkout.exerciseLogs,
        pendingAdjustmentId: null,
        hasAnalysis: false,
        chatSessionId: null,
        isPreview: false,
        workoutDate: existingWorkout.workoutDate,
      };
    }
    
    // If in preview mode, don't create a workout log
    if (isPreview) {
      return {
        workoutLog: null as any, // Preview mode doesn't need a real log
        workoutDay,
        exercises: workoutDay.exercises,
        existingLogs: [],
        pendingAdjustmentId: null,
        hasAnalysis: false,
        chatSessionId: null,
        isPreview: true,
        workoutDate: workoutDay.scheduledDate || targetDate,
      };
    }
    
    // Create new workout log
    const workoutLog = await prisma.workoutLog.create({
      data: {
        userId,
        planId,
        dayId,
        status: 'in_progress',
        startedAt: new Date(),
        workoutDate: targetDate,
      },
    });

    return {
      workoutLog,
      workoutDay,
      exercises: workoutDay.exercises,
      existingLogs: [],
      pendingAdjustmentId: null,
      hasAnalysis: false,
      chatSessionId: null,
      isPreview: false,
      workoutDate: targetDate,
    };
  }

  return null;
}

export default async function LiveWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ dayId?: string; planId?: string; logId?: string; date?: string; preview?: string }>;
}) {
  const { session, error } = await validateSession();

  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const params = await searchParams;
  const { dayId, planId, logId, date, preview } = params;

  // Need either logId or both dayId and planId
  if (!logId && (!dayId || !planId)) {
    redirect('/home');
  }

  const isPreview = preview === 'true';
  const data = await getWorkoutData(session.user.id, dayId, planId, logId, date, isPreview);

  if (!data) {
    redirect('/home');
  }

  // Get user's bodyweight for calculations
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { bodyweight: true },
  });

  // Normalize Prisma exercises: convert null to undefined and narrow types for LiveWorkoutContent's Exercise
  type PrismaExercise = { id: string; name: string; sets: number; reps: number; weightType: string; weightValue: number; restTime: number; exerciseType: string; duration?: number | null; distance?: number | null; distanceUnit?: string | null; intervals?: unknown; tempo?: string | null; timeCap?: number | null };
  const exercises = data.exercises.map((e: PrismaExercise) => ({
    id: e.id,
    name: e.name,
    sets: e.sets,
    reps: e.reps,
    weightType: e.weightType,
    weightValue: e.weightValue,
    restTime: e.restTime,
    exerciseType: e.exerciseType,
    duration: e.duration ?? undefined,
    distance: e.distance ?? undefined,
    distanceUnit: (e.distanceUnit ?? undefined) as 'feet' | 'yards' | 'meters' | undefined,
    intervals: (e.intervals ?? undefined) as Parameters<typeof LiveWorkoutContent>[0]['exercises'][number]['intervals'],
    tempo: e.tempo ?? undefined,
    timeCap: e.timeCap ?? undefined,
  }));

  return (
    <LiveWorkoutContent
      workoutLogId={data.workoutLog?.id || ''}
      workoutDay={data.workoutDay}
      exercises={exercises}
      existingLogs={data.existingLogs}
      userBodyweight={user?.bodyweight || null}
      workoutStatus={data.workoutLog?.status || 'preview'}
      pendingAdjustmentId={data.pendingAdjustmentId}
      hasAnalysis={data.hasAnalysis}
      chatSessionId={data.chatSessionId}
      isPreview={data.isPreview}
      workoutDate={data.workoutDate}
    />
  );
}
