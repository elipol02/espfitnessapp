import { prisma } from './db';

// Types for progressive overload calculations
export interface PerformanceHistory {
  date: Date;
  sets: number;
  reps: number;
  weight: number;
  setsCompleted: number;
  avgReps: number;
}

export interface ExerciseWithPerformance {
  name: string;
  exerciseType: string;
  sets: number;
  reps: number;
  weightValue: number;
  weightType: string;
  restTime: number;
  performed: {
    setsCompleted: number;
    repsPerSet: number[];
    weightUsed: number;
  };
  history: PerformanceHistory[];
  progression?: {
    type: string;
    increment: number;
    frequency: string;
  };
}

export interface AdjustmentSuggestion {
  name: string;
  currentWeight: number;
  currentSets: number;
  currentReps: number;
  nextWeight: number;
  nextSets: number;
  nextReps: number;
  reasoning: string;
}

/**
 * Find the next future workout of the same type
 */
export async function findNextWorkout(
  planId: string,
  workoutType: string,
  currentDate: Date
) {
  return await prisma.workoutDay.findFirst({
    where: {
      planId,
      workoutType,
      scheduledDate: { gt: currentDate },
    },
    orderBy: { scheduledDate: 'asc' },
    include: {
      exercises: {
        orderBy: { order: 'asc' },
      },
    },
  });
}

/**
 * Get exercise history for AI analysis (last 6 instances of this exercise in this workout type)
 */
export async function getExerciseHistory(
  exerciseName: string,
  planId: string,
  workoutType: string,
  beforeDate: Date
): Promise<PerformanceHistory[]> {
  // Find all completed workouts of this type before the current one
  const logs = await prisma.workoutLog.findMany({
    where: {
      planId,
      day: { workoutType },
      status: 'completed',
      workoutDate: { lt: beforeDate },
    },
    include: {
      exerciseLogs: {
        where: {
          exercise: {
            name: exerciseName,
          },
        },
        include: {
          exercise: true,
        },
      },
      day: true,
    },
    orderBy: { workoutDate: 'desc' },
    take: 6,
  });

  return logs
    .filter((log) => log.exerciseLogs.length > 0)
    .map((log) => {
      const exerciseLog = log.exerciseLogs[0];
      const repsPerSet = exerciseLog.repsPerSet as number[];
      const avgReps =
        repsPerSet.length > 0
          ? repsPerSet.reduce((a, b) => a + b, 0) / repsPerSet.length
          : 0;

      return {
        date: log.workoutDate,
        sets: exerciseLog.exercise.sets,
        reps: exerciseLog.exercise.reps,
        weight: exerciseLog.weightUsed,
        setsCompleted: exerciseLog.setsCompleted,
        avgReps: Math.round(avgReps * 10) / 10,
      };
    });
}

/**
 * Build exercise data with performance for AI analysis
 */
export async function buildExerciseData(
  workoutLogId: string,
  planId: string,
  workoutType: string,
  workoutDate: Date
): Promise<ExerciseWithPerformance[]> {
  // Get the workout log with exercise logs
  const workoutLog = await prisma.workoutLog.findUnique({
    where: { id: workoutLogId },
    include: {
      exerciseLogs: {
        include: {
          exercise: true,
        },
      },
    },
  });

  if (!workoutLog) {
    return [];
  }

  const exercises: ExerciseWithPerformance[] = [];

  for (const exerciseLog of workoutLog.exerciseLogs) {
    const exercise = exerciseLog.exercise;
    const history = await getExerciseHistory(
      exercise.name,
      planId,
      workoutType,
      workoutDate
    );

    const progression = exercise.progression as {
      type: string;
      increment: number;
      frequency: string;
    } | null;

    exercises.push({
      name: exercise.name,
      exerciseType: exercise.exerciseType,
      sets: exercise.sets,
      reps: exercise.reps,
      weightValue: exercise.weightValue,
      weightType: exercise.weightType,
      restTime: exercise.restTime,
      performed: {
        setsCompleted: exerciseLog.setsCompleted,
        repsPerSet: exerciseLog.repsPerSet as number[],
        weightUsed: exerciseLog.weightUsed,
      },
      history,
      progression: progression || undefined,
    });
  }

  return exercises;
}

