// Workout Types
export type WorkoutType = 'legs' | 'push' | 'pull' | 'full-body' | 'arms' | 'upper' | 'lower' | 'cardio' | 'core' | 'rest';

export type WeightType = 'BW' | '1RM' | 'ABSOLUTE';

export type PlanStatus = 'draft' | 'active' | 'completed' | 'archived';

export type WorkoutLogStatus = 'in_progress' | 'completed' | 'skipped';

export type ChatRole = 'user' | 'assistant' | 'system';

// Exercise Types - all supported exercise formats
export type ExerciseType = 
  | 'strength'      // Traditional sets x reps with weight
  | 'cardio_time'   // Time-based cardio (duration in minutes)
  | 'mobility_time' // Time-based mobility/stretching
  | 'distance'      // Distance-based (e.g., suitcase carry 3x40ft)
  | 'interval'      // Interval training (work/rest periods)
  | 'amrap'         // As Many Reps/Rounds As Possible
  | 'emom'          // Every Minute On the Minute
  | 'tabata'        // 20s work, 10s rest intervals
  | 'tempo';        // Tempo-controlled strength training

export type DistanceUnit = 'feet' | 'yards' | 'meters';

export type IntervalIntensity = 'easy' | 'moderate' | 'hard';

// Interval phase for complex interval workouts
export interface IntervalPhase {
  name: string;
  duration: number; // in seconds
  intensity?: IntervalIntensity;
}

// Interval structure for interval-type exercises
export interface IntervalStructure {
  type: 'simple' | 'complex';
  rounds: number;
  phases: IntervalPhase[];
}

// User
export interface User {
  id: string;
  email: string;
  name: string | null;
  bodyweight: number | null;
  onboardingCompleted: boolean;
  createdAt: Date;
}

// User Stats
export interface UserStats {
  id: string;
  userId: string;
  currentStreak: number;
  longestStreak: number;
  personalRecords: Record<string, PersonalRecord>;
  progressPercentage: number;
  lastWorkout: Date | null;
  updatedAt: Date;
}

export interface PersonalRecord {
  exercise: string;
  weight: number;
  reps: number;
  date: Date;
}

// Workout Plan
export interface WorkoutPlan {
  id: string;
  userId: string;
  goal: string;
  aiContext: AIContext | null;
  status: PlanStatus;
  weeksDuration: number;
  createdAt: Date;
  workoutDays: WorkoutDay[];
}

export interface AIContext {
  sessionLength?: number;
  sessionsPerWeek?: number;
  experienceLevel?: string;
  equipment?: string[];
  conversationHistory?: string[];
}

// Workout Day
export interface WorkoutDay {
  id: string;
  planId: string;
  dayNumber: number;
  dayName: string;
  workoutType: WorkoutType;
  workoutColor: string;
  metadata: Record<string, unknown> | null;
  exercises: Exercise[];
}

// Exercise
export interface Exercise {
  id: string;
  dayId: string;
  name: string;
  exerciseType: ExerciseType;
  order: number;
  
  // Strength exercise fields (sets x reps with weight)
  sets: number;
  reps: number;
  weightType: WeightType;
  weightValue: number;
  restTime: number;
  
  // Time-based exercise fields (cardio_time, mobility_time)
  duration?: number;           // Duration in minutes
  
  // Distance-based exercise fields
  distance?: number;           // Target distance (e.g., 40)
  distanceUnit?: DistanceUnit; // feet, yards, meters
  
  // Interval exercise fields
  intervals?: IntervalStructure; // { type, rounds, phases[] }
  
  // Tempo exercise fields  
  tempo?: string;              // Tempo pattern (e.g., "3-1-3-1")
  
  // AMRAP/EMOM/Tabata fields
  timeCap?: number;            // Time cap in seconds
  movements?: Movement[];      // List of movements for complex workouts
  
  // Common fields
  progression: ProgressionStrategy | null;
  movementDetails: MovementDetails | null;
}

