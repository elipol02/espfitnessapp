// ─── Exercise Types ─────────────────────────────────────────────────────────

export type ExerciseType =
  | 'strength'
  | 'distance'
  | 'time'
  | 'amrap'
  | 'emom'
  | 'round_block'
  | 'tabata'
  | 'simple';

export type WeightType = 'absolute' | 'bodyweight' | 'percentage_1rm';
export type WeightUnit = 'lbs' | 'kg';
export type DistanceUnit = 'feet' | 'yards' | 'meters' | 'miles' | 'km';

// ─── Exercise Config (discriminated by exerciseType) ────────────────────────

export interface StrengthConfig {
  sets: number;
  repsMin: number;
  repsMax: number;
  weightType: WeightType;
  baseWeight: number;
  weightUnit: WeightUnit;
  restSeconds: number;
  tempo?: string;
}

export interface DistanceConfig {
  sets: number;
  distanceTarget: number;
  distanceUnit: DistanceUnit;
  restSeconds: number;
  weight?: number;
  weightUnit?: WeightUnit;
}

export interface TimeConfig {
  sets: number;
  durationSeconds: number;
  restSeconds: number;
}

export interface MovementDef {
  name: string;
  reps?: number;
  duration?: number;
  weight?: number;
  weightUnit?: WeightUnit;
}

export interface AmrapConfig {
  timeCap: number;
  movements: MovementDef[];
}

export interface EmomConfig {
  intervalSeconds: number;
  totalMinutes: number;
  movements: MovementDef[];
}

export interface RoundBlockConfig {
  rounds: number;
  restBetweenRounds: number;
  movements: MovementDef[];
}

export interface TabataConfig {
  rounds: number;
  workSeconds: number;
  restSeconds: number;
  movements: MovementDef[];
}

export interface SimpleConfig {
  notes?: string;
}

export type ExerciseConfig =
  | StrengthConfig
  | DistanceConfig
  | TimeConfig
  | AmrapConfig
  | EmomConfig
  | RoundBlockConfig
  | TabataConfig
  | SimpleConfig;

// ─── Progression Rules ──────────────────────────────────────────────────────

export interface LinearProgression {
  type: 'linear';
  incrementValue: number;
  incrementUnit: string;
}

export interface DoubleProgression {
  type: 'double_progression';
  repsMin: number;
  repsMax: number;
  weightIncrement: number;
  weightIncrementUnit: WeightUnit;
}

export interface NoProgression {
  type: 'none';
}

export type ProgressionRule = LinearProgression | DoubleProgression | NoProgression;

// ─── Template Models ────────────────────────────────────────────────────────

export interface WorkoutType {
  id: string;
  userId: string;
  name: string;
  color: string;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
  exercises: Exercise[];
}

