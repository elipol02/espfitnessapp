import { prisma } from './db';

// Adaptive workout adjustment logic

interface PerformanceData {
  exerciseId: string;
  targetSets: number;
  targetReps: number;
  targetWeight: number;
  actualSets: number;
  actualReps: number[];
  actualWeight: number;
  feedback?: number; // 1-5 rating
}

interface AdjustmentSuggestion {
  exerciseId: string;
  type: 'increase_weight' | 'decrease_weight' | 'increase_reps' | 'decrease_reps' | 'maintain';
  amount: number;
  reason: string;
}

/**
 * Analyze workout performance and suggest adjustments
 */
export function analyzePerformance(data: PerformanceData): AdjustmentSuggestion {
  const { targetSets, targetReps, actualSets, actualReps, feedback } = data;
  
  const avgActualReps = actualReps.length > 0 
    ? actualReps.reduce((a, b) => a + b, 0) / actualReps.length 
    : 0;
  
  const completionRate = actualSets / targetSets;
  const repsCompletionRate = avgActualReps / targetReps;

  // User reported workout was too easy
  if (feedback && feedback >= 4 && completionRate >= 1 && repsCompletionRate >= 1) {
    return {
      exerciseId: data.exerciseId,
      type: 'increase_weight',
      amount: 5,
      reason: 'Completed all sets/reps and workout felt easy',
    };
  }

  // User reported workout was very hard
  if (feedback && feedback <= 2) {
    if (completionRate < 0.7 || repsCompletionRate < 0.7) {
      return {
        exerciseId: data.exerciseId,
        type: 'decrease_weight',
        amount: 5,
        reason: 'Workout was too difficult, reducing weight',
      };
    }
    return {
      exerciseId: data.exerciseId,
      type: 'maintain',
      amount: 0,
      reason: 'Keep current weight until it feels easier',
    };
  }

  // Performance-based adjustments (no explicit feedback)
  // Exceeded targets
  if (completionRate >= 1 && repsCompletionRate >= 1.1) {
    return {
      exerciseId: data.exerciseId,
      type: 'increase_weight',
      amount: 5,
      reason: 'Exceeded rep targets consistently',
    };
  }

  // Completed all sets and reps
  if (completionRate >= 1 && repsCompletionRate >= 1) {
    return {
      exerciseId: data.exerciseId,
      type: 'increase_weight',
      amount: 5,
      reason: 'Successfully completed all prescribed work',
    };
  }

  // Missed significant reps
  if (repsCompletionRate < 0.75) {
    return {
      exerciseId: data.exerciseId,
      type: 'decrease_weight',
      amount: 5,
      reason: 'Missed too many reps, reducing weight',
    };
  }

  // Slightly under target - maintain
  return {
    exerciseId: data.exerciseId,
    type: 'maintain',
    amount: 0,
    reason: 'Performance within acceptable range',
  };
}

/**
 * Apply workout adjustments to plan based on recent performance
 */
export async function applyAdaptiveAdjustments(
  userId: string,
  planId: string
): Promise<AdjustmentSuggestion[]> {
  // Get recent workout logs with exercise data
  const recentLogs = await prisma.workoutLog.findMany({
    where: {
      userId,
      planId,
      status: 'completed',
    },
    orderBy: { completedAt: 'desc' },
    take: 7, // Last week of workouts
    include: {
      exerciseLogs: {
        include: {
          exercise: true,
        },
      },
      day: true,
    },
  });

  if (recentLogs.length === 0) {
    return [];
  }

  const suggestions: AdjustmentSuggestion[] = [];

  // Group exercise logs by exercise
  const exercisePerformance = new Map<string, PerformanceData[]>();

  for (const log of recentLogs) {
    const feedbackRating = (log.feedback as { rating?: number })?.rating;

    for (const exerciseLog of log.exerciseLogs) {
      const weightArr = exerciseLog.weightUsed as number[] | null;
      const actualWeight = Array.isArray(weightArr) && weightArr.length > 0
        ? weightArr.reduce((a, b) => a + b, 0) / weightArr.length
        : 0;

      const data: PerformanceData = {
        exerciseId: exerciseLog.exerciseId,
        targetSets: exerciseLog.exercise.sets,
        targetReps: exerciseLog.exercise.reps,
        targetWeight: exerciseLog.exercise.weightValue,
        actualSets: exerciseLog.setsCompleted,
        actualReps: exerciseLog.repsPerSet as number[],
        actualWeight,
        feedback: feedbackRating,
      };

      const existing = exercisePerformance.get(exerciseLog.exerciseId) || [];
      existing.push(data);
      exercisePerformance.set(exerciseLog.exerciseId, existing);
    }
  }

  // Analyze each exercise's performance over recent workouts
  for (const [_exerciseId, performances] of exercisePerformance) {
    if (performances.length < 2) continue; // Need at least 2 data points

    // Check for consistent trend
    const avgCompletion = performances.reduce((sum, p) => {
      const reps = p.actualReps.length > 0 
        ? p.actualReps.reduce((a, b) => a + b, 0) / p.actualReps.length 
        : 0;
      return sum + (reps / p.targetReps);
    }, 0) / performances.length;

    const latestPerformance = performances[0];
    const suggestion = analyzePerformance(latestPerformance);

    // Only suggest if there's a clear trend
    if (suggestion.type !== 'maintain' && avgCompletion !== 1) {
      suggestions.push(suggestion);
    }
  }

  return suggestions;
}

/**
 * Calculate progress percentage toward goal
 */
export async function calculateGoalProgress(
  userId: string,
  goalDescription: string,
  _exerciseName?: string
): Promise<number> {
  // Try to parse goal for specific lift targets (e.g., "225 bench press")
  const targetMatch = goalDescription.match(/(\d+)\s*(lb|lbs|pound|pounds)?\s*(bench|squat|deadlift|press)/i);
  
  if (!targetMatch) {
    // Generic progress based on workout completion
    const totalWorkouts = await prisma.workoutLog.count({
      where: { userId, status: 'completed' },
    });
    
    // Assume 48 workouts (12 weeks × 4 sessions) = 100%
    return Math.min(100, (totalWorkouts / 48) * 100);
  }

  const targetWeight = parseInt(targetMatch[1]);
  const exerciseType = targetMatch[3].toLowerCase();

  // Find the exercise and get best performance
  const bestLog = await prisma.exerciseLog.findFirst({
    where: {
      exercise: {
        name: {
          contains: exerciseType,
          mode: 'insensitive',
        },
      },
      log: { userId },
    },
    orderBy: { weightUsed: 'desc' },
  });

  if (!bestLog) {
    return 0;
  }

  // Calculate progress percentage (weightUsed is JSON array of weights per set)
  const weightArr = bestLog.weightUsed as number[] | null;
  const bestWeight = Array.isArray(weightArr) && weightArr.length > 0
    ? Math.max(...weightArr)
    : 0;
  const progress = (bestWeight / targetWeight) * 100;
  return Math.min(100, progress);
}

/**
 * Update user's progress percentage in stats
 */
export async function updateProgressPercentage(userId: string): Promise<void> {
  const activePlan = await prisma.workoutPlan.findFirst({
    where: { userId, status: 'active' },
  });

  if (!activePlan) return;

  const progress = await calculateGoalProgress(userId, activePlan.goal);

  await prisma.userStats.update({
    where: { userId },
    data: { progressPercentage: progress },
  });
}
