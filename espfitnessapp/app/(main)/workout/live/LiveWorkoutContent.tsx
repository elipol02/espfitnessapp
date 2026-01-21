'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Minus, Check, Timer, ChevronRight, Play } from 'lucide-react';
import { Button } from '@/app/components/Button';
import { haptic } from '@/app/lib/utils';

interface IntervalPhase {
  name: string;
  duration: number;
  intensity?: 'easy' | 'moderate' | 'hard';
}

interface IntervalStructure {
  type: 'simple' | 'complex';
  rounds: number;
  phases: IntervalPhase[];
}

interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weightType: string;
  weightValue: number;
  restTime: number;
  exerciseType: string;
  // Time-based fields
  duration?: number; // Duration in minutes (for cardio_time, mobility_time)
  // Complex exercise type fields
  distance?: number;
  distanceUnit?: 'feet' | 'yards' | 'meters';
  intervals?: IntervalStructure;
  tempo?: string;
  timeCap?: number;
}

interface ExerciseLog {
  id: string;
  exerciseId: string;
  setsCompleted: number;
  repsPerSet: number[] | unknown;
  weightUsed: number[] | unknown;
}

interface WorkoutDay {
  id: string;
  dayName: string;
  workoutType: string;
  workoutColor: string;
}

interface CompletedSet {
  reps: number;
  weight: number;
  distance?: number;
  time?: number;
}

export function LiveWorkoutContent({
  workoutLogId,
  workoutDay,
  exercises,
  existingLogs,
  userBodyweight,
  workoutStatus,
  pendingAdjustmentId,
  hasAnalysis,
  chatSessionId,
  isPreview = false,
}: {
  workoutLogId: string;
  workoutDay: WorkoutDay;
  exercises: Exercise[];
  existingLogs: ExerciseLog[];
  userBodyweight: number | null;
  workoutStatus: string;
  pendingAdjustmentId?: string | null;
  hasAnalysis?: boolean;
  chatSessionId?: string | null;
  isPreview?: boolean;
}) {
  const router = useRouter();
  
  // Safety check: if no exercises, redirect to home
  useEffect(() => {
    if (!exercises || exercises.length === 0) {
      console.error('No exercises found in workout');
      router.push('/home');
    }
  }, [exercises, router]);
  
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [completedSets, setCompletedSets] = useState<Map<string, CompletedSet[]>>(new Map());
  const [weight, setWeight] = useState(0);
  const [reps, setReps] = useState(0);
  const [distance, setDistance] = useState(0);
  const [restTimer, setRestTimer] = useState<number | null>(null);
  const [cardioTimer, setCardioTimer] = useState<number | null>(null);
  const [cardioStartTime, setCardioStartTime] = useState<Date | null>(null);
  const [startTime] = useState(new Date());
  const [saving, setSaving] = useState(false);
  
  // Interval state
  const [intervalRound, setIntervalRound] = useState(0);
  const [intervalPhaseIndex, setIntervalPhaseIndex] = useState(0);
  const [intervalTimer, setIntervalTimer] = useState<number | null>(null);
  const [intervalRunning, setIntervalRunning] = useState(false);
  
  // AMRAP state
  const [amrapTimer, setAmrapTimer] = useState<number | null>(null);
  const [amrapReps, setAmrapReps] = useState(0);
  const [amrapRunning, setAmrapRunning] = useState(false);
  
  // EMOM state
  const [emomRound, setEmomRound] = useState(0);
  const [emomTimer, setEmomTimer] = useState<number | null>(null);
  const [emomRunning, setEmomRunning] = useState(false);
  
  // Tabata state
  const [tabataRound, setTabataRound] = useState(0);
  const [tabataPhase, setTabataPhase] = useState<'work' | 'rest'>('work');
  const [tabataTimer, setTabataTimer] = useState<number | null>(null);
  const [tabataRunning, setTabataRunning] = useState(false);

  const currentExercise = exercises[currentExerciseIndex];

  // Early return if no exercises or invalid index
  if (!exercises || exercises.length === 0 || !currentExercise) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">No exercises found</p>
        </div>
      </div>
    );
  }

  // Helper functions
  const calculateTargetWeight = useCallback((type: string, value: number, bodyweight: number | null): number => {
    switch (type) {
      case 'BW':
        return bodyweight ? Math.round(value * bodyweight) : 0;
      case '1RM':
        // For 1RM, we'd need the user's 1RM for this exercise
        // For now, use value as a multiplier (value should be a percentage like 0.8 for 80%)
        return Math.round(value * 100);
      case 'ABSOLUTE':
        return value;
      default:
        // Default to absolute value
        return value;
    }
  }, []);

  const [workoutCompleted, setWorkoutCompleted] = useState(workoutStatus === 'completed');
  const [adjustmentIdForChat, setAdjustmentIdForChat] = useState<string | null>(pendingAdjustmentId || null);

  const finishWorkout = useCallback(async () => {
    if (saving) return;
    setSaving(true);

    try {
      const response = await fetch('/api/workout/live/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          feedback: null,
        }),
      });

      const result = await response.json();

      if (result.redirectToChat && result.pendingAdjustmentId) {
        // Don't navigate immediately - just set state to show button
        setWorkoutCompleted(true);
        setAdjustmentIdForChat(result.pendingAdjustmentId);
        setSaving(false);
      } else {
        // No analysis available, just go home
        router.push('/home');
      }
    } catch (error) {
      console.error('Failed to finish workout:', error);
      setSaving(false);
    }
  }, [saving, workoutLogId, router]);

  // Initialize completed sets from existing logs
  useEffect(() => {
    const setsMap = new Map<string, CompletedSet[]>();
    for (const log of existingLogs) {
      const repsArray = Array.isArray(log.repsPerSet) ? log.repsPerSet : [];
      const weightsArray = Array.isArray(log.weightUsed) ? log.weightUsed : [];
      const sets: CompletedSet[] = repsArray.map((reps, index) => ({
        reps: Number(reps),
        weight: Number(weightsArray[index] || 0),
      }));
      setsMap.set(log.exerciseId, sets);
    }
    setCompletedSets(setsMap);
  }, [existingLogs]);

  // Set initial weight/reps/distance when exercise changes
  useEffect(() => {
    if (currentExercise) {
      const targetWeight = calculateTargetWeight(
        currentExercise.weightType,
        currentExercise.weightValue,
        userBodyweight
      );
      console.log('Setting weight for exercise:', {
        name: currentExercise.name,
        weightType: currentExercise.weightType,
        weightValue: currentExercise.weightValue,
        userBodyweight,
        calculatedWeight: targetWeight
      });
      setWeight(targetWeight);
      setReps(currentExercise.reps);
      setDistance(currentExercise.distance || 0);
      
      // Reset all timer states when changing exercises
      setIntervalRound(0);
      setIntervalPhaseIndex(0);
      setIntervalTimer(null);
      setIntervalRunning(false);
      setAmrapTimer(null);
      setAmrapReps(0);
      setAmrapRunning(false);
      setEmomRound(0);
      setEmomTimer(null);
      setEmomRunning(false);
      setTabataRound(0);
      setTabataPhase('work');
      setTabataTimer(null);
      setTabataRunning(false);
    }
  }, [currentExercise, userBodyweight, calculateTargetWeight]);

  // Rest timer countdown
  useEffect(() => {
    if (restTimer === null) return;

    if (restTimer <= 0) {
      setRestTimer(null);
      haptic('medium');
      return;
    }

    const interval = setInterval(() => {
      setRestTimer((prev) => (prev ? prev - 1 : null));
    }, 1000);

    return () => clearInterval(interval);
  }, [restTimer]);

  // Cardio timer countdown
  useEffect(() => {
    if (cardioTimer === null) return;

    if (cardioTimer <= 0) {
      setCardioTimer(null);
      setCardioStartTime(null);
      haptic('medium');
      return;
    }

    const interval = setInterval(() => {
      setCardioTimer((prev) => (prev ? prev - 1 : null));
    }, 1000);

    return () => clearInterval(interval);
  }, [cardioTimer]);

  // Interval timer countdown
  useEffect(() => {
    if (intervalTimer === null || !intervalRunning || !currentExercise?.intervals) return;

    if (intervalTimer <= 0) {
      haptic('medium');
      const intervals = currentExercise.intervals;
      const nextPhaseIndex = intervalPhaseIndex + 1;
      
      if (nextPhaseIndex >= intervals.phases.length) {
        // End of round
        const nextRound = intervalRound + 1;
        if (nextRound >= intervals.rounds) {
          // All rounds complete
          setIntervalRunning(false);
          setIntervalTimer(null);
          completeIntervalExercise();
        } else {
          // Next round
          setIntervalRound(nextRound);
          setIntervalPhaseIndex(0);
          setIntervalTimer(intervals.phases[0].duration);
        }
      } else {
        // Next phase
        setIntervalPhaseIndex(nextPhaseIndex);
        setIntervalTimer(intervals.phases[nextPhaseIndex].duration);
      }
      return;
    }

    const interval = setInterval(() => {
      setIntervalTimer((prev) => (prev ? prev - 1 : null));
    }, 1000);

    return () => clearInterval(interval);
  }, [intervalTimer, intervalRunning, intervalPhaseIndex, intervalRound, currentExercise]);

  // AMRAP timer countdown
  useEffect(() => {
    if (amrapTimer === null || !amrapRunning) return;

    if (amrapTimer <= 0) {
      haptic('medium');
      setAmrapRunning(false);
      setAmrapTimer(null);
      completeAmrapExercise();
      return;
    }

    const interval = setInterval(() => {
      setAmrapTimer((prev) => (prev ? prev - 1 : null));
    }, 1000);

    return () => clearInterval(interval);
  }, [amrapTimer, amrapRunning]);

  // EMOM timer countdown
  useEffect(() => {
    if (emomTimer === null || !emomRunning || !currentExercise) return;

    if (emomTimer <= 0) {
      haptic('medium');
      const nextRound = emomRound + 1;
      const totalRounds = currentExercise.timeCap ? Math.floor(currentExercise.timeCap / 60) : currentExercise.sets;
      if (nextRound >= totalRounds) {
        // All rounds complete
        setEmomRunning(false);
        setEmomTimer(null);
        completeEmomExercise();
      } else {
        // Next minute
        setEmomRound(nextRound);
        setEmomTimer(60);
      }
      return;
    }

    const interval = setInterval(() => {
      setEmomTimer((prev) => (prev ? prev - 1 : null));
    }, 1000);

    return () => clearInterval(interval);
  }, [emomTimer, emomRunning, emomRound, currentExercise]);

  // Tabata timer countdown
  useEffect(() => {
    if (tabataTimer === null || !tabataRunning || !currentExercise) return;

    if (tabataTimer <= 0) {
      haptic('light');
      if (tabataPhase === 'work') {
        // Switch to rest
        setTabataPhase('rest');
        setTabataTimer(10);
      } else {
        // Switch to work or finish
        const nextRound = tabataRound + 1;
        if (nextRound >= currentExercise.sets) {
          // All rounds complete
          haptic('medium');
          setTabataRunning(false);
          setTabataTimer(null);
          completeTabataExercise();
        } else {
          setTabataRound(nextRound);
          setTabataPhase('work');
          setTabataTimer(20);
        }
      }
      return;
    }

    const interval = setInterval(() => {
      setTabataTimer((prev) => (prev ? prev - 1 : null));
    }, 1000);

    return () => clearInterval(interval);
  }, [tabataTimer, tabataRunning, tabataPhase, tabataRound, currentExercise]);

  // Auto-finish workout when all exercises are complete (only for in_progress workouts)
  useEffect(() => {
    // Skip auto-finish if workout is already completed
    if (workoutCompleted) return;

    const allComplete = exercises.every((exercise) => {
      const sets = completedSets.get(exercise.id) || [];
      // Single-completion exercises: interval, amrap, emom, tabata
      const isSingleCompletion = ['interval', 'amrap', 'emom', 'tabata'].includes(exercise.exerciseType);
      // For single-completion types, just check if there's any logged data
      // For all other types (including distance), check if all sets are complete
      return isSingleCompletion ? sets.length > 0 : sets.length >= exercise.sets;
    });

    if (allComplete && exercises.length > 0 && !saving) {
      // Automatically finish workout without modal
      finishWorkout();
    }
  }, [completedSets, exercises, saving, finishWorkout, workoutCompleted]);

  const currentSets = completedSets.get(currentExercise?.id) || [];
  const exerciseType = currentExercise?.exerciseType || 'strength';
  const isTimeBased = exerciseType === 'cardio_time' || exerciseType === 'mobility_time';
  const isDistanceBased = exerciseType === 'distance';
  const isIntervalBased = exerciseType === 'interval';
  const isAmrap = exerciseType === 'amrap';
  const isEmom = exerciseType === 'emom';
  const isTabata = exerciseType === 'tabata';
  const isTempo = exerciseType === 'tempo';
  // Only interval, amrap, emom, and tabata are single-completion exercises
  const isSingleCompletionType = isIntervalBased || isAmrap || isEmom || isTabata;

  // For single-completion types, just check if there's any data
  // For all other types (including distance and time-based), check if all sets are complete
  const isExerciseComplete = isSingleCompletionType 
    ? currentSets.length > 0 
    : currentSets.length >= (currentExercise?.sets || 0);

  // Format exercise target description
  const getTargetDescription = () => {
    if (!currentExercise) return '';
    
    switch (exerciseType) {
      case 'cardio_time':
      case 'mobility_time':
        return `Target: ${currentExercise.duration || currentExercise.reps} min`;
      case 'distance':
        return `Target: ${currentExercise.sets} × ${currentExercise.distance || 0} ${currentExercise.distanceUnit || 'feet'}`;
      case 'interval':
        if (currentExercise.intervals) {
          const { rounds, phases } = currentExercise.intervals;
          const phaseDesc = phases.map(p => `${Math.floor(p.duration / 60)}:${(p.duration % 60).toString().padStart(2, '0')} ${p.name}`).join(' / ');
          return `${rounds} rounds: ${phaseDesc}`;
        }
        return 'Interval training';
      case 'amrap':
        const timeCap = currentExercise.timeCap || 600;
        return `AMRAP ${Math.floor(timeCap / 60)} min • ${currentExercise.reps} reps/round`;
      case 'emom':
        const emomMinutes = currentExercise.timeCap ? Math.floor(currentExercise.timeCap / 60) : 10;
        return `EMOM ${emomMinutes} min: ${currentExercise.reps} reps/min`;
      case 'tabata':
        return `Tabata: ${currentExercise.sets} rounds (20s work / 10s rest) • ${currentExercise.reps} reps/round`;
      case 'tempo':
        return `Target: ${currentExercise.sets} × ${currentExercise.reps} @ tempo ${currentExercise.tempo}`;
      default:
        return `Target: ${currentExercise.sets} sets × ${currentExercise.reps} reps`;
    }
  };

  const startCardioTimer = () => {
    if (!currentExercise) return;
    const durationMinutes = currentExercise.duration || currentExercise.reps; // Use duration field, fall back to reps
    const durationSeconds = durationMinutes * 60;
    setCardioTimer(durationSeconds);
    setCardioStartTime(new Date());
  };

  const completeTimeBasedExercise = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    // Log as a single "set" with the time completed
    const actualMinutes = cardioStartTime 
      ? Math.round((Date.now() - cardioStartTime.getTime()) / 60000)
      : (currentExercise.duration || currentExercise.reps);
    
    const actualSeconds = actualMinutes * 60;
    const newSets = [{ reps: actualMinutes, weight: 0 }];
    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, newSets);
    setCompletedSets(newMap);

    // Save to database
    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          sets: newSets,
          duration: actualSeconds, // Store duration in seconds
        }),
      });
    } catch (error) {
      console.error('Failed to save set:', error);
    }

    // Reset timer
    setCardioTimer(null);
    setCardioStartTime(null);
  };

  // Distance-based exercise completion
  const logDistanceSet = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    const newSets = [...currentSets, { reps: 1, weight, distance }];
    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, newSets);
    setCompletedSets(newMap);

    // Start rest timer immediately (while save runs in background) - but not if this was the last set
    const isLastSet = newSets.length >= currentExercise.sets;
    if (!isLastSet) {
      setRestTimer(currentExercise.restTime);
    }

    // Save to database (fire-and-forget; timer already running)
    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          sets: newSets.map(s => ({ reps: s.reps, weight: s.weight })), // Strip distance from sets
          distance: distance, // Send distance as separate field
        }),
      });
    } catch (error) {
      console.error('Failed to save set:', error);
    }
  };

  // Interval exercise completion
  const completeIntervalExercise = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    const totalDuration = currentExercise.intervals 
      ? currentExercise.intervals.rounds * currentExercise.intervals.phases.reduce((sum, p) => sum + p.duration, 0)
      : 0;
    
    const newSets = [{ reps: 1, weight, time: totalDuration }];
    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, newSets);
    setCompletedSets(newMap);

    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          sets: newSets,
        }),
      });
    } catch (error) {
      console.error('Failed to save interval:', error);
    }
  };

  // Start interval workout
  const startInterval = () => {
    if (!currentExercise?.intervals) return;
    setIntervalRound(0);
    setIntervalPhaseIndex(0);
    setIntervalTimer(currentExercise.intervals.phases[0].duration);
    setIntervalRunning(true);
  };

  // AMRAP exercise completion
  const completeAmrapExercise = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    const newSets = [{ reps: amrapReps, weight }];
    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, newSets);
    setCompletedSets(newMap);

    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          sets: newSets,
        }),
      });
    } catch (error) {
      console.error('Failed to save AMRAP:', error);
    }
  };

  // Start AMRAP workout
  const startAmrap = () => {
    if (!currentExercise?.timeCap) return;
    setAmrapTimer(currentExercise.timeCap);
    setAmrapReps(0);
    setAmrapRunning(true);
  };

  // EMOM exercise completion
  const completeEmomExercise = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    const totalRounds = currentExercise.timeCap ? Math.floor(currentExercise.timeCap / 60) : currentExercise.sets;
    const newSets = [{ reps: totalRounds, weight }];
    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, newSets);
    setCompletedSets(newMap);

    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          sets: newSets,
        }),
      });
    } catch (error) {
      console.error('Failed to save EMOM:', error);
    }
  };

  // Start EMOM workout
  const startEmom = () => {
    setEmomRound(0);
    setEmomTimer(60);
    setEmomRunning(true);
  };

  // Tabata exercise completion
  const completeTabataExercise = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    const newSets = [{ reps: currentExercise.sets, weight }];
    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, newSets);
    setCompletedSets(newMap);

    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          sets: newSets,
        }),
      });
    } catch (error) {
      console.error('Failed to save Tabata:', error);
    }
  };

  // Start Tabata workout
  const startTabata = () => {
    setTabataRound(0);
    setTabataPhase('work');
    setTabataTimer(20);
    setTabataRunning(true);
  };

  const logSet = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    const newSets = [...currentSets, { reps, weight }];
    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, newSets);
    setCompletedSets(newMap);

    // Start rest timer immediately (while save runs in background) - but not if this was the last set
    const isLastSet = newSets.length >= currentExercise.sets;
    if (!isLastSet) {
      setRestTimer(currentExercise.restTime);
    }

    // Save to database (fire-and-forget; timer already running)
    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          sets: newSets,
        }),
      });
    } catch (error) {
      console.error('Failed to save set:', error);
    }
  };

  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const elapsedMinutes = Math.floor((Date.now() - startTime.getTime()) / 60000);

  if (!currentExercise) {
    return null;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            <h1
              className="font-bold capitalize"
              style={{ color: workoutDay.workoutColor }}
            >
              {workoutDay.workoutType}
            </h1>
            <p className="text-xs text-muted-foreground">{elapsedMinutes} min</p>
          </div>

           <div className="w-9"></div>
        </div>

        {/* Exercise Tabs */}
        <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-hide">
          {exercises.map((exercise, index) => {
            const sets = completedSets.get(exercise.id) || [];
            // Only interval, amrap, emom, tabata are single-completion exercises
            const isSingleCompletion = ['interval', 'amrap', 'emom', 'tabata'].includes(exercise.exerciseType);
            const isComplete = isSingleCompletion ? sets.length > 0 : sets.length >= exercise.sets;
            const isCurrent = index === currentExerciseIndex;
            
            return (
              <button
                key={exercise.id}
                onClick={() => {
                  setCurrentExerciseIndex(index);
                  setRestTimer(null);
                }}
                className={`
                  flex-shrink-0 px-3 py-2 rounded-lg transition-colors text-left
                  ${isCurrent 
                    ? 'bg-primary text-white' 
                    : isComplete
                    ? 'bg-success/20 text-success'
                    : 'bg-surface text-muted-foreground hover:text-foreground'
                  }
                `}
              >
                <div className="text-xs font-medium">{index + 1}</div>
                <div className="text-[10px] leading-tight mt-0.5 opacity-80 max-w-[80px] truncate">
                  {exercise.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview Mode Banner */}
      {isPreview && (
        <div className="flex-shrink-0 bg-primary/10 border-b border-primary/20 px-4 py-3">
          <p className="text-center text-sm text-primary font-medium">
            Preview Mode - This workout cannot be logged yet
          </p>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
        {/* Exercise Name */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground">{currentExercise.name}</h2>
          <p className="text-muted-foreground mt-1">{getTargetDescription()}</p>
          {isTempo && currentExercise.tempo && (
            <p className="text-sm text-primary mt-1">
              Tempo: {currentExercise.tempo.split('-').join('s - ')}s
            </p>
          )}
          {/* Show weight type info for BW and 1RM exercises */}
          {currentExercise.weightType === 'BW' && currentExercise.weightValue > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {Math.round(currentExercise.weightValue * 100)}% of bodyweight
              {userBodyweight ? ` (${userBodyweight} lbs)` : ' (bodyweight not set)'}
            </p>
          )}
          {currentExercise.weightType === '1RM' && (
            <p className="text-xs text-muted-foreground mt-1">
              {Math.round(currentExercise.weightValue * 100)}% of 1RM
            </p>
          )}
          {currentExercise.weightType === 'BW' && !userBodyweight && (
            <p className="text-xs text-yellow-500 mt-1">
              ⚠️ Set your bodyweight in profile for accurate weight calculation
            </p>
          )}
        </div>

        {/* Completed Sets */}
        {currentSets.length > 0 && (
          <div className="space-y-2">
            {currentSets.map((set, i) => {
              const getSetDisplay = () => {
                if (isTimeBased) return `${set.reps} min`;
                if (isDistanceBased) return `${set.distance} ${currentExercise.distanceUnit || 'feet'} @ ${set.weight} lbs`;
                if (isIntervalBased) return set.weight > 0 ? `${Math.floor((set.time || 0) / 60)} min @ ${set.weight} lbs` : `${Math.floor((set.time || 0) / 60)} min completed`;
                if (isAmrap) return set.weight > 0 ? `${set.reps} rounds @ ${set.weight} lbs` : `${set.reps} rounds completed`;
                if (isEmom) return set.weight > 0 ? `${set.reps} rounds @ ${set.weight} lbs` : `${set.reps} rounds completed`;
                if (isTabata) return set.weight > 0 ? `${set.reps} rounds @ ${set.weight} lbs` : `${set.reps} rounds completed`;
                return `${set.weight} lbs × ${set.reps}`;
              };

              const getSetLabel = () => {
                if (isTimeBased || isIntervalBased || isAmrap || isEmom || isTabata) return 'Completed';
                return `Set ${i + 1}`;
              };

              return (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-surface rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                    <Check size={16} className="text-success" />
                  </div>
                    <span className="font-medium text-foreground">{getSetLabel()}</span>
                </div>
                  <span className="text-muted-foreground">{getSetDisplay()}</span>
              </div>
              );
            })}
          </div>
        )}

        {/* Rest Timer */}
        {restTimer !== null && (
          <div className="bg-surface rounded-xl p-8 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-primary">
              <Timer size={20} />
              <span className="text-sm font-medium">Rest</span>
            </div>
            <p className="text-4xl font-bold text-foreground">{formatTime(restTimer)}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRestTimer(null)}
            >
              Skip
            </Button>
          </div>
        )}

        {/* Current Set Entry */}
        {!isExerciseComplete && restTimer === null && (
          <div className="bg-surface rounded-xl p-7 space-y-6">
            {isTimeBased ? (
              // Time-based exercise interface
              <>
                {cardioTimer === null ? (
                  <>
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">Ready to start</p>
                    </div>
                    <Button onClick={startCardioTimer} fullWidth size="lg" disabled={isPreview}>
                      {isPreview ? 'Preview Only' : 'Start Timer'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="text-center space-y-3">
                      <div className="flex items-center justify-center gap-2 text-primary">
                        <Timer size={20} />
                        <span className="text-sm font-medium">Time Remaining</span>
                      </div>
                      <p className="text-5xl font-bold text-foreground">{formatTime(cardioTimer)}</p>
                    </div>
                    <Button onClick={completeTimeBasedExercise} fullWidth size="lg" disabled={isPreview}>
                      {isPreview ? 'Preview Only' : 'Complete'}
                    </Button>
                  </>
                )}
              </>
            ) : isDistanceBased ? (
              // Distance-based exercise interface
              <>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Set {currentSets.length + 1} of {currentExercise.sets}</p>
                </div>

                {/* Distance Input */}
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground text-center block">
                    Distance ({currentExercise.distanceUnit || 'feet'})
                  </label>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={() => setDistance(Math.max(0, distance - 5))}
                      className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                    >
                      <Minus size={20} />
                    </button>
                    <input
                      type="number"
                      value={distance}
                      onChange={(e) => setDistance(Number(e.target.value))}
                      className="w-24 text-center text-3xl font-bold bg-transparent text-foreground focus:outline-none"
                    />
                    <button
                      onClick={() => setDistance(distance + 5)}
                      className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                </div>

                {/* Weight Input (if carrying weight) */}
                {currentExercise.weightValue > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground text-center block">
                      Weight (lbs)
                    </label>
                    <div className="flex items-center justify-center gap-4">
                      <button
                        onClick={() => setWeight(Math.max(0, weight - 5))}
                        className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                      >
                        <Minus size={20} />
                      </button>
                      <input
                        type="number"
                        value={weight}
                        onChange={(e) => setWeight(Number(e.target.value))}
                        className="w-24 text-center text-3xl font-bold bg-transparent text-foreground focus:outline-none"
                      />
                      <button
                        onClick={() => setWeight(weight + 5)}
                        className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                  </div>
                )}

                <Button onClick={logDistanceSet} fullWidth size="lg" disabled={isPreview}>
                  {isPreview ? 'Preview Only' : 'Log Set'}
                </Button>
              </>
            ) : isIntervalBased ? (
              // Interval training interface
              <>
                {!intervalRunning && intervalTimer === null ? (
                  <>
                    <div className="text-center space-y-2">
                      <p className="text-sm text-muted-foreground">Ready to start intervals</p>
                      {currentExercise.intervals && (
                        <div className="space-y-1">
                          {currentExercise.intervals.phases.map((phase, i) => (
                            <div key={i} className="flex items-center justify-center gap-2 text-sm">
                              <span className={`w-2 h-2 rounded-full ${
                                phase.intensity === 'hard' ? 'bg-red-500' :
                                phase.intensity === 'moderate' ? 'bg-yellow-500' :
                                'bg-green-500'
                              }`} />
                              <span className="text-foreground">{phase.name}: {formatTime(phase.duration)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Weight Input (if exercise has weight) */}
                    {currentExercise.weightValue > 0 && (
                      <div className="space-y-2">
                        <label className="text-sm text-muted-foreground text-center block">
                          Weight (lbs)
                        </label>
                        <div className="flex items-center justify-center gap-4">
                          <button
                            onClick={() => setWeight(Math.max(0, weight - 5))}
                            className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                          >
                            <Minus size={20} />
                          </button>
                          <input
                            type="number"
                            value={weight}
                            onChange={(e) => setWeight(Number(e.target.value))}
                            className="w-24 text-center text-3xl font-bold bg-transparent text-foreground focus:outline-none"
                          />
                          <button
                            onClick={() => setWeight(weight + 5)}
                            className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    )}

                    <Button onClick={startInterval} fullWidth size="lg" disabled={isPreview}>
                      <Play size={20} className="mr-2" />
                      {isPreview ? 'Preview Only' : 'Start Intervals'}
                    </Button>
              </>
            ) : (
                  <>
                    <div className="text-center space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Round {intervalRound + 1} of {currentExercise.intervals?.rounds || 0}
                      </p>
                      <div className={`inline-block px-4 py-1 rounded-full text-sm font-medium ${
                        currentExercise.intervals?.phases[intervalPhaseIndex]?.intensity === 'hard' 
                          ? 'bg-red-500/20 text-red-400'
                          : currentExercise.intervals?.phases[intervalPhaseIndex]?.intensity === 'moderate'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {currentExercise.intervals?.phases[intervalPhaseIndex]?.name || 'Phase'}
                      </div>
                      <p className="text-5xl font-bold text-foreground">{formatTime(intervalTimer || 0)}</p>
                    </div>
                    <div className="flex gap-3">
                      <Button 
                        variant="secondary" 
                        onClick={() => {
                          setIntervalRunning(false);
                          setIntervalTimer(null);
                        }} 
                        fullWidth
                      >
                        Stop
                      </Button>
                      <Button onClick={completeIntervalExercise} fullWidth>
                        Complete Early
                      </Button>
                    </div>
                  </>
                )}
              </>
            ) : isAmrap ? (
              // AMRAP interface
              <>
                {!amrapRunning && amrapTimer === null ? (
                  <>
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">AMRAP: As Many Rounds As Possible</p>
                      <p className="text-sm text-muted-foreground">{currentExercise.reps} reps/round × {formatTime(currentExercise.timeCap || 600)}</p>
                    </div>

                    {/* Weight Input (if exercise has weight) */}
                    {currentExercise.weightValue > 0 && (
                      <div className="space-y-2">
                        <label className="text-sm text-muted-foreground text-center block">
                          Weight (lbs)
                        </label>
                        <div className="flex items-center justify-center gap-4">
                          <button
                            onClick={() => setWeight(Math.max(0, weight - 5))}
                            className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                          >
                            <Minus size={20} />
                          </button>
                          <input
                            type="number"
                            value={weight}
                            onChange={(e) => setWeight(Number(e.target.value))}
                            className="w-24 text-center text-3xl font-bold bg-transparent text-foreground focus:outline-none"
                          />
                          <button
                            onClick={() => setWeight(weight + 5)}
                            className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    )}

                    <Button onClick={startAmrap} fullWidth size="lg" disabled={isPreview}>
                      <Play size={20} className="mr-2" />
                      {isPreview ? 'Preview Only' : 'Start Timer'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="text-center space-y-3">
                      <div className="flex items-center justify-center gap-2 text-primary">
                        <Timer size={20} />
                        <span className="text-sm font-medium">Time Remaining</span>
                      </div>
                      <p className="text-5xl font-bold text-foreground">{formatTime(amrapTimer || 0)}</p>
                    </div>

                    {/* Round Counter */}
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground text-center block">
                        Rounds Completed
                      </label>
                      <div className="flex items-center justify-center gap-4">
                        <button
                          onClick={() => setAmrapReps(Math.max(0, amrapReps - 1))}
                          className="w-14 h-14 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                        >
                          <Minus size={24} />
                        </button>
                        <span className="text-4xl font-bold text-foreground w-20 text-center">{amrapReps}</span>
                        <button
                          onClick={() => {
                            setAmrapReps(amrapReps + 1);
                            haptic('light');
                          }}
                          className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white hover:bg-primary/80 transition-colors touch-target"
                        >
                          <Plus size={24} />
                        </button>
                      </div>
                    </div>

                    <Button onClick={completeAmrapExercise} fullWidth size="lg">
                      Complete AMRAP
                    </Button>
                  </>
                )}
              </>
            ) : isEmom ? (
              // EMOM interface
              <>
                {!emomRunning && emomTimer === null ? (
                  <>
                    <div className="text-center space-y-2">
                      <p className="text-sm text-muted-foreground">EMOM: Every Minute On the Minute</p>
                      <p className="text-sm text-muted-foreground">{currentExercise.reps} reps/min × {currentExercise.timeCap ? Math.floor(currentExercise.timeCap / 60) : currentExercise.sets} minutes</p>
                    </div>

                    {/* Weight Input (if exercise has weight) */}
                    {currentExercise.weightValue > 0 && (
                      <div className="space-y-2">
                        <label className="text-sm text-muted-foreground text-center block">
                          Weight (lbs)
                        </label>
                        <div className="flex items-center justify-center gap-4">
                          <button
                            onClick={() => setWeight(Math.max(0, weight - 5))}
                            className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                          >
                            <Minus size={20} />
                          </button>
                          <input
                            type="number"
                            value={weight}
                            onChange={(e) => setWeight(Number(e.target.value))}
                            className="w-24 text-center text-3xl font-bold bg-transparent text-foreground focus:outline-none"
                          />
                          <button
                            onClick={() => setWeight(weight + 5)}
                            className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    )}

                    <Button onClick={startEmom} fullWidth size="lg" disabled={isPreview}>
                      <Play size={20} className="mr-2" />
                      {isPreview ? 'Preview Only' : 'Start Timer'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="text-center space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Minute {emomRound + 1} of {currentExercise.timeCap ? Math.floor(currentExercise.timeCap / 60) : currentExercise.sets} • {currentExercise.reps} reps
                      </p>
                      <div className="flex items-center justify-center gap-2 text-primary">
                        <Timer size={20} />
                        <span className="text-sm font-medium">Time Remaining</span>
                      </div>
                      <p className="text-5xl font-bold text-foreground">{formatTime(emomTimer || 0)}</p>
                    </div>
                    <Button onClick={completeEmomExercise} fullWidth size="lg">
                      Complete EMOM
                    </Button>
                  </>
                )}
              </>
            ) : isTabata ? (
              // Tabata interface
              <>
                {!tabataRunning && tabataTimer === null ? (
                  <>
                    <div className="text-center space-y-2">
                      <p className="text-sm text-muted-foreground">Tabata: High Intensity Interval Training</p>
                      <p className="text-lg text-foreground">20 seconds work / 10 seconds rest</p>
                      <p className="text-sm text-muted-foreground">{currentExercise.sets} rounds</p>
                    </div>

                    {/* Weight Input (if exercise has weight) */}
                    {currentExercise.weightValue > 0 && (
                      <div className="space-y-2">
                        <label className="text-sm text-muted-foreground text-center block">
                          Weight (lbs)
                        </label>
                        <div className="flex items-center justify-center gap-4">
                          <button
                            onClick={() => setWeight(Math.max(0, weight - 5))}
                            className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                          >
                            <Minus size={20} />
                          </button>
                          <input
                            type="number"
                            value={weight}
                            onChange={(e) => setWeight(Number(e.target.value))}
                            className="w-24 text-center text-3xl font-bold bg-transparent text-foreground focus:outline-none"
                          />
                          <button
                            onClick={() => setWeight(weight + 5)}
                            className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    )}

                    <Button onClick={startTabata} fullWidth size="lg" disabled={isPreview}>
                      <Play size={20} className="mr-2" />
                      {isPreview ? 'Preview Only' : 'Start Timer'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="text-center space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Round {tabataRound + 1} of {currentExercise.sets}
                      </p>
                      <div className={`inline-block px-6 py-2 rounded-full text-lg font-bold ${
                        tabataPhase === 'work' 
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {tabataPhase === 'work' ? 'WORK!' : 'REST'}
                      </div>
                      <p className="text-6xl font-bold text-foreground">{tabataTimer}</p>
                    </div>
                    <Button onClick={completeTabataExercise} fullWidth size="lg">
                      Complete Tabata
                    </Button>
                  </>
                )}
              </>
            ) : (
              // Strength exercise interface (including tempo)
              <>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Set {currentSets.length + 1} of {currentExercise.sets}</p>
                  {isTempo && currentExercise.tempo && (
                    <p className="text-xs text-primary mt-1">
                      Remember: {currentExercise.tempo.split('-').map((t, i) => 
                        i === 0 ? `${t}s down` : i === 1 ? `${t}s pause` : i === 2 ? `${t}s up` : `${t}s pause`
                      ).join(' → ')}
                    </p>
                  )}
                </div>

                {/* Weight Input */}
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground text-center block">
                    Weight (lbs)
                  </label>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={() => setWeight(Math.max(0, weight - 5))}
                      className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                    >
                      <Minus size={20} />
                    </button>
                    <input
                      type="number"
                      value={weight}
                      onChange={(e) => setWeight(Number(e.target.value))}
                      className="w-24 text-center text-3xl font-bold bg-transparent text-foreground focus:outline-none"
                    />
                    <button
                      onClick={() => setWeight(weight + 5)}
                      className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                </div>

                {/* Reps Input */}
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground text-center block">
                    Reps
                  </label>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={() => setReps(Math.max(0, reps - 1))}
                      className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                    >
                      <Minus size={20} />
                    </button>
                    <input
                      type="number"
                      value={reps}
                      onChange={(e) => setReps(Number(e.target.value))}
                      className="w-24 text-center text-3xl font-bold bg-transparent text-foreground focus:outline-none"
                    />
                    <button
                      onClick={() => setReps(reps + 1)}
                      className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors touch-target"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                </div>

                {/* Log Set Button */}
                <Button onClick={logSet} fullWidth size="lg" disabled={isPreview}>
                  {isPreview ? 'Preview Only' : 'Log Set'}
                </Button>
              </>
            )}
          </div>
        )}

         {/* All sets complete for this exercise */}
         {isExerciseComplete && (
           <div className={`rounded-xl p-4 space-y-3 ${
             currentExerciseIndex === exercises.length - 1 ? 'bg-primary/10' : 'bg-success/10'
           }`}>
             <div className={`flex items-center justify-center gap-2 ${
               currentExerciseIndex === exercises.length - 1 ? 'text-primary' : 'text-success'
             }`}>
               <div className="text-2xl">✓</div>
               <p className="font-medium">
                 {currentExerciseIndex === exercises.length - 1 ? 'Workout Complete!' : 'Exercise Complete!'}
               </p>
             </div>
             {currentExerciseIndex < exercises.length - 1 ? (
               <Button
                 onClick={() => {
                   setCurrentExerciseIndex(currentExerciseIndex + 1);
                   setRestTimer(null);
                 }}
                 fullWidth
                 size="lg"
               >
                 <span className="flex items-center justify-center gap-2">
                   Next
                   <ChevronRight size={20} />
                 </span>
               </Button>
             ) : (
               // Show button to view/generate analysis on last exercise if workout is completed and has adjustment
               // Use adjustmentIdForChat for just-completed workouts, pendingAdjustmentId for viewing completed workouts
               (workoutCompleted && adjustmentIdForChat || workoutStatus === 'completed' && pendingAdjustmentId) && (
                 <Button
                   onClick={() => {
                     const adjId = adjustmentIdForChat || pendingAdjustmentId;
                     // If analysis exists and we have a chat session, go to that session
                     // Otherwise, create new analysis
                     if (hasAnalysis && chatSessionId) {
                       router.push(`/chat/post_workout?session=${chatSessionId}`);
                     } else {
                       router.push(`/chat/post_workout?adjustmentId=${adjId}`);
                     }
                   }}
                   fullWidth
                   size="lg"
                 >
                   {hasAnalysis ? 'View Workout Analysis' : 'Generate Analysis'}
                 </Button>
               )
             )}
           </div>
         )}

         {/* Show analysis button for already completed workouts (viewing mode) */}
         {/* Only show if NOT on the last exercise with it complete (to avoid duplicate with completion section) */}
         {workoutStatus === 'completed' && pendingAdjustmentId && !(currentExerciseIndex === exercises.length - 1 && isExerciseComplete) && (
           <div className="rounded-xl p-4 space-y-3 bg-surface">
             <Button
               onClick={() => {
                 // If analysis exists and we have a chat session, go to that session
                 // Otherwise, create new analysis
                 if (hasAnalysis && chatSessionId) {
                   router.push(`/chat/post_workout?session=${chatSessionId}`);
                 } else {
                   router.push(`/chat/post_workout?adjustmentId=${pendingAdjustmentId}`);
                 }
               }}
               fullWidth
               size="lg"
               variant="secondary"
             >
               {hasAnalysis ? 'View Workout Analysis' : 'Generate Analysis'}
             </Button>
           </div>
         )}
       </div>
    </div>
  );
}