export interface Exercise {
  id: string;
  workoutTypeId: string;
  name: string;
  exerciseType: ExerciseType;
  config: ExerciseConfig;
  progression: ProgressionRule | null;
  groupTag: string | null;
  order: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schedule Models ────────────────────────────────────────────────────────

export interface DayAssignment {
  id: string;
  userId: string;
  dayOfWeek: number;
  order: number;
  workoutTypeId: string | null;
  workoutType: WorkoutType | null;
  rotationId: string | null;
  rotation?: WorkoutRotation | null;
}

// ─── Rotation Models ─────────────────────────────────────────────────────────

export interface WorkoutRotation {
  id: string;
  userId: string;
  name: string;
  currentIndex: number;
  entries: RotationEntry[];
}

export interface RotationEntry {
  id: string;
  rotationId: string;
  workoutTypeId: string;
  order: number;
  workoutType: WorkoutType;
}

/** Lightweight workout type summary used on home/calendar views */
export interface WorkoutTypeSummary {
  id: string;
  name: string;
  color: string;
  exerciseCount: number;
  exercises: { id: string; name: string }[];
}

/** A day assignment slot with the effective workout resolved (rotation or direct) */
export interface ResolvedDaySlot {
  assignmentId: string;
  dayOfWeek: number;
  order: number;
  rotationId: string | null;
  rotationName: string | null;
  rotationSize: number;
  rotationSlotIndex: number; // which slot is currently active (0-based)
  effectiveWorkoutType: WorkoutTypeSummary;
}

/**
 * Minimal shape needed to resolve a slot's effective workout type. Kept structural
 * (only the fields actually read) so it accepts Prisma query results directly,
 * regardless of how their scalar fields (e.g. exerciseType) are typed.
 */
type ResolvableWorkoutType = {
  id: string;
  name: string;
  color: string;
  exercises?: { id: string; name: string }[];
};

type ResolvableAssignment = {
  workoutType?: ResolvableWorkoutType | null;
  rotationId?: string | null;
  rotation?: {
    currentIndex: number;
    entries: { order: number; workoutType: ResolvableWorkoutType }[];
  } | null;
};

/** Resolve the effective workout type for a day assignment slot */
export function resolveEffectiveWorkoutType(
  assignment: ResolvableAssignment,
): WorkoutTypeSummary | null {
  if (assignment.workoutType) {
    const wt = assignment.workoutType;
    return {
      id: wt.id,
      name: wt.name,
      color: wt.color,
      exerciseCount: wt.exercises?.length ?? 0,
      exercises: wt.exercises?.map((e) => ({ id: e.id, name: e.name })) ?? [],
    };
  }
  if (assignment.rotation && assignment.rotation.entries.length > 0) {
    const rot = assignment.rotation;
    const idx = rot.currentIndex % rot.entries.length;
    const entry = rot.entries.find((e) => e.order === idx) ?? rot.entries[idx] ?? rot.entries[0];
    const wt = entry.workoutType;
    return {
      id: wt.id,
      name: wt.name,
      color: wt.color,
      exerciseCount: wt.exercises?.length ?? 0,
      exercises: wt.exercises?.map((e) => ({ id: e.id, name: e.name })) ?? [],
    };
  }
  return null;
}

// ─── Session / Completed Workout Models ─────────────────────────────────────

export type SessionStatus = 'in_progress' | 'completed';

export interface WorkoutSession {
  id: string;
  userId: string;
  workoutTypeId: string;
  rotationId: string | null;
  workoutDate: Date;
  status: SessionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  rating: number | null;
  createdAt: Date;
  entries: ExerciseEntry[];
}

// ─── Exercise Entry Data (discriminated by exerciseType) ────────────────────

export interface StrengthSetData {
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
  completed: boolean;
}

export interface DistanceSetData {
  distance: number;
  distanceUnit: DistanceUnit;
  durationSeconds?: number;
  completed: boolean;
}

export interface TimeSetData {
  durationSeconds: number;
  completed: boolean;
}

export interface StrengthEntryData {
  sets: StrengthSetData[];
}

export interface DistanceEntryData {
  sets: DistanceSetData[];
}

export interface TimeEntryData {
  sets: TimeSetData[];
}

export interface MovementWeightEntry {
  name: string;
  weight: number;
  weightUnit: string;
}

export interface RoundsEntryData {
  roundsCompleted: number;
  timeElapsed: number;
  movementWeights?: MovementWeightEntry[];
}

export interface SimpleEntryData {
  completed: boolean;
}

export type ExerciseEntryData =
  | StrengthEntryData
  | DistanceEntryData
  | TimeEntryData
  | RoundsEntryData
  | SimpleEntryData;

export interface ExerciseEntry {
  id: string;
  sessionId: string;
  exerciseId: string;
  data: ExerciseEntryData;
  createdAt: Date;
  exercise?: Exercise;
}

// ─── Progression Suggestions ────────────────────────────────────────────────

export interface ProgressionSuggestion {
  exerciseId: string;
  lastWeight?: number;
  lastReps?: number;
  lastDistance?: number;
  lastDuration?: number;
  suggestedWeight?: number;
  suggestedReps?: number;
  suggestedDistance?: number;
  suggestedDuration?: number;
  unit: string;
  display: string;
}

export type SuggestionMap = Record<string, ProgressionSuggestion>;

// ─── User ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string | null;
  bodyweight: number | null;
  onboardingCompleted: boolean;
  createdAt: Date;
}


// ─── Chat ───────────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  userId: string;
  role: ChatRole;
  content: string;
  metadata: ChatMetadata | null;
  approved: boolean;
  createdAt: Date;
}

export interface ChatMetadata {
  type?: 'plan_preview';
  planData?: PlanData;
}

export interface PlanData {
  name: string;
  schedule: PlanDayData[];
}

export interface PlanDayData {
  dayOfWeek: number;
  dayName: string;
  slots: PlanDaySlot[];
}

/** A single workout slot within a plan day — either fixed or part of a rotation */
export type PlanDaySlot =
  | {
      type: 'fixed';
      workoutTypeName: string;
      workoutTypeColor: string;
      workoutTypeCategory?: string;
      exercises: PlanExerciseData[];
    }
  | {
      type: 'rotation';
      rotationName: string;
      rotationEntries: {
        workoutTypeName: string;
        workoutTypeColor: string;
        workoutTypeCategory?: string;
        exercises: PlanExerciseData[];
      }[];
    };

export interface PlanExerciseData {
  name: string;
  exerciseType: ExerciseType;
  config: ExerciseConfig;
  progression?: ProgressionRule;
  groupTag?: string;
  order: number;
  notes?: string;
}

// ─── API Response Types ─────────────────────────────────────────────────────

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── SSE Streaming Types ────────────────────────────────────────────────────

export type SSEEventType =
  | 'text-chunk'
  | 'text-done'
  | 'tool-call'
  | 'tool-result'
  | 'error'
  | 'done'
  | 'cancelled';

export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  toolResult?: {
    toolCallId: string;
    result: unknown;
  };
  error?: string;
}

// ─── Calendar Types ─────────────────────────────────────────────────────────

export interface CalendarDay {
  date: Date;
  workoutType: WorkoutType | null;
  session: WorkoutSession | null;
  isToday: boolean;
  isCurrentMonth: boolean;
}

// ─── Live Workout Types ─────────────────────────────────────────────────────

export interface LiveWorkoutState {
  sessionId: string;
  workoutTypeId: string;
  currentExerciseIndex: number;
  exercises: LiveExercise[];
  startedAt: Date;
}

export interface LiveExercise {
  exercise: Exercise;
  entryData: ExerciseEntryData | null;
  suggestion: ProgressionSuggestion | null;
}
