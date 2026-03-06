import { prisma } from './db';
import type {
  ProgressionRule,
  ProgressionSuggestion,
  SuggestionMap,
  StrengthEntryData,
  DistanceEntryData,
  TimeEntryData,
  StrengthConfig,
  DistanceConfig,
  TimeConfig,
} from '../types';

export async function computeSuggestions(
  workoutTypeId: string,
  userId: string
): Promise<SuggestionMap> {
  const exercises = await prisma.exercise.findMany({
    where: { workoutTypeId },
    orderBy: { order: 'asc' },
  });

  const lastSession = await prisma.workoutSession.findFirst({
    where: { workoutTypeId, userId, status: 'completed' },
    orderBy: { workoutDate: 'desc' },
    include: { entries: true },
  });

  const suggestions: SuggestionMap = {};

  for (const exercise of exercises) {
    const progression = exercise.progression as ProgressionRule | null;
    if (!progression || progression.type === 'none') continue;

    const lastEntry = lastSession?.entries.find(
      (e) => e.exerciseId === exercise.id
    );
    if (!lastEntry) continue;

    const config = exercise.config as Record<string, unknown>;
    const data = lastEntry.data as Record<string, unknown>;

    const suggestion = computeForExercise(
      exercise.exerciseType,
      config,
      data,
      progression
    );
    if (suggestion) {
      suggestions[exercise.id] = { exerciseId: exercise.id, ...suggestion };
    }
  }

  return suggestions;
}

function computeForExercise(
  exerciseType: string,
  config: Record<string, unknown>,
  data: Record<string, unknown>,
  progression: ProgressionRule
): Omit<ProgressionSuggestion, 'exerciseId'> | null {
  switch (exerciseType) {
    case 'strength':
      return computeStrength(
        config as unknown as StrengthConfig,
        data as unknown as StrengthEntryData,
        progression
      );
    case 'distance':
      return computeDistance(
        config as unknown as DistanceConfig,
        data as unknown as DistanceEntryData,
        progression
      );
    case 'time':
      return computeTime(
        config as unknown as TimeConfig,
        data as unknown as TimeEntryData,
        progression
      );
    default:
      return null;
  }
}

function computeStrength(
  config: StrengthConfig,
  data: StrengthEntryData,
  progression: ProgressionRule
): Omit<ProgressionSuggestion, 'exerciseId'> | null {
  if (!data.sets || data.sets.length === 0) return null;

  const lastWeight = data.sets[0].weight;
  const lastReps = Math.min(...data.sets.map((s) => s.reps));
  const unit = config.weightUnit || 'lbs';

  if (progression.type === 'linear') {
    const suggested = lastWeight + progression.incrementValue;
    return {
      lastWeight,
      lastReps,
      suggestedWeight: suggested,
      suggestedReps: lastReps,
      unit,
      display: `Last: ${lastWeight} ${unit} × ${lastReps} → Today: ${suggested} ${unit} × ${lastReps}`,
    };
  }

  if (progression.type === 'double_progression') {
    const allHitMax = data.sets.every((s) => s.reps >= progression.repsMax);
    if (allHitMax) {
      const newWeight = lastWeight + progression.weightIncrement;
      return {
        lastWeight,
        lastReps,
        suggestedWeight: newWeight,
        suggestedReps: progression.repsMin,
        unit,
        display: `Last: ${lastWeight} ${unit} × ${lastReps} → Today: ${newWeight} ${unit} × ${progression.repsMin} (weight up!)`,
      };
    }
    const newReps = Math.min(lastReps + 1, progression.repsMax);
    return {
      lastWeight,
      lastReps,
      suggestedWeight: lastWeight,
      suggestedReps: newReps,
      unit,
      display: `Last: ${lastWeight} ${unit} × ${lastReps} → Today: ${lastWeight} ${unit} × ${newReps}`,
    };
  }

  return null;
}

function computeDistance(
  config: DistanceConfig,
  data: DistanceEntryData,
  progression: ProgressionRule
): Omit<ProgressionSuggestion, 'exerciseId'> | null {
  if (!data.sets || data.sets.length === 0) return null;

  const lastDistance = data.sets[0].distance;
  const unit = config.distanceUnit || 'feet';

  if (progression.type === 'linear') {
    const suggested = lastDistance + progression.incrementValue;
    return {
      lastDistance,
      suggestedDistance: suggested,
      unit,
      display: `Last: ${lastDistance} ${unit} → Today: ${suggested} ${unit}`,
    };
  }

  return null;
}

function computeTime(
  _config: TimeConfig,
  data: TimeEntryData,
  progression: ProgressionRule
): Omit<ProgressionSuggestion, 'exerciseId'> | null {
  if (!data.sets || data.sets.length === 0) return null;

  const lastDuration = data.sets[0].durationSeconds;
  const unit = 'seconds';

  if (progression.type === 'linear') {
    const suggested = lastDuration + progression.incrementValue;
    return {
      lastDuration,
      suggestedDuration: suggested,
      unit,
      display: `Last: ${lastDuration}s → Today: ${suggested}s`,
    };
  }

  return null;
}