// Movement within AMRAP/EMOM/Tabata
export interface Movement {
  name: string;
  reps?: number;               // Reps per round/minute
  duration?: number;           // Duration in seconds (alternative to reps)
  weight?: number;             // Weight if applicable
  weightType?: WeightType;
}

export interface ProgressionStrategy {
  type: 'linear' | 'wave' | 'deload' | 'custom';
  increment: number;
  frequency: string;
  notes?: string;
}

export interface MovementDetails {
  description: string;
  cues: string[];
  muscles: string[];
  videoUrl?: string;
}

// Workout Log
export interface WorkoutLog {
  id: string;
  userId: string;
  planId: string;
  dayId: string;
  workoutDate: Date;
  status: WorkoutLogStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  feedback: WorkoutFeedback | null;
  createdAt: Date;
  exerciseLogs: ExerciseLog[];
}

export interface WorkoutFeedback {
  rating: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  difficulty?: 'easy' | 'moderate' | 'hard' | 'very_hard';
}

// Exercise Log
export interface ExerciseLog {
  id: string;
  logId: string;
  exerciseId: string;
  setsCompleted: number;
  repsPerSet: number[];
  weightUsed: number[]; // Array of weights, one per set
  isPR: boolean;
  notes: string | null;
}

// Chat Message
export interface ChatMessage {
  id: string;
  userId: string;
  planId: string | null;
  role: ChatRole;
  content: string;
  metadata: ChatMetadata | null;
  createdAt: Date;
}

export interface ChatMetadata {
  type?: 'plan_preview' | 'approval_request' | 'workout_summary' | 'feedback_request';
  planData?: Partial<WorkoutPlan>;
  actionButtons?: ActionButton[];
}

export interface ActionButton {
  id: string;
  label: string;
  action: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

// API Response Types
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Calendar Types
export interface CalendarDay {
  date: Date;
  workoutDay: WorkoutDay | null;
  workoutLog: WorkoutLog | null;
  isToday: boolean;
  isCurrentMonth: boolean;
}

// Live Workout Types
export interface LiveWorkoutState {
  workoutLogId: string;
  planId: string;
  dayId: string;
  currentExerciseIndex: number;
  exercises: LiveExercise[];
  startedAt: Date;
  restTimerEnd: Date | null;
}

export interface LiveExercise {
  exercise: Exercise;
  completedSets: CompletedSet[];
  targetSets: number;
  targetReps: number;
  targetWeight: number;
}

export interface CompletedSet {
  setNumber: number;
  reps: number;
  weight: number;
  completedAt: Date;
}

// SSE Streaming Types
export type SSEEventType = 
  | 'text-chunk'           // Token from conversational response (ALL modes)
  | 'text-done'            // Conversational text complete (ALL modes)
  | 'day-generated'        // One workout day complete with exercises (create/edit only)
  | 'adjustment-generated' // One exercise adjustment ready (post_workout only)
  | 'error'                // Something went wrong (ALL modes)
  | 'done'                 // Generation complete (ALL modes)
  | 'cancelled';           // User stopped generation (ALL modes)

export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  day?: StreamingWorkoutDay;
  adjustment?: StreamingExerciseAdjustment;
  planId?: string;
  error?: string;
  progress?: {
    current: number;
    total: number;
    label: string;
  };
}

export interface StreamingWorkoutDay {
  dayNumber: number;
  dayName: string;
  workoutType: string;
  workoutColor: string;
  exercises: Array<{
    name: string;
    sets: number;
    reps: number;
    weightType: string;
    weightValue: number;
    restTime?: number;
    exerciseType?: string;
    progression?: {
      type: string;
      increment: number;
      frequency: string;
    };
    movementDetails?: {
      description: string;
      cues: string[];
      muscles: string[];
    };
    distance?: number;
    distanceUnit?: string;
    intervals?: object;
    tempo?: string;
    timeCap?: number;
  }>;
}

export interface StreamingExerciseAdjustment {
  name: string;
  currentWeight: number;
  currentSets: number;
  currentReps: number;
  nextWeight: number;
  nextSets: number;
  nextReps: number;
  reasoning: string;
}