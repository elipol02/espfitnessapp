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
  progression?: string;
  // Prescribed Time-based fields
  duration?: number;
  // Prescribed Distance-based fields
  distance?: number;
  distanceUnit?: string;
  // Interval fields
  intervals?: {
    type: string;
    rounds: number;
    phases: Array<{
      name: string;
      duration: number;
      intensity?: string;
    }>;
  };
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
  nextRestTime?: number;
  nextProgression?: string; // e.g., "linear +5 lbs weekly", "add 1 rep each session"
  nextDuration?: number;
  nextDistance?: number;
  nextTimeCap?: number;
  nextIntervals?: {
    type: string;
    rounds: number;
    phases: Array<{
      name: string;
      duration: number;
      intensity?: string;
    }>;
  };
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

  type LogRow = { workoutDate: Date; exerciseLogs: Array<{ repsPerSet: unknown; weightUsed: unknown; setsCompleted: number; exercise: { sets: number; reps: number } }> };
  return (logs as LogRow[])
    .filter((log: LogRow) => log.exerciseLogs.length > 0)
    .map((log: LogRow) => {
      const exerciseLog = log.exerciseLogs[0];
      const repsPerSet = exerciseLog.repsPerSet as number[];
      const avgReps =
        repsPerSet.length > 0
          ? repsPerSet.reduce((a, b) => a + b, 0) / repsPerSet.length
          : 0;

      const weightArr = exerciseLog.weightUsed as number[] | null;
      const weight = Array.isArray(weightArr) && weightArr.length > 0
        ? weightArr.reduce((a, b) => a + b, 0) / weightArr.length
        : 0;

      return {
        date: log.workoutDate,
        sets: exerciseLog.exercise.sets,
        reps: exerciseLog.exercise.reps,
        weight,
        setsCompleted: exerciseLog.setsCompleted,
        avgReps: Math.round(avgReps * 10) / 10,
      };
    });
}

/**
 * Build exercise data with performance for AI analysis
 * Converts all percentage-based weights to absolute pounds
 * OPTIMIZED: Batches history queries to avoid N+1
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

  // Get all exercise names for batch query
  const exerciseNames = workoutLog.exerciseLogs.map((log: { exercise: { name: string } }) => log.exercise.name);

  // Fetch ALL history in ONE query (instead of N queries)
  const allLogs = await prisma.workoutLog.findMany({
    where: {
      planId,
      day: { workoutType },
      status: 'completed',
      workoutDate: { lt: workoutDate },
    },
    include: {
      exerciseLogs: {
        where: {
          exercise: {
            name: { in: exerciseNames },
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

  // Build history map: exerciseName -> PerformanceHistory[]
  const historyMap = new Map<string, PerformanceHistory[]>();
  for (const log of allLogs) {
    for (const exerciseLog of log.exerciseLogs) {
      const name = exerciseLog.exercise.name;
      if (!historyMap.has(name)) {
        historyMap.set(name, []);
      }
      
      const repsPerSet = exerciseLog.repsPerSet as number[];
      const avgReps = repsPerSet.length > 0
        ? repsPerSet.reduce((a, b) => a + b, 0) / repsPerSet.length
        : 0;

      historyMap.get(name)!.push({
        date: log.workoutDate,
        sets: exerciseLog.exercise.sets,
        reps: exerciseLog.exercise.reps,
        weight: exerciseLog.weightUsed as number,
        setsCompleted: exerciseLog.setsCompleted,
        avgReps: Math.round(avgReps * 10) / 10,
      });
    }
  }

  // Build exercise data using the history map (no additional queries!)
  const exercises: ExerciseWithPerformance[] = [];
  for (const exerciseLog of workoutLog.exerciseLogs) {
    const exercise = exerciseLog.exercise;
    const history = historyMap.get(exercise.name) || [];

    const progression = exercise.progression as string | null;

    // Convert prescribed weight to absolute pounds
    let prescribedWeightInLbs = exercise.weightValue;
    if (exercise.weightType === 'BW' && userBodyweight) {
      prescribedWeightInLbs = Math.round(exercise.weightValue * userBodyweight);
    } else if (exercise.weightType === '1RM') {
      const weightsPerSet = exerciseLog.weightUsed as number[];
      prescribedWeightInLbs = Array.isArray(weightsPerSet) ? Math.max(...weightsPerSet) : (weightsPerSet as unknown as number);
    }

    const weightsPerSet = exerciseLog.weightUsed as number[];
    const weightsArray = Array.isArray(weightsPerSet) ? weightsPerSet : [weightsPerSet as unknown as number];

    exercises.push({
      name: exercise.name,
      exerciseType: exercise.exerciseType,
      sets: exercise.sets,
      reps: exercise.reps,
      weightValue: prescribedWeightInLbs,
      weightType: 'ABSOLUTE',
      restTime: exercise.restTime,
      performed: {
        setsCompleted: exerciseLog.setsCompleted,
        repsPerSet: exerciseLog.repsPerSet as number[],
        weightsPerSet: weightsArray,
        duration: exerciseLog.duration || undefined,
        distance: exerciseLog.distance || undefined,
      },
      history,
      progression: progression || undefined,
      duration: exercise.duration || undefined,
      distance: exercise.distance || undefined,
      distanceUnit: exercise.distanceUnit || undefined,
      intervals: exercise.intervals ? (exercise.intervals as {
        type: string;
        rounds: number;
        phases: Array<{
          name: string;
          duration: number;
          intensity?: string;
        }>;
      }) : undefined,
      tempo: exercise.tempo || undefined,
      timeCap: exercise.timeCap || undefined,
      movements: exercise.movements as object || undefined,
    });
  }

  return exercises;
}

/**
 * Generate exercises for a workout day from the most recent completed workout of the same type
 * OPTIMIZED: Uses bulk insert instead of individual creates
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

  // Prepare all exercises for bulk insert
  type TemplateEx = { name: string; sets: number; setsMin?: number | null; reps: number; repsMin?: number | null; weightType: string; weightValue: number; restTime: number; exerciseType: string; progression?: unknown; movementDetails?: unknown; order: number; duration?: number | null; distance?: number | null; distanceUnit?: string | null; intervals?: unknown; tempo?: string | null; timeCap?: number | null; movements?: unknown };
  const exercisesToCreate = templateDay.exercises.map((templateExercise: TemplateEx) => {
    const suggestion = suggestions?.find(
      (s) => s.name.toLowerCase().trim() === templateExercise.name.toLowerCase().trim()
    );

    const nextSets = suggestion?.nextSets ?? templateExercise.sets;
    
    // For EMOM exercises, auto-calculate timeCap from sets (rounds)
    let calculatedTimeCap = suggestion?.nextTimeCap ?? (templateExercise.timeCap || undefined);
    if (templateExercise.exerciseType === 'emom' && suggestion) {
      calculatedTimeCap = nextSets * 60; // EMOM: 1 round = 1 minute
    }

    return {
      dayId: workoutDayId,
      name: templateExercise.name,
      sets: nextSets,
      setsMin: templateExercise.setsMin || undefined,
      reps: suggestion?.nextReps ?? templateExercise.reps,
      repsMin: templateExercise.repsMin || undefined,
      weightType: suggestion ? 'ABSOLUTE' : templateExercise.weightType,
      weightValue: suggestion?.nextWeight ?? templateExercise.weightValue,
      restTime: suggestion?.nextRestTime ?? templateExercise.restTime,
      exerciseType: templateExercise.exerciseType,
      progression: suggestion?.nextProgression ?? (templateExercise.progression || undefined),
      movementDetails: templateExercise.movementDetails || undefined,
      order: templateExercise.order,
      duration: suggestion?.nextDuration ?? (templateExercise.duration || undefined),
      distance: suggestion?.nextDistance ?? (templateExercise.distance || undefined),
      distanceUnit: templateExercise.distanceUnit || undefined,
      intervals: suggestion?.nextIntervals ?? (templateExercise.intervals || undefined),
      tempo: templateExercise.tempo || undefined,
      timeCap: calculatedTimeCap,
      movements: templateExercise.movements || undefined,
    };
  });

  // Bulk insert all exercises + update workout in transaction
  await prisma.$transaction([
    prisma.exercise.createMany({ data: exercisesToCreate }),
    prisma.workoutDay.update({
      where: { id: workoutDayId },
      data: { isGenerated: true },
    }),
  ]);
}

/**
 * Apply AI suggestions to ALL future occurrences of a workout type
 * OPTIMIZED: Uses transaction for atomicity and better performance
 */
export async function applyAdjustments(
  planId: string,
  workoutType: string,
  currentDate: Date,
  suggestions: AdjustmentSuggestion[]
): Promise<{ success: boolean; updatedWorkoutIds?: string[]; error?: string }> {
  // Find the FIRST (template) workout of this type - this is the baseline that future generations use
  const templateWorkout = await prisma.workoutDay.findFirst({
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
    orderBy: { scheduledDate: 'asc' }, // Get the FIRST one
  });

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

  console.log(`Found ${futureWorkouts.length} future workouts for type "${workoutType}" after ${currentDate.toISOString()}`);
  futureWorkouts.forEach((w, idx) => {
    console.log(`  [${idx + 1}] ${w.id} - scheduled: ${w.scheduledDate?.toISOString()}, isGenerated: ${w.isGenerated}, exercises: ${w.exercises.length}`);
  });

  if (futureWorkouts.length === 0 && !templateWorkout) {
    return {
      success: false,
      error: 'No future workouts found for this workout type',
    };
  }

  const updatedWorkoutIds: string[] = [];

  // Use transaction for atomicity and better performance
  await prisma.$transaction(async (tx: any) => {
    // Collect all exercises to update for bulk operations
    const exerciseUpdates: Array<{ id: string; suggestion: AdjustmentSuggestion }> = [];
    const workoutsToGenerate: Array<{ id: string }> = [];

    // FIRST: Update the template workout (the baseline for future generations)
    if (templateWorkout && templateWorkout.exercises.length > 0) {
      console.log(`Updating template workout ${templateWorkout.id} (scheduled ${templateWorkout.scheduledDate?.toISOString()})`);
      console.log(`  Available template exercises:`, templateWorkout.exercises.map((e: { name: string }) => e.name));
      console.log(`  Suggestions to apply:`, suggestions.map(s => s.name));
      
      for (const suggestion of suggestions) {
        const exercise = templateWorkout.exercises.find(
          (e: { name: string }) => e.name.toLowerCase().trim() === suggestion.name.toLowerCase().trim()
        );

        if (exercise) {
          console.log(`  - Template: Will update exercise "${exercise.name}": ${exercise.sets}×${exercise.reps} @ ${exercise.weightValue} lbs → ${suggestion.nextSets}×${suggestion.nextReps} @ ${suggestion.nextWeight} lbs`);
          exerciseUpdates.push({ id: exercise.id, suggestion });
        } else {
          console.log(`  - Template: Exercise "${suggestion.name}" NOT FOUND. Available:`, templateWorkout.exercises.map((e: { name: string }) => e.name));
        }
      }
      
      // Only add to updated list if it's a future workout
      if (templateWorkout.scheduledDate && templateWorkout.scheduledDate > currentDate) {
        updatedWorkoutIds.push(templateWorkout.id);
      }
    }

    // SECOND: Update all future workouts
    for (const workout of futureWorkouts) {
      // Skip if this is the template workout (already processed)
      if (templateWorkout && workout.id === templateWorkout.id) {
        continue;
      }

      if (workout.isGenerated && workout.exercises.length > 0) {
        console.log(`Preparing updates for workout ${workout.id} (scheduled ${workout.scheduledDate?.toISOString()})`);
        
        for (const suggestion of suggestions) {
          const exercise = workout.exercises.find(
            (e: { name: string }) => e.name.toLowerCase().trim() === suggestion.name.toLowerCase().trim()
          );

          if (exercise) {
            console.log(`  - Will update exercise "${exercise.name}": ${exercise.sets}×${exercise.reps} @ ${exercise.weightValue} lbs → ${suggestion.nextSets}×${suggestion.nextReps} @ ${suggestion.nextWeight} lbs`);
            exerciseUpdates.push({ id: exercise.id, suggestion });
          } else {
            console.log(`  - Warning: Exercise "${suggestion.name}" not found in workout. Available exercises:`, workout.exercises.map((e: { name: string }) => e.name));
          }
        }
        
        updatedWorkoutIds.push(workout.id);
      } else {
        // Mark for generation
        console.log(`Will generate workout ${workout.id} with suggestions`);
        workoutsToGenerate.push({ id: workout.id });
        updatedWorkoutIds.push(workout.id);
      }
    }

    // Bulk update all exercises using Prisma transaction for efficiency
    if (exerciseUpdates.length > 0) {
      console.log(`Performing bulk update of ${exerciseUpdates.length} exercises in transaction`);
      
      // First, get all exercise types so we can calculate timeCap for EMOM/AMRAP
      const exerciseIds = exerciseUpdates.map(({ id }) => id);
      const exercises = await tx.exercise.findMany({
        where: { id: { in: exerciseIds } },
        select: { id: true, exerciseType: true },
      });
      const exerciseTypeMap = new Map(exercises.map((e: { id: string; exerciseType: string }) => [e.id, e.exerciseType]));
      
      // Create update operations for all exercises
      const updateOperations = exerciseUpdates.map(({ id, suggestion }) => {
        const exerciseType = exerciseTypeMap.get(id) || 'strength';
        
        const updateData: any = {
          sets: suggestion.nextSets,
          reps: suggestion.nextReps,
          weightValue: suggestion.nextWeight,
          weightType: 'ABSOLUTE',
        };
        
        // For EMOM exercises, automatically calculate timeCap from nextSets (rounds)
        // EMOM: 1 round = 1 minute, so timeCap = nextSets * 60 seconds
        if (exerciseType === 'emom') {
          updateData.timeCap = suggestion.nextSets * 60;
          console.log(`  - Auto-calculating timeCap for EMOM "${suggestion.name}": ${suggestion.nextSets} rounds = ${updateData.timeCap} seconds`);
        }
        
        if (suggestion.nextRestTime !== undefined) {
          updateData.restTime = suggestion.nextRestTime;
        }
        if (suggestion.nextProgression !== undefined) {
          updateData.progression = suggestion.nextProgression;
        }
        if (suggestion.nextDuration !== undefined) {
          updateData.duration = suggestion.nextDuration;
        }
        if (suggestion.nextDistance !== undefined) {
          updateData.distance = suggestion.nextDistance;
        }
        if (suggestion.nextTimeCap !== undefined) {
          updateData.timeCap = suggestion.nextTimeCap;
        }
        if (suggestion.nextIntervals !== undefined) {
          updateData.intervals = suggestion.nextIntervals;
        }
        
        return tx.exercise.update({
          where: { id },
          data: updateData,
        });
      });
      
      // Execute all updates in parallel within the transaction
      await Promise.all(updateOperations);
    }

    // Generate workouts that need generation
    for (const workout of workoutsToGenerate) {
      await generateWorkoutExercises(
        workout.id,
        workoutType,
        planId,
        suggestions
      );
    }
  });
  
  console.log(`Adjustments applied successfully to ${updatedWorkoutIds.length} future workouts`);
  if (templateWorkout) {
    console.log(`Template workout updated: ${templateWorkout.id} - this will be the new baseline for future workout generations`);
  }

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
