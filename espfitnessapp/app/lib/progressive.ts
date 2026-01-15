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
    weightsPerSet: number[]; // Array of weights per set
    duration?: number; // Performed duration in seconds
    distance?: number; // Performed distance
  };
  history: PerformanceHistory[];
  progression?: {
    type: string;
    increment: number;
    frequency: string;
  };
  // Prescribed Time-based fields
  duration?: number;
  // Prescribed Distance-based fields
  distance?: number;
  distanceUnit?: string;
  // Interval fields
  intervals?: object;
  // Tempo fields
  tempo?: string;
  // AMRAP/EMOM/Tabata fields
  timeCap?: number;
  movements?: object;
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
 * Converts all percentage-based weights to absolute pounds
 */
export async function buildExerciseData(
  workoutLogId: string,
  planId: string,
  workoutType: string,
  workoutDate: Date,
  userBodyweight?: number
): Promise<ExerciseWithPerformance[]> {
  // Get the workout log with exercise logs (ordered by exercise order)
  const workoutLog = await prisma.workoutLog.findUnique({
    where: { id: workoutLogId },
    include: {
      exerciseLogs: {
        include: {
          exercise: true,
        },
        orderBy: {
          exercise: {
            order: 'asc',
          },
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

    // Convert prescribed weight to absolute pounds
    let prescribedWeightInLbs = exercise.weightValue;
    if (exercise.weightType === 'BW' && userBodyweight) {
      prescribedWeightInLbs = Math.round(exercise.weightValue * userBodyweight);
    } else if (exercise.weightType === '1RM') {
      // For 1RM, we use the actual weight performed as a reasonable estimate
      // since we don't track 1RM separately
      const weightsPerSet = exerciseLog.weightUsed as number[];
      prescribedWeightInLbs = Array.isArray(weightsPerSet) ? Math.max(...weightsPerSet) : (weightsPerSet as unknown as number);
    }

    // Handle weightUsed as array
    const weightsPerSet = exerciseLog.weightUsed as number[];
    const weightsArray = Array.isArray(weightsPerSet) ? weightsPerSet : [weightsPerSet as unknown as number];

    exercises.push({
      name: exercise.name,
      exerciseType: exercise.exerciseType,
      sets: exercise.sets,
      reps: exercise.reps,
      weightValue: prescribedWeightInLbs, // NOW IN ABSOLUTE POUNDS
      weightType: 'ABSOLUTE', // Mark as absolute since we converted it
      restTime: exercise.restTime,
      performed: {
        setsCompleted: exerciseLog.setsCompleted,
        repsPerSet: exerciseLog.repsPerSet as number[],
        weightsPerSet: weightsArray, // Array of weights per set
        // PERFORMED values (not prescribed)
        duration: exerciseLog.duration || undefined,
        distance: exerciseLog.distance || undefined,
      },
      history,
      progression: progression || undefined,
      // PRESCRIBED values
      duration: exercise.duration || undefined,
      distance: exercise.distance || undefined,
      distanceUnit: exercise.distanceUnit || undefined,
      // Interval fields
      intervals: exercise.intervals as object || undefined,
      // Tempo fields
      tempo: exercise.tempo || undefined,
      // AMRAP/EMOM/Tabata fields
      timeCap: exercise.timeCap || undefined,
      movements: exercise.movements as object || undefined,
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
      (s) => s.name.toLowerCase().trim() === templateExercise.name.toLowerCase().trim()
    );

    await prisma.exercise.create({
      data: {
        dayId: workoutDayId,
        name: templateExercise.name,
        sets: suggestion?.nextSets ?? templateExercise.sets,
        setsMin: templateExercise.setsMin || undefined,
        reps: suggestion?.nextReps ?? templateExercise.reps,
        repsMin: templateExercise.repsMin || undefined,
        // If we have a suggestion, use ABSOLUTE weight type since suggestions are in pounds
        // Otherwise, keep the template's weight type
        weightType: suggestion ? 'ABSOLUTE' : templateExercise.weightType,
        weightValue: suggestion?.nextWeight ?? templateExercise.weightValue,
        restTime: templateExercise.restTime,
        exerciseType: templateExercise.exerciseType,
        progression: templateExercise.progression || undefined,
        movementDetails: templateExercise.movementDetails || undefined,
        order: templateExercise.order,
        // Time-based exercise fields
        duration: templateExercise.duration || undefined,
        // Distance-based exercise fields
        distance: templateExercise.distance || undefined,
        distanceUnit: templateExercise.distanceUnit || undefined,
        // Interval exercise fields
        intervals: templateExercise.intervals || undefined,
        // Tempo exercise fields
        tempo: templateExercise.tempo || undefined,
        // AMRAP/EMOM/Tabata fields
        timeCap: templateExercise.timeCap || undefined,
        movements: templateExercise.movements || undefined,
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
 * Apply AI suggestions to ALL future occurrences of a workout type
 */
export async function applyAdjustments(
  planId: string,
  workoutType: string,
  currentDate: Date,
  suggestions: AdjustmentSuggestion[]
): Promise<{ success: boolean; updatedWorkoutIds?: string[]; error?: string }> {
  // Find ALL future occurrences of this workout type
  const futureWorkouts = await prisma.workoutDay.findMany({
    where: {
      planId,
      workoutType,
      scheduledDate: { gt: currentDate },
    },
    include: {
      exercises: {
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { scheduledDate: 'asc' },
  });

  if (futureWorkouts.length === 0) {
    return {
      success: false,
      error: 'No future workouts found for this workout type',
    };
  }

  const updatedWorkoutIds: string[] = [];

  // Update all future workouts with the suggestions
  for (const workout of futureWorkouts) {
    if (workout.isGenerated && workout.exercises.length > 0) {
      console.log(`Updating workout ${workout.id} (scheduled ${workout.scheduledDate?.toISOString()}) with suggestions:`, suggestions);
      
      for (const suggestion of suggestions) {
        const exercise = workout.exercises.find(
          (e) => e.name.toLowerCase().trim() === suggestion.name.toLowerCase().trim()
        );

        if (exercise) {
          console.log(`  - Updating exercise "${exercise.name}": ${exercise.sets}×${exercise.reps} @ ${exercise.weightValue} lbs → ${suggestion.nextSets}×${suggestion.nextReps} @ ${suggestion.nextWeight} lbs`);
          
          await prisma.exercise.update({
            where: { id: exercise.id },
            data: {
              sets: suggestion.nextSets,
              reps: suggestion.nextReps,
              weightValue: suggestion.nextWeight,
              weightType: 'ABSOLUTE', // AI suggestions are always in absolute pounds
            },
          });
        } else {
          console.log(`  - Warning: Exercise "${suggestion.name}" not found in workout. Available exercises:`, workout.exercises.map(e => e.name));
        }
      }
      
      updatedWorkoutIds.push(workout.id);
    } else {
      // Generate the workout with the suggestions
      console.log(`Generating workout ${workout.id} with suggestions`);
      await generateWorkoutExercises(
        workout.id,
        workoutType,
        planId,
        suggestions
      );
      updatedWorkoutIds.push(workout.id);
    }
  }
  
  console.log(`Adjustments applied successfully to ${updatedWorkoutIds.length} future workouts`);

  return {
    success: true,
    updatedWorkoutIds,
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
