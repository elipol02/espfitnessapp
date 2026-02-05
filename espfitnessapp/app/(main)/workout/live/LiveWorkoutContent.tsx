'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Minus, Check, Timer, ChevronRight, Play, Edit2, X } from 'lucide-react';
import { Button } from '@/app/components/Button';
import { LoadingSpinner } from '@/app/components/LoadingSpinner';
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
  workoutDate,
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
  workoutDate?: Date | string;
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
  const [saving, setSaving] = useState(false);
  
  // Edit mode state
  const [editingSetIndex, setEditingSetIndex] = useState<number | null>(null);
  const [editWeight, setEditWeight] = useState(0);
  const [editReps, setEditReps] = useState(0);
  const [editDistance, setEditDistance] = useState(0);
  
  // Timer state - using start times instead of countdown values
  const [restTimerStart, setRestTimerStart] = useState<number | null>(null);
  const [restTimerDuration, setRestTimerDuration] = useState<number>(0);
  const [cardioTimerStart, setCardioTimerStart] = useState<number | null>(null);
  const [cardioTimerDuration, setCardioTimerDuration] = useState<number>(0);
  
  // Interval state
  const [intervalRound, setIntervalRound] = useState(0);
  const [intervalPhaseIndex, setIntervalPhaseIndex] = useState(0);
  const [intervalTimerStart, setIntervalTimerStart] = useState<number | null>(null);
  const [intervalTimerDuration, setIntervalTimerDuration] = useState<number>(0);
  const [intervalRunning, setIntervalRunning] = useState(false);
  
  // AMRAP state
  const [amrapTimerStart, setAmrapTimerStart] = useState<number | null>(null);
  const [amrapTimerDuration, setAmrapTimerDuration] = useState<number>(0);
  const [amrapReps, setAmrapReps] = useState(0);
  const [amrapRunning, setAmrapRunning] = useState(false);
  
  // EMOM state
  const [emomRound, setEmomRound] = useState(0);
  const [emomTimerStart, setEmomTimerStart] = useState<number | null>(null);
  const [emomTimerDuration, setEmomTimerDuration] = useState<number>(0);
  const [emomRunning, setEmomRunning] = useState(false);
  
  // Tabata state
  const [tabataRound, setTabataRound] = useState(0);
  const [tabataPhase, setTabataPhase] = useState<'work' | 'rest'>('work');
  const [tabataTimerStart, setTabataTimerStart] = useState<number | null>(null);
  const [tabataTimerDuration, setTabataTimerDuration] = useState<number>(0);
  const [tabataRunning, setTabataRunning] = useState(false);
  
  // Current timer values (calculated from start times)
  const [restTimer, setRestTimer] = useState<number | null>(null);
  const [cardioTimer, setCardioTimer] = useState<number | null>(null);
  const [intervalTimer, setIntervalTimer] = useState<number | null>(null);
  const [amrapTimer, setAmrapTimer] = useState<number | null>(null);
  const [emomTimer, setEmomTimer] = useState<number | null>(null);
  const [tabataTimer, setTabataTimer] = useState<number | null>(null);

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

  // localStorage key for this workout's timer state
  const timerStateKey = `workout-timers-${workoutLogId}`;

  // Load timer state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem(timerStateKey);
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        if (state.restTimerStart) {
          setRestTimerStart(state.restTimerStart);
          setRestTimerDuration(state.restTimerDuration || 0);
        }
        if (state.cardioTimerStart) {
          setCardioTimerStart(state.cardioTimerStart);
          setCardioTimerDuration(state.cardioTimerDuration || 0);
        }
        if (state.intervalTimerStart) {
          setIntervalTimerStart(state.intervalTimerStart);
          setIntervalTimerDuration(state.intervalTimerDuration || 0);
          setIntervalRunning(state.intervalRunning || false);
          setIntervalRound(state.intervalRound || 0);
          setIntervalPhaseIndex(state.intervalPhaseIndex || 0);
        }
        if (state.amrapTimerStart) {
          setAmrapTimerStart(state.amrapTimerStart);
          setAmrapTimerDuration(state.amrapTimerDuration || 0);
          setAmrapRunning(state.amrapRunning || false);
          setAmrapReps(state.amrapReps || 0);
        }
        if (state.emomTimerStart) {
          setEmomTimerStart(state.emomTimerStart);
          setEmomTimerDuration(state.emomTimerDuration || 0);
          setEmomRunning(state.emomRunning || false);
          setEmomRound(state.emomRound || 0);
        }
        if (state.tabataTimerStart) {
          setTabataTimerStart(state.tabataTimerStart);
          setTabataTimerDuration(state.tabataTimerDuration || 0);
          setTabataRunning(state.tabataRunning || false);
          setTabataRound(state.tabataRound || 0);
          setTabataPhase(state.tabataPhase || 'work');
        }
      } catch (error) {
        console.error('Failed to load timer state:', error);
      }
    }
  }, [timerStateKey]);

  // Save timer state to localStorage whenever it changes
  useEffect(() => {
    const state = {
      restTimerStart,
      restTimerDuration,
      cardioTimerStart,
      cardioTimerDuration,
      intervalTimerStart,
      intervalTimerDuration,
      intervalRunning,
      intervalRound,
      intervalPhaseIndex,
      amrapTimerStart,
      amrapTimerDuration,
      amrapRunning,
      amrapReps,
      emomTimerStart,
      emomTimerDuration,
      emomRunning,
      emomRound,
      tabataTimerStart,
      tabataTimerDuration,
      tabataRunning,
      tabataRound,
      tabataPhase,
    };
    localStorage.setItem(timerStateKey, JSON.stringify(state));
  }, [
    timerStateKey,
    restTimerStart,
    restTimerDuration,
    cardioTimerStart,
    cardioTimerDuration,
    intervalTimerStart,
    intervalTimerDuration,
    intervalRunning,
    intervalRound,
    intervalPhaseIndex,
    amrapTimerStart,
    amrapTimerDuration,
    amrapRunning,
    amrapReps,
    emomTimerStart,
    emomTimerDuration,
    emomRunning,
    emomRound,
    tabataTimerStart,
    tabataTimerDuration,
    tabataRunning,
    tabataRound,
    tabataPhase,
  ]);

  // Clear timer state from localStorage when workout is completed
  useEffect(() => {
    if (workoutCompleted) {
      localStorage.removeItem(timerStateKey);
    }
  }, [workoutCompleted, timerStateKey]);

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
        // Refresh router cache so calendar shows updated completion status
        router.refresh();
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
      setIntervalTimerStart(null);
      setIntervalTimerDuration(0);
      setIntervalTimer(null);
      setIntervalRunning(false);
      setAmrapTimerStart(null);
      setAmrapTimerDuration(0);
      setAmrapTimer(null);
      setAmrapReps(0);
      setAmrapRunning(false);
      setEmomRound(0);
      setEmomTimerStart(null);
      setEmomTimerDuration(0);
      setEmomTimer(null);
      setEmomRunning(false);
      setTabataRound(0);
      setTabataPhase('work');
      setTabataTimerStart(null);
      setTabataTimerDuration(0);
      setTabataTimer(null);
      setTabataRunning(false);
    }
  }, [currentExercise, userBodyweight, calculateTargetWeight]);

  // Rest timer - calculate remaining time based on start time
  useEffect(() => {
    if (restTimerStart === null) {
      setRestTimer(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - restTimerStart) / 1000);
      const remaining = Math.max(0, restTimerDuration - elapsed);
      
      if (remaining <= 0) {
        setRestTimer(null);
        setRestTimerStart(null);
        setRestTimerDuration(0);
        haptic('medium');
      } else {
        setRestTimer(remaining);
      }
    };

    // Update immediately
    updateTimer();

    // Update every 100ms for smooth display
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [restTimerStart, restTimerDuration]);

  // Cardio timer - calculate remaining time based on start time
  useEffect(() => {
    if (cardioTimerStart === null) {
      setCardioTimer(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - cardioTimerStart) / 1000);
      const remaining = Math.max(0, cardioTimerDuration - elapsed);
      
      if (remaining <= 0) {
        setCardioTimer(null);
        setCardioTimerStart(null);
        setCardioTimerDuration(0);
        haptic('medium');
      } else {
        setCardioTimer(remaining);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [cardioTimerStart, cardioTimerDuration]);

  // Interval timer - calculate remaining time based on start time
  useEffect(() => {
    if (intervalTimerStart === null || !intervalRunning || !currentExercise?.intervals) {
      setIntervalTimer(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - intervalTimerStart) / 1000);
      const remaining = Math.max(0, intervalTimerDuration - elapsed);
      
      if (remaining <= 0) {
        haptic('medium');
        const intervals = currentExercise.intervals;
        if (!intervals) return;
        
        const nextPhaseIndex = intervalPhaseIndex + 1;
        
        if (nextPhaseIndex >= intervals.phases.length) {
          // End of round
          const nextRound = intervalRound + 1;
          if (nextRound >= intervals.rounds) {
            // All rounds complete
            setIntervalRunning(false);
            setIntervalTimer(null);
            setIntervalTimerStart(null);
            setIntervalTimerDuration(0);
            completeIntervalExercise();
          } else {
            // Next round
            setIntervalRound(nextRound);
            setIntervalPhaseIndex(0);
            const newDuration = intervals.phases[0].duration;
            setIntervalTimerStart(Date.now());
            setIntervalTimerDuration(newDuration);
          }
        } else {
          // Next phase
          setIntervalPhaseIndex(nextPhaseIndex);
          const newDuration = intervals.phases[nextPhaseIndex].duration;
          setIntervalTimerStart(Date.now());
          setIntervalTimerDuration(newDuration);
        }
      } else {
        setIntervalTimer(remaining);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [intervalTimerStart, intervalTimerDuration, intervalRunning, intervalPhaseIndex, intervalRound, currentExercise]);

  // AMRAP timer - calculate remaining time based on start time
  useEffect(() => {
    if (amrapTimerStart === null || !amrapRunning) {
      setAmrapTimer(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - amrapTimerStart) / 1000);
      const remaining = Math.max(0, amrapTimerDuration - elapsed);
      
      if (remaining <= 0) {
        haptic('medium');
        setAmrapRunning(false);
        setAmrapTimer(null);
        setAmrapTimerStart(null);
        setAmrapTimerDuration(0);
        completeAmrapExercise();
      } else {
        setAmrapTimer(remaining);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [amrapTimerStart, amrapTimerDuration, amrapRunning]);

  // EMOM timer - calculate remaining time based on start time
  useEffect(() => {
    if (emomTimerStart === null || !emomRunning || !currentExercise) {
      setEmomTimer(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - emomTimerStart) / 1000);
      const remaining = Math.max(0, emomTimerDuration - elapsed);
      
      if (remaining <= 0) {
        haptic('medium');
        const nextRound = emomRound + 1;
        const totalRounds = currentExercise.timeCap ? Math.floor(currentExercise.timeCap / 60) : currentExercise.sets;
        if (nextRound >= totalRounds) {
          // All rounds complete
          setEmomRunning(false);
          setEmomTimer(null);
          setEmomTimerStart(null);
          setEmomTimerDuration(0);
          completeEmomExercise();
        } else {
          // Next minute
          setEmomRound(nextRound);
          setEmomTimerStart(Date.now());
          setEmomTimerDuration(60);
        }
      } else {
        setEmomTimer(remaining);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [emomTimerStart, emomTimerDuration, emomRunning, emomRound, currentExercise]);

  // Tabata timer - calculate remaining time based on start time
  useEffect(() => {
    if (tabataTimerStart === null || !tabataRunning || !currentExercise) {
      setTabataTimer(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - tabataTimerStart) / 1000);
      const remaining = Math.max(0, tabataTimerDuration - elapsed);
      
      if (remaining <= 0) {
        haptic('light');
        if (tabataPhase === 'work') {
          // Switch to rest
          setTabataPhase('rest');
          setTabataTimerStart(Date.now());
          setTabataTimerDuration(10);
        } else {
          // Switch to work or finish
          const nextRound = tabataRound + 1;
          if (nextRound >= currentExercise.sets) {
            // All rounds complete
            haptic('medium');
            setTabataRunning(false);
            setTabataTimer(null);
            setTabataTimerStart(null);
            setTabataTimerDuration(0);
            completeTabataExercise();
          } else {
            setTabataRound(nextRound);
            setTabataPhase('work');
            setTabataTimerStart(Date.now());
            setTabataTimerDuration(20);
          }
        }
      } else {
        setTabataTimer(remaining);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [tabataTimerStart, tabataTimerDuration, tabataRunning, tabataPhase, tabataRound, currentExercise]);

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
    setCardioTimerStart(Date.now());
    setCardioTimerDuration(durationSeconds);
  };

  const completeTimeBasedExercise = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    // Always log the full duration (whether timer completed naturally or was skipped)
    const fullDurationMinutes = currentExercise.duration || currentExercise.reps;
    const fullDurationSeconds = fullDurationMinutes * 60;
    
    const newSets = [{ reps: fullDurationMinutes, weight: 0 }];
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
          duration: fullDurationSeconds, // Store full duration in seconds
        }),
      });
    } catch (error) {
      console.error('Failed to save set:', error);
    }

    // Reset timer
    setCardioTimerStart(null);
    setCardioTimerDuration(0);
    setCardioTimer(null);
  };

  // Distance-based exercise completion
  const logDistanceSet = async () => {
    if (!currentExercise || isPreview) return;

    haptic('light');

    // For distance exercises, store distance in the reps field so repsPerSet contains distance values
    const newSets = [...currentSets, { reps: distance, weight, distance }];
    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, newSets);
    setCompletedSets(newMap);

    // Start rest timer immediately (while save runs in background) - but not if this was the last set
    const isLastSet = newSets.length >= currentExercise.sets;
    if (!isLastSet) {
      setRestTimerStart(Date.now());
      setRestTimerDuration(currentExercise.restTime);
    }

    // Save to database (fire-and-forget; timer already running)
    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          // For distance exercises, reps contains the distance value per set
          sets: newSets.map(s => ({ reps: s.reps, weight: s.weight })),
          distance: distance, // Also send last distance for backward compatibility
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
    setIntervalTimerStart(Date.now());
    setIntervalTimerDuration(currentExercise.intervals.phases[0].duration);
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
    setAmrapTimerStart(Date.now());
    setAmrapTimerDuration(currentExercise.timeCap);
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
    setEmomTimerStart(Date.now());
    setEmomTimerDuration(60);
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
    setTabataTimerStart(Date.now());
    setTabataTimerDuration(20);
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
      setRestTimerStart(Date.now());
      setRestTimerDuration(currentExercise.restTime);
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

  const startEditSet = (index: number, set: CompletedSet) => {
    setEditingSetIndex(index);
    setEditWeight(set.weight);
    setEditReps(set.reps);
    setEditDistance(set.distance || 0);
  };

  const cancelEditSet = () => {
    setEditingSetIndex(null);
    setEditWeight(0);
    setEditReps(0);
    setEditDistance(0);
  };

  const saveEditSet = async () => {
    if (!currentExercise || editingSetIndex === null || isPreview) return;

    haptic('light');

    // Update the set in the completedSets map
    const updatedSets = [...currentSets];
    // For distance exercises, store distance in the reps field
    updatedSets[editingSetIndex] = {
      reps: isDistanceBased ? editDistance : editReps,
      weight: editWeight,
      distance: isDistanceBased ? editDistance : updatedSets[editingSetIndex].distance,
      time: updatedSets[editingSetIndex].time,
    };

    const newMap = new Map(completedSets);
    newMap.set(currentExercise.id, updatedSets);
    setCompletedSets(newMap);

    // Save to database
    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutLogId,
          exerciseId: currentExercise.id,
          // For distance exercises, reps contains the distance value per set
          sets: updatedSets.map(s => ({ reps: s.reps, weight: s.weight })),
          distance: isDistanceBased ? editDistance : undefined,
        }),
      });
    } catch (error) {
      console.error('Failed to update set:', error);
    }

    // Exit edit mode
    setEditingSetIndex(null);
    setEditWeight(0);
    setEditReps(0);
    setEditDistance(0);
  };

  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  if (!currentExercise) {
    return null;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Loading overlay when finishing workout */}
      {saving && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 pb-16">
          <div className="flex flex-col items-center gap-4">
            <LoadingSpinner size="lg" className="text-primary" />
            <p className="text-muted-foreground">Finishing workout...</p>
          </div>
        </div>
      )}
      
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
              {workoutDate 
                ? new Date(workoutDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              }
            </p>
            <h1
              className="font-bold capitalize"
              style={{ color: workoutDay.workoutColor }}
            >
              {workoutDay.workoutType}
            </h1>
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
                  setRestTimerStart(null);
                  setRestTimerDuration(0);
                  setRestTimer(null);
                }}
                className={`
                  flex-shrink-0 px-3 py-2 rounded-lg transition-colors text-left relative
                  ${isCurrent 
                    ? 'bg-primary text-white' 
                    : isComplete
                    ? 'bg-success/20 text-success'
                    : 'bg-surface text-muted-foreground hover:text-foreground'
                  }
                `}
              >
                <div className="flex items-center gap-1.5">
                  <div className="text-xs font-medium">{index + 1}</div>
                  {isComplete && (
                    <Check size={12} className={isCurrent ? 'text-white' : 'text-success'} />
                  )}
                </div>
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
      <div className="flex-1 overflow-y-auto px-5 py-6 pb-24 space-y-6">
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

              // Don't allow editing single-completion exercises
              const canEdit = !isSingleCompletionType && !isPreview;

              // If this set is being edited, show edit interface
              if (editingSetIndex === i) {
                return (
                  <div key={i} className="bg-surface rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{getSetLabel()}</span>
                      <button
                        onClick={cancelEditSet}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {/* Weight Input */}
                    {!isTimeBased && (
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground text-center block">
                          Weight (lbs)
                        </label>
                        <div className="flex items-center justify-center gap-3">
                          <button
                            onClick={() => setEditWeight(Math.max(0, editWeight - 5))}
                            className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors"
                          >
                            <Minus size={16} />
                          </button>
                          <input
                            type="number"
                            value={editWeight}
                            onChange={(e) => setEditWeight(Number(e.target.value))}
                            className="w-20 text-center text-2xl font-bold bg-transparent text-foreground focus:outline-none"
                          />
                          <button
                            onClick={() => setEditWeight(editWeight + 5)}
                            className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Reps Input */}
                    {!isTimeBased && !isDistanceBased && (
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground text-center block">
                          Reps
                        </label>
                        <div className="flex items-center justify-center gap-3">
                          <button
                            onClick={() => setEditReps(Math.max(0, editReps - 1))}
                            className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors"
                          >
                            <Minus size={16} />
                          </button>
                          <input
                            type="number"
                            value={editReps}
                            onChange={(e) => setEditReps(Number(e.target.value))}
                            className="w-20 text-center text-2xl font-bold bg-transparent text-foreground focus:outline-none"
                          />
                          <button
                            onClick={() => setEditReps(editReps + 1)}
                            className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Distance Input */}
                    {isDistanceBased && (
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground text-center block">
                          Distance ({currentExercise.distanceUnit || 'feet'})
                        </label>
                        <div className="flex items-center justify-center gap-3">
                          <button
                            onClick={() => setEditDistance(Math.max(0, editDistance - 5))}
                            className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors"
                          >
                            <Minus size={16} />
                          </button>
                          <input
                            type="number"
                            value={editDistance}
                            onChange={(e) => setEditDistance(Number(e.target.value))}
                            className="w-20 text-center text-2xl font-bold bg-transparent text-foreground focus:outline-none"
                          />
                          <button
                            onClick={() => setEditDistance(editDistance + 5)}
                            className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-surface-elevated transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Save Button */}
                    <Button onClick={saveEditSet} fullWidth size="sm">
                      Save Changes
                    </Button>
                  </div>
                );
              }

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
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{getSetDisplay()}</span>
                    {canEdit && (
                      <button
                        onClick={() => startEditSet(i, set)}
                        className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                    )}
                  </div>
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
              onClick={() => {
                setRestTimerStart(null);
                setRestTimerDuration(0);
                setRestTimer(null);
              }}
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
                          setIntervalTimerStart(null);
                          setIntervalTimerDuration(0);
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
             workoutCompleted || workoutStatus === 'completed' ? 'bg-primary/10' : 'bg-success/10'
           }`}>
             <div className={`flex items-center justify-center gap-2 ${
               workoutCompleted || workoutStatus === 'completed' ? 'text-primary' : 'text-success'
             }`}>
               <div className="text-2xl">✓</div>
               <p className="font-medium">
                 {workoutCompleted || workoutStatus === 'completed' ? 'Workout Complete!' : 'Exercise Complete!'}
               </p>
             </div>
             {/* Show Next button only if not on last exercise AND workout not completed */}
             {currentExerciseIndex < exercises.length - 1 && !workoutCompleted && workoutStatus !== 'completed' ? (
              <Button
                onClick={() => {
                  setCurrentExerciseIndex(currentExerciseIndex + 1);
                  setRestTimerStart(null);
                  setRestTimerDuration(0);
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
               // Show analysis button if workout is completed and has adjustment
               (workoutCompleted && adjustmentIdForChat || workoutStatus === 'completed' && pendingAdjustmentId) && (
                 <Button
                   onClick={() => {
                     const adjId = adjustmentIdForChat || pendingAdjustmentId;
                     // If analysis exists and we have a chat session, go to that session
                     // Otherwise, create new analysis
                     if (hasAnalysis && chatSessionId) {
                       router.push(`/chat?session=${chatSessionId}`);
                     } else {
                       router.push(`/chat?adjustmentId=${adjId}`);
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
       </div>
    </div>
  );
}