/**
 * Generate exercises for a workout day from the most recent completed workout of the same type
 */
export async function generateWorkoutExercises(
  workoutDayId: string,
  workoutType: string,
  planId: string,
  suggestions?: AdjustmentSuggestion[]
): Promise<void> {
  // Find the most recent generated workout of the same type to use as template
  const templateDay = await prisma.workoutDay.findFirst({
    where: {
      planId,
      workoutType,
      isGenerated: true,
    },
    include: {
      exercises: {
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { scheduledDate: 'desc' },
  });

  if (!templateDay || templateDay.exercises.length === 0) {
    console.log('No template found for workout type:', workoutType);
    return;
  }

  // Create exercises based on template, with adjustments if provided
  for (const templateExercise of templateDay.exercises) {
    const suggestion = suggestions?.find(
      (s) => s.name.toLowerCase() === templateExercise.name.toLowerCase()
    );

    await prisma.exercise.create({
      data: {
        dayId: workoutDayId,
        name: templateExercise.name,
        sets: suggestion?.nextSets ?? templateExercise.sets,
        reps: suggestion?.nextReps ?? templateExercise.reps,
        weightType: templateExercise.weightType,
        weightValue: suggestion?.nextWeight ?? templateExercise.weightValue,
        restTime: templateExercise.restTime,
        exerciseType: templateExercise.exerciseType,
        progression: templateExercise.progression || undefined,
        movementDetails: templateExercise.movementDetails || undefined,
        order: templateExercise.order,
      },
    });
  }

  // Mark the workout day as generated
  await prisma.workoutDay.update({
    where: { id: workoutDayId },
    data: { isGenerated: true },
  });
}

/**
 * Apply AI suggestions to the next occurrence of a workout
 */
export async function applyAdjustments(
  planId: string,
  workoutType: string,
  currentDate: Date,
  suggestions: AdjustmentSuggestion[]
): Promise<{ success: boolean; nextWorkoutId?: string; error?: string }> {
  // Find the next occurrence of this workout type
  const nextWorkout = await findNextWorkout(planId, workoutType, currentDate);

  if (!nextWorkout) {
    return {
      success: false,
      error: 'No future workout found for this workout type',
    };
  }

  // If the next workout is already generated, update the exercises
  if (nextWorkout.isGenerated && nextWorkout.exercises.length > 0) {
    for (const suggestion of suggestions) {
      const exercise = nextWorkout.exercises.find(
        (e) => e.name.toLowerCase() === suggestion.name.toLowerCase()
      );

      if (exercise) {
        await prisma.exercise.update({
          where: { id: exercise.id },
          data: {
            sets: suggestion.nextSets,
            reps: suggestion.nextReps,
            weightValue: suggestion.nextWeight,
          },
        });
      }
    }
  } else {
    // Generate the workout with the suggestions
    await generateWorkoutExercises(
      nextWorkout.id,
      workoutType,
      planId,
      suggestions
    );
  }

  return {
    success: true,
    nextWorkoutId: nextWorkout.id,
  };
}

/**
 * Check if we need to generate more workouts and do so if needed
 * Ensures at least 2 weeks of generated workouts ahead
 */
export async function ensureWorkoutsGenerated(
  planId: string,
  currentDate: Date
): Promise<void> {
  // Get all workout types from the plan
  const workoutTypes = await prisma.workoutDay.groupBy({
    by: ['workoutType'],
    where: { planId },
  });

  const twoWeeksFromNow = new Date(currentDate);
  twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

  for (const { workoutType } of workoutTypes) {
    if (workoutType === 'Rest') continue;

    // Find ungenerated workouts for this type within the next 2 weeks
    const ungeneratedWorkouts = await prisma.workoutDay.findMany({
      where: {
        planId,
        workoutType,
        isGenerated: false,
        scheduledDate: {
          gt: currentDate,
          lte: twoWeeksFromNow,
        },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    // Generate exercises for each ungenerated workout
    for (const workout of ungeneratedWorkouts) {
      await generateWorkoutExercises(workout.id, workoutType, planId);
    }
  }
}
