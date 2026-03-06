'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Check, Timer,
  Dumbbell, Footprints, Clock, Play, Pause, RotateCcw, Pencil,
} from 'lucide-react';
import { Button } from '@/app/components/Button';
import { LoadingSpinner } from '@/app/components/LoadingSpinner';
import { startRestTimer, useRestTimer } from '@/app/components/RestTimerBadge';
import type {
  ExerciseType,
  StrengthConfig,
  DistanceConfig,
  TimeConfig,
  AmrapConfig,
  EmomConfig,
  RoundBlockConfig,
  TabataConfig,
  SuggestionMap,
  StrengthEntryData,
  DistanceEntryData,
  TimeEntryData,
  RoundsEntryData,
  ExerciseEntryData,
} from '@/app/types';

// ─── Shared helpers ──────────────────────────────────────────────────────────

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ─── Interval Timer ──────────────────────────────────────────────────────────

type IntervalTimerConfig =
  | { kind: 'countdown'; totalSeconds: number }
  | { kind: 'amrap';     totalSeconds: number }
  | { kind: 'emom';      totalIntervals: number; intervalSeconds: number }
  | { kind: 'tabata';    rounds: number; workSeconds: number; restSeconds: number };

interface Segment {
  label: string;
  subLabel?: string;
  duration: number;
  phase: 'work' | 'rest' | 'main';
}

function buildSegments(config: IntervalTimerConfig): Segment[] {
  switch (config.kind) {
    case 'countdown':
      return [{ label: '', duration: config.totalSeconds, phase: 'main' }];
    case 'amrap':
      return [{ label: 'AMRAP', duration: config.totalSeconds, phase: 'main' }];
    case 'emom':
      return Array.from({ length: config.totalIntervals }, (_, i) => ({
        label: `Interval ${i + 1} / ${config.totalIntervals}`,
        duration: config.intervalSeconds,
        phase: 'work' as const,
      }));
    case 'tabata': {
      const segs: Segment[] = [];
      for (let r = 0; r < config.rounds; r++) {
        segs.push({ label: 'WORK', subLabel: `Round ${r + 1} / ${config.rounds}`, duration: config.workSeconds, phase: 'work' });
        segs.push({ label: 'REST', subLabel: `Round ${r + 1} / ${config.rounds}`, duration: config.restSeconds, phase: 'rest' });
      }
      return segs;
    }
  }
}

type TimerStatus = 'idle' | 'get-ready' | 'active' | 'paused' | 'done';

interface FinishData {
  elapsedSeconds: number;
  segmentsCompleted: number;
}

function IntervalTimer({
  config,
  onFinish,
  resetKey,
  adjustable = false,
  onDurationChange,
}: {
  config: IntervalTimerConfig;
  onFinish?: (data: FinishData) => void;
  resetKey?: number;
  adjustable?: boolean;
  onDurationChange?: (seconds: number) => void;
}) {
  // Which kinds support adjustable
  const isAdjustableSingle = adjustable && (config.kind === 'countdown' || config.kind === 'amrap');
  const isAdjustableEmom   = adjustable && config.kind === 'emom';

  // Local values — only meaningful when adjustable
  const [localDuration, setLocalDuration] = useState(
    config.kind === 'countdown' || config.kind === 'amrap' ? config.totalSeconds : 0
  );
  const [localIntervals, setLocalIntervals] = useState(
    config.kind === 'emom' ? config.totalIntervals : 0
  );

  // Segments rebuild from local values when adjustable (safe — only changes while idle)
  const segments = useMemo(() => {
    if (isAdjustableSingle) {
      const label = config.kind === 'amrap' ? 'AMRAP' : '';
      return [{ label, duration: localDuration, phase: 'main' as const }];
    }
    if (isAdjustableEmom && config.kind === 'emom') {
      return Array.from({ length: localIntervals }, (_, i) => ({
        label: `Interval ${i + 1} / ${localIntervals}`,
        duration: config.intervalSeconds,
        phase: 'work' as const,
      })) as Segment[];
    }
    return buildSegments(config);
  }, [config, isAdjustableSingle, isAdjustableEmom, localDuration, localIntervals]);

  const [status, setStatus] = useState<TimerStatus>('idle');
  const [getReadyCount, setGetReadyCount] = useState(5);
  const [segIdx, setSegIdx] = useState(0);
  const [remaining, setRemaining] = useState(segments[0]?.duration ?? 0);

  const segIdxRef             = useRef(0);
  const pausedRemainingRef    = useRef(segments[0]?.duration ?? 0);
  const startTimeRef          = useRef(0);
  const totalElapsedRef       = useRef(0);
  const segsCompletedRef      = useRef(0);
  const onFinishRef           = useRef(onFinish);
  const onDurationChangeRef   = useRef(onDurationChange);
  onFinishRef.current         = onFinish;
  onDurationChangeRef.current = onDurationChange;

  const doReset = useCallback((dur?: number) => {
    const d = dur ?? segments[0]?.duration ?? 0;
    setStatus('idle');
    setGetReadyCount(5);
    segIdxRef.current          = 0;
    setSegIdx(0);
    pausedRemainingRef.current = d;
    setRemaining(d);
    totalElapsedRef.current    = 0;
    segsCompletedRef.current   = 0;
  }, [segments]);

  // Reset when resetKey changes
  useEffect(() => {
    doReset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // 5-second get-ready countdown
  useEffect(() => {
    if (status !== 'get-ready') return;
    if (getReadyCount <= 0) {
      segIdxRef.current          = 0;
      pausedRemainingRef.current = segments[0].duration;
      startTimeRef.current       = Date.now();
      totalElapsedRef.current    = 0;
      segsCompletedRef.current   = 0;
      setSegIdx(0);
      setRemaining(segments[0].duration);
      setStatus('active');
      return;
    }
    const t = setTimeout(() => setGetReadyCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, getReadyCount, segments]);

  // Main timer tick
  useEffect(() => {
    if (status !== 'active') return;
    const id = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const rem = Math.max(0, pausedRemainingRef.current - elapsed);
      setRemaining(Math.ceil(rem));

      if (rem <= 0) {
        totalElapsedRef.current += segments[segIdxRef.current].duration;
        segsCompletedRef.current += 1;
        const next = segIdxRef.current + 1;

        if (next >= segments.length) {
          setStatus('done');
          onFinishRef.current?.({
            elapsedSeconds: Math.round(totalElapsedRef.current),
            segmentsCompleted: segsCompletedRef.current,
          });
        } else {
          segIdxRef.current          = next;
          pausedRemainingRef.current = segments[next].duration;
          startTimeRef.current       = Date.now();
          setSegIdx(next);
          setRemaining(segments[next].duration);
        }
      }
    }, 200);
    return () => clearInterval(id);
  }, [status, segments]);

  const handleStart = () => { setGetReadyCount(5); setStatus('get-ready'); };

  const handlePause = () => {
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    pausedRemainingRef.current = Math.max(0, pausedRemainingRef.current - elapsed);
    setRemaining(Math.ceil(pausedRemainingRef.current));
    setStatus('paused');
  };

  const handleResume = () => { startTimeRef.current = Date.now(); setStatus('active'); };

  const handleReset = () => {
    if (isAdjustableSingle) return doReset(localDuration);
    if (isAdjustableEmom && config.kind === 'emom') return doReset(config.intervalSeconds);
    doReset();
  };

  const adjustDuration = (delta: number) => {
    const min  = config.kind === 'amrap' ? 60 : 15;
    const next = Math.max(min, localDuration + delta);
    setLocalDuration(next);
    setRemaining(next);
    pausedRemainingRef.current = next;
    onDurationChangeRef.current?.(next);
  };

  const adjustIntervals = (delta: number) => {
    if (config.kind !== 'emom') return;
    const next = Math.max(1, localIntervals + delta);
    setLocalIntervals(next);
    // remaining stays as intervalSeconds — no change needed
  };

  const seg = segments[segIdx] ?? segments[0];

  const phaseStyle: Record<Segment['phase'], { border: string; bg: string; text: string }> = {
    work: { border: 'border-success/40', bg: 'bg-success/8', text: 'text-success'   },
    rest: { border: 'border-primary/30', bg: 'bg-primary/8', text: 'text-primary'   },
    main: { border: 'border-border',     bg: 'bg-surface',   text: 'text-foreground' },
  };

  const activePhase = (status === 'active' || status === 'paused' || status === 'done') ? seg.phase : 'main';
  const { border, bg, text } = phaseStyle[activePhase];
  const isMultiSeg = segments.length > 1;

  // Reset button shown whenever the timer has been started
  const showReset = status !== 'idle';

  return (
    <div className={`rounded-xl border transition-colors duration-300 ${border} ${bg} p-4 space-y-3`}>

      {/* Phase label (tabata/emom while running) */}
      {isMultiSeg && (status === 'active' || status === 'paused') && (
        <div className="text-center leading-tight">
          {seg.subLabel && <p className="text-xs text-muted-foreground">{seg.subLabel}</p>}
          <p className={`text-xl font-black tracking-widest uppercase ${text}`}>{seg.label}</p>
        </div>
      )}

      {/* Big display */}
      <div className="flex flex-col items-center py-1">
        {status === 'get-ready' && (
          <>
            <p className="text-xs text-muted-foreground mb-1 font-medium">Get ready…</p>
            <span className="text-7xl font-black tabular-nums text-warning">{getReadyCount}</span>
          </>
        )}
        {(status === 'active' || status === 'paused') && (
          <>
            <span className={`text-7xl font-black tabular-nums tracking-tight ${text}`}>
              {formatTime(remaining)}
            </span>
            {status === 'paused' && <p className="text-xs text-muted-foreground mt-1">Paused</p>}
          </>
        )}
        {status === 'idle' && (
          <>
            {/* Countdown / AMRAP adjustable stepper */}
            {isAdjustableSingle && (
              <div className="w-full space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => adjustDuration(config.kind === 'amrap' ? -60 : -15)}
                    className="w-11 h-11 rounded-xl bg-background border border-border flex items-center justify-center text-foreground font-bold text-lg"
                  >−</button>
                  <span className="flex-1 text-center text-5xl font-black tabular-nums text-foreground">
                    {formatTime(localDuration)}
                  </span>
                  <button
                    onClick={() => adjustDuration(config.kind === 'amrap' ? 60 : 15)}
                    className="w-11 h-11 rounded-xl bg-background border border-border flex items-center justify-center text-foreground font-bold text-lg"
                  >+</button>
                </div>
                {config.kind === 'amrap' && (
                  <p className="text-xs text-muted-foreground text-center">1 min steps</p>
                )}
              </div>
            )}

            {/* EMOM adjustable interval count stepper */}
            {isAdjustableEmom && config.kind === 'emom' && (
              <div className="w-full space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => adjustIntervals(-1)}
                    className="w-11 h-11 rounded-xl bg-background border border-border flex items-center justify-center text-foreground font-bold text-lg"
                  >−</button>
                  <div className="flex-1 text-center">
                    <div className="text-5xl font-black tabular-nums text-foreground">{localIntervals}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      intervals · {formatTime(localIntervals * config.intervalSeconds)} total
                    </div>
                  </div>
                  <button
                    onClick={() => adjustIntervals(1)}
                    className="w-11 h-11 rounded-xl bg-background border border-border flex items-center justify-center text-foreground font-bold text-lg"
                  >+</button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {formatTime(config.intervalSeconds)} each
                </p>
              </div>
            )}

            {/* Non-adjustable idle display */}
            {!isAdjustableSingle && !isAdjustableEmom && (
              <>
                <span className="text-5xl font-bold tabular-nums text-muted-foreground">
                  {formatTime(segments[0].duration)}
                </span>
                {config.kind === 'tabata' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {config.rounds} rounds · {formatTime(config.workSeconds)} work / {formatTime(config.restSeconds)} rest
                  </p>
                )}
                {config.kind === 'emom' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {config.totalIntervals} × {formatTime(config.intervalSeconds)}
                  </p>
                )}
              </>
            )}
          </>
        )}
        {status === 'done' && (
          <p className={`text-xl font-bold ${text}`}>Complete!</p>
        )}
      </div>

      {/* Segment progress dots */}
      {isMultiSeg && segments.length <= 32 && (status === 'active' || status === 'paused') && (
        <div className="flex flex-wrap justify-center gap-1">
          {segments.map((s, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i < segIdx
                  ? 'bg-success'
                  : i === segIdx
                  ? s.phase === 'work' ? 'bg-success' : s.phase === 'rest' ? 'bg-primary' : 'bg-foreground'
                  : 'bg-border'
              }`}
            />
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex justify-center gap-2">
        {status === 'idle' && (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm"
          >
            <Play size={15} fill="currentColor" /> Start
          </button>
        )}

        {status === 'get-ready' && (
          <button
            onClick={handleReset}
            className="px-5 py-2.5 rounded-xl bg-background text-muted-foreground font-medium text-sm border border-border"
          >
            Cancel
          </button>
        )}

        {status === 'active' && (
          <button
            onClick={handlePause}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-background text-foreground font-semibold text-sm border border-border"
          >
            <Pause size={15} fill="currentColor" /> Pause
          </button>
        )}

        {status === 'paused' && (
          <button
            onClick={handleResume}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm"
          >
            <Play size={15} fill="currentColor" /> Resume
          </button>
        )}

        {/* Restart always visible once timer has started */}
        {showReset && (
          <button
            onClick={handleReset}
            className="p-2.5 rounded-xl bg-background text-muted-foreground border border-border"
            aria-label="Restart"
          >
            <RotateCcw size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Exercise Records / Props ─────────────────────────────────────────────────

interface ExerciseRecord {
  id: string;
  name: string;
  exerciseType: string;
  config: Record<string, unknown>;
  progression: Record<string, unknown> | null;
  groupTag: string | null;
  order: number;
  notes: string | null;
}

interface EntryRecord {
  id: string;
  exerciseId: string;
  data: unknown;
}

interface WorkoutTypeRecord {
  id: string;
  name: string;
  color: string;
}

interface Props {
  sessionId: string;
  workoutType: WorkoutTypeRecord;
  exercises: ExerciseRecord[];
  existingEntries: EntryRecord[];
  suggestions: SuggestionMap;
  sessionStatus: string;
  userBodyweight: number | null;
  workoutDate: Date;
  readOnly?: boolean;
}

// ─── Main LiveWorkoutContent ──────────────────────────────────────────────────

export function LiveWorkoutContent({
  sessionId,
  workoutType,
  exercises,
  existingEntries,
  suggestions,
  sessionStatus,
  userBodyweight: _userBodyweight,
  workoutDate,
  readOnly = false,
}: Props) {
  const router = useRouter();

  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [entryDataMap, setEntryDataMap] = useState<Record<string, ExerciseEntryData>>(() => {
    const initial: Record<string, ExerciseEntryData> = {};
    for (const entry of existingEntries) {
      initial[entry.exerciseId] = entry.data as ExerciseEntryData;
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [workoutCompleted, setWorkoutCompleted] = useState(sessionStatus === 'completed' || readOnly);

  const currentExercise = exercises[currentExerciseIndex];
  const isFirst = currentExerciseIndex === 0;
  const isLast  = currentExerciseIndex === exercises.length - 1;

  const allExercisesComplete = useMemo(() => {
    if (exercises.length === 0) return false;
    return exercises.every((ex) => {
      const data = entryDataMap[ex.id];
      if (!data) return false;
      const type = ex.exerciseType as ExerciseType;
      if (type === 'strength' || type === 'distance' || type === 'time') {
        const d = data as StrengthEntryData | DistanceEntryData | TimeEntryData;
        return 'sets' in d && d.sets.length > 0 && d.sets.every((s: { completed?: boolean }) => s.completed);
      }
      if (type === 'amrap' || type === 'emom' || type === 'round_block' || type === 'tabata') {
        const d = data as RoundsEntryData;
        return d.roundsCompleted > 0;
      }
      return false;
    });
  }, [exercises, entryDataMap]);

  const saveEntry = useCallback(async (exerciseId: string, data: ExerciseEntryData) => {
    setSaving(true);
    try {
      await fetch('/api/workout/live/add-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, exerciseId, data }),
      });
      setEntryDataMap((prev) => ({ ...prev, [exerciseId]: data }));
    } catch (error) {
      console.error('Error saving entry:', error);
    } finally {
      setSaving(false);
    }
  }, [sessionId]);

  const finishWorkout = useCallback(async () => {
    setFinishing(true);
    try {
      const res = await fetch('/api/workout/live/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const result = await res.json();
      if (result.success) {
        setWorkoutCompleted(true);
        router.push('/home');
      }
    } catch (error) {
      console.error('Error finishing workout:', error);
    } finally {
      setFinishing(false);
    }
  }, [sessionId, router]);

  if (!currentExercise) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">No exercises in this workout.</p>
      </div>
    );
  }

  const exerciseType  = currentExercise.exerciseType as ExerciseType;
  const config        = currentExercise.config;
  const suggestion    = suggestions[currentExercise.id];
  const currentEntryData = entryDataMap[currentExercise.id];
  const restRemaining = useRestTimer();
  const timerRunning  = restRemaining !== null && restRemaining > 0;
  const strengthConfig = exerciseType === 'strength' ? config as unknown as StrengthConfig : null;
  const strengthSets   = exerciseType === 'strength' ? ((currentEntryData as StrengthEntryData | undefined)?.sets ?? []) : [];
  const showRestButton = !!(strengthConfig && strengthConfig.restSeconds > 0 && strengthSets.length > 0 && !timerRunning);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <button onClick={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={20} className="text-foreground" />
          </button>
          <div className="text-center">
            <h1 className="text-sm font-bold text-foreground">{workoutType.name}</h1>
            <p className="text-xs text-muted-foreground">
              {new Date(workoutDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            {readOnly && <span className="text-xs text-primary font-medium">Upcoming</span>}
          </div>
          {/* Wide spacer keeps center aligned and gives room for rest-timer badge */}
          <div className="w-16" />
        </div>
        {/* Progress bar */}
        <div className="flex gap-1 mt-2">
          {exercises.map((ex, idx) => {
            const hasData = !!entryDataMap[ex.id];
            return (
              <button
                key={ex.id}
                onClick={() => setCurrentExerciseIndex(idx)}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  idx === currentExerciseIndex ? 'bg-primary' : hasData ? 'bg-success' : 'bg-border'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Exercise content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        <div className="flex items-center gap-2 mb-1">
          <ExerciseIcon type={exerciseType} />
          <h2 className="text-xl font-bold text-foreground flex-1">{currentExercise.name}</h2>
          {showRestButton && (
            <button
              onClick={() => startRestTimer(strengthConfig!.restSeconds)}
              className="flex items-center gap-1 text-xs text-primary font-medium px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
            >
              <Timer size={12} /> Rest
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4 capitalize">{exerciseType.replace('_', ' ')}</p>

        {suggestion && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4">
            <p className="text-sm text-primary font-medium">{suggestion.display}</p>
          </div>
        )}
        {currentExercise.notes && (
          <div className="bg-surface rounded-lg p-3 mb-4">
            <p className="text-sm text-muted-foreground">{currentExercise.notes}</p>
          </div>
        )}

        {exerciseType === 'strength' && (
          <StrengthLogger
            key={currentExercise.id}
            config={config as unknown as StrengthConfig}
            data={currentEntryData as StrengthEntryData | undefined}
            onSave={(data) => saveEntry(currentExercise.id, data)}
            saving={saving}
            completed={workoutCompleted}
          />
        )}
        {exerciseType === 'distance' && (
          <DistanceLogger
            config={config as unknown as DistanceConfig}
            data={currentEntryData as DistanceEntryData | undefined}
            onSave={(data) => saveEntry(currentExercise.id, data)}
            saving={saving}
            completed={workoutCompleted}
          />
        )}
        {exerciseType === 'time' && (
          <TimeLogger
            config={config as unknown as TimeConfig}
            data={currentEntryData as TimeEntryData | undefined}
            onSave={(data) => saveEntry(currentExercise.id, data)}
            saving={saving}
            completed={workoutCompleted}
          />
        )}
        {(exerciseType === 'amrap' || exerciseType === 'emom' || exerciseType === 'round_block' || exerciseType === 'tabata') && (
          <RoundsLogger
            exerciseType={exerciseType}
            config={config as unknown as AmrapConfig | EmomConfig | RoundBlockConfig | TabataConfig}
            data={currentEntryData as RoundsEntryData | undefined}
            onSave={(data) => saveEntry(currentExercise.id, data)}
            saving={saving}
            completed={workoutCompleted}
          />
        )}
      </div>

      {/* Navigation + Finish */}
      <div className="fixed bottom-16 left-0 right-0 bg-background border-t border-border px-4 py-3 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentExerciseIndex((i) => Math.max(0, i - 1))}
            disabled={isFirst}
            className="p-2 rounded-lg bg-surface disabled:opacity-30"
          >
            <ChevronLeft size={20} className="text-foreground" />
          </button>

          <div className="flex-1 text-center">
            <p className="text-sm text-muted-foreground">
              {currentExerciseIndex + 1} / {exercises.length}
            </p>
          </div>

          {isLast && allExercisesComplete && !workoutCompleted ? (
            <Button onClick={finishWorkout} disabled={finishing}>
              {finishing ? <LoadingSpinner size="sm" /> : <Check size={18} />}
              <span className="ml-1">Finish Workout</span>
            </Button>
          ) : (
            <button
              onClick={() => setCurrentExerciseIndex((i) => Math.min(exercises.length - 1, i + 1))}
              disabled={isLast}
              className="p-2 rounded-lg bg-surface disabled:opacity-30"
            >
              <ChevronRight size={20} className="text-foreground" />
            </button>
          )}
        </div>

        {allExercisesComplete && !workoutCompleted && !isLast && (
          <Button onClick={finishWorkout} disabled={finishing} fullWidth className="mt-2">
            {finishing ? <LoadingSpinner size="sm" /> : <Check size={18} />}
            <span className="ml-1">Finish Workout</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function ExerciseIcon({ type }: { type: ExerciseType }) {
  switch (type) {
    case 'strength': return <Dumbbell  size={20} className="text-primary" />;
    case 'distance': return <Footprints size={20} className="text-primary" />;
    case 'time':     return <Clock     size={20} className="text-primary" />;
    default:         return <Timer     size={20} className="text-primary" />;
  }
}

// ─── Strength Logger ──────────────────────────────────────────────────────────

function SetStepper({ label, value, onChange, min = 1, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; step?: number;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1 text-center">{label}</label>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(min, value - step))} className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-foreground font-bold">-</button>
        <span className="flex-1 text-center text-lg font-bold text-foreground">{value}</span>
        <button onClick={() => onChange(value + step)} className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-foreground font-bold">+</button>
      </div>
    </div>
  );
}

function StrengthLogger({
  config, data, onSave, saving, completed,
}: {
  config: StrengthConfig;
  data: StrengthEntryData | undefined;
  onSave: (data: StrengthEntryData) => void;
  saving: boolean;
  completed: boolean;
}) {
  const targetSets = config.sets;
  const sets = data?.sets || [];
  const [reps,   setReps]   = useState(config.repsMin);
  const [weight, setWeight] = useState(config.baseWeight);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editReps,   setEditReps]   = useState(0);
  const [editWeight, setEditWeight] = useState(0);
  const restRemaining = useRestTimer();
  const timerRunning = restRemaining !== null && restRemaining > 0;

  const logSet = () => {
    onSave({ sets: [...sets, { reps, weight, weightUnit: config.weightUnit, completed: true }] });
    if (config.restSeconds > 0) startRestTimer(config.restSeconds);
  };

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditReps(sets[idx].reps);
    setEditWeight(sets[idx].weight);
  };

  const saveEdit = () => {
    if (editingIdx === null) return;
    const updated = sets.map((s, i) =>
      i === editingIdx ? { ...s, reps: editReps, weight: editWeight } : s
    );
    onSave({ sets: updated });
    setEditingIdx(null);
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-1">
          Target: {targetSets} sets × {config.repsMin}{config.repsMin !== config.repsMax ? `-${config.repsMax}` : ''} reps @ {config.weightType === 'bodyweight' || (config.weightType === 'absolute' && config.baseWeight === 0) ? 'BW' : config.weightType === 'percentage_1rm' ? `${config.baseWeight}% 1RM` : `${config.baseWeight} ${config.weightUnit}`}
        </p>
        {config.restSeconds > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Timer size={11} /> Rest: {formatTime(config.restSeconds)}
          </p>
        )}
      </div>

      {sets.length > 0 && (
        <div className="space-y-2">
          {sets.map((s, idx) => (
            <div key={idx}>
              {editingIdx === idx ? (
                <div className="bg-surface rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Edit Set {idx + 1}</p>
                  <div className="space-y-3 max-w-xs mx-auto">
                    <SetStepper label="Reps" value={editReps} onChange={setEditReps} min={1} />
                    <SetStepper label={`Weight (${s.weightUnit})`} value={editWeight} onChange={setEditWeight} min={0} step={5} />
                  </div>
                  <div className="flex gap-2 max-w-xs mx-auto w-full">
                    <button onClick={() => setEditingIdx(null)} className="flex-1 py-2 rounded-lg bg-background text-sm text-muted-foreground font-medium">Cancel</button>
                    <button onClick={saveEdit} disabled={saving} className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-surface rounded-lg p-3">
                  <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                    <Check size={14} className="text-success" />
                  </div>
                  <p className="text-sm font-medium text-foreground flex-1">
                    Set {idx + 1}: {s.reps} reps @ {s.weight} {s.weightUnit}
                  </p>
                  <button
                    onClick={() => startEdit(idx)}
                    className="w-7 h-7 rounded-lg bg-background flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sets.length < targetSets && !completed && (
        <div className="bg-surface rounded-xl p-4 space-y-4">
          <p className="text-sm font-semibold text-foreground">Set {sets.length + 1}</p>
          <div className="space-y-3 max-w-xs mx-auto">
            <SetStepper label="Reps" value={reps} onChange={setReps} min={1} />
            <SetStepper label={`Weight (${config.weightUnit})`} value={weight} onChange={setWeight} min={0} step={5} />
          </div>
          <div className="max-w-xs mx-auto w-full">
            <Button onClick={logSet} disabled={saving || timerRunning} fullWidth>
              {saving ? <LoadingSpinner size="sm" /> : 'Log Set'}
            </Button>
          </div>
        </div>
      )}

      {sets.length >= targetSets && (
        <div className="text-center py-4 text-success font-medium">All sets completed</div>
      )}
    </div>
  );
}

// ─── Distance Logger ──────────────────────────────────────────────────────────

function DistanceLogger({
  config, data, onSave, saving, completed,
}: {
  config: DistanceConfig;
  data: DistanceEntryData | undefined;
  onSave: (data: DistanceEntryData) => void;
  saving: boolean;
  completed: boolean;
}) {
  const targetSets = config.sets;
  const sets = data?.sets || [];
  const [distance, setDistance] = useState(config.distanceTarget);

  const logSet = () => {
    onSave({ sets: [...sets, { distance, distanceUnit: config.distanceUnit, completed: true }] });
    if (config.restSeconds > 0) startRestTimer(config.restSeconds);
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-1">
          Target: {targetSets} sets × {config.distanceTarget} {config.distanceUnit}
        </p>
        {config.restSeconds > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Timer size={11} /> Rest: {formatTime(config.restSeconds)}
          </p>
        )}
      </div>

      {sets.length > 0 && (
        <div className="space-y-2">
          {sets.map((s, idx) => (
            <div key={idx} className="flex items-center gap-3 bg-surface rounded-lg p-3">
              <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                <Check size={14} className="text-success" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Set {idx + 1}: {s.distance} {s.distanceUnit}
              </p>
            </div>
          ))}
        </div>
      )}

      {sets.length < targetSets && !completed && (
        <div className="bg-surface rounded-xl p-4 space-y-4">
          <p className="text-sm font-semibold text-foreground">Set {sets.length + 1}</p>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Distance ({config.distanceUnit})</label>
            <div className="flex items-center gap-2">
              <button onClick={() => setDistance((d) => Math.max(0, d - 5))} className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-foreground font-bold">-</button>
              <span className="flex-1 text-center text-lg font-bold text-foreground">{distance}</span>
              <button onClick={() => setDistance((d) => d + 5)} className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-foreground font-bold">+</button>
            </div>
          </div>
          <Button onClick={logSet} disabled={saving} fullWidth>
            {saving ? <LoadingSpinner size="sm" /> : 'Log Set'}
          </Button>
        </div>
      )}

      {sets.length >= targetSets && (
        <div className="text-center py-4 text-success font-medium">All sets completed</div>
      )}
    </div>
  );
}

// ─── Time Logger ──────────────────────────────────────────────────────────────

function TimeLogger({
  config, data, onSave, saving, completed,
}: {
  config: TimeConfig;
  data: TimeEntryData | undefined;
  onSave: (data: TimeEntryData) => void;
  saving: boolean;
  completed: boolean;
}) {
  const targetSets = config.sets;
  const sets = data?.sets || [];
  const [timerDone,      setTimerDone]      = useState(false);
  const [actualDuration, setActualDuration] = useState(config.durationSeconds);

  const logSet = () => {
    onSave({ sets: [...sets, { durationSeconds: actualDuration, completed: true }] });
    setTimerDone(false);
    if (config.restSeconds > 0) startRestTimer(config.restSeconds);
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-1">
          Target: {targetSets} sets × {formatTime(config.durationSeconds)}
        </p>
        {config.restSeconds > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Timer size={11} /> Rest: {formatTime(config.restSeconds)}
          </p>
        )}
      </div>

      {sets.length > 0 && (
        <div className="space-y-2">
          {sets.map((s, idx) => (
            <div key={idx} className="flex items-center gap-3 bg-surface rounded-lg p-3">
              <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                <Check size={14} className="text-success" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Set {idx + 1}: {formatTime(s.durationSeconds)}
              </p>
            </div>
          ))}
        </div>
      )}

      {sets.length < targetSets && !completed && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">Set {sets.length + 1}</p>
          <IntervalTimer
            config={{ kind: 'countdown', totalSeconds: actualDuration }}
            onFinish={() => setTimerDone(true)}
            resetKey={sets.length}
            adjustable
            onDurationChange={(s) => setActualDuration(s)}
          />
          <Button
            onClick={logSet}
            disabled={saving}
            fullWidth
            variant={timerDone ? 'primary' : 'secondary'}
          >
            {saving ? <LoadingSpinner size="sm" /> : timerDone ? '✓ Submit Set' : 'Log Set'}
          </Button>
        </div>
      )}

      {sets.length >= targetSets && (
        <div className="text-center py-4 text-success font-medium">All sets completed</div>
      )}
    </div>
  );
}

// ─── Rounds Logger (AMRAP, EMOM, Round Block, Tabata) ─────────────────────────

function RoundsLogger({
  exerciseType, config, data, onSave, saving, completed,
}: {
  exerciseType: ExerciseType;
  config: AmrapConfig | EmomConfig | RoundBlockConfig | TabataConfig;
  data: RoundsEntryData | undefined;
  onSave: (data: RoundsEntryData) => void;
  saving: boolean;
  completed: boolean;
}) {
  const [rounds,      setRounds]      = useState(data?.roundsCompleted || 0);
  const [timeElapsed, setTimeElapsed] = useState(data?.timeElapsed || 0);
  const [timerDone,   setTimerDone]   = useState(false);
  const isLogged = data && data.roundsCompleted > 0;

  const label = exerciseType === 'amrap' ? 'AMRAP'
    : exerciseType === 'emom'        ? 'EMOM'
    : exerciseType === 'tabata'      ? 'Tabata'
    : 'Round Block';

  const configDesc = (() => {
    if ('timeCap'       in config) return `${formatTime(config.timeCap)} cap`;
    if ('totalMinutes'  in config) return `${config.totalMinutes} min`;
    if ('rounds'        in config) return `${config.rounds} rounds`;
    return '';
  })();

  const movements = 'movements' in config ? config.movements : [];

  // Build timer config (null for round_block — no fixed time)
  const timerConfig = ((): IntervalTimerConfig | null => {
    if (exerciseType === 'amrap' && 'timeCap' in config)
      return { kind: 'amrap', totalSeconds: config.timeCap };
    if (exerciseType === 'emom' && 'totalMinutes' in config && 'intervalSeconds' in config)
      return { kind: 'emom', totalIntervals: config.totalMinutes, intervalSeconds: (config as EmomConfig).intervalSeconds };
    if (exerciseType === 'tabata' && 'rounds' in config && 'workSeconds' in config)
      return { kind: 'tabata', rounds: (config as TabataConfig).rounds, workSeconds: (config as TabataConfig).workSeconds, restSeconds: (config as TabataConfig).restSeconds };
    return null;
  })();

  const handleTimerFinish = ({ elapsedSeconds, segmentsCompleted }: FinishData) => {
    setTimerDone(true);
    setTimeElapsed(elapsedSeconds);
    if (exerciseType === 'tabata') {
      setRounds(Math.floor(segmentsCompleted / 2));
    } else if (exerciseType === 'emom') {
      setRounds(segmentsCompleted);
    }
  };

  // ── Round Block per-round countdown state ────────────────────────────────
  const rbTotalRounds  = 'rounds' in config && exerciseType === 'round_block' ? (config as RoundBlockConfig).rounds : 0;
  const rbRest         = 'restBetweenRounds' in config ? (config as RoundBlockConfig).restBetweenRounds : 0;
  const [rbCurrent,    setRbCurrent]    = useState(1);
  const [rbRoundTimes, setRbRoundTimes] = useState<number[]>([]);
  // Duration the user sets before each round (seconds); default 5 min
  const [rbRoundDuration, setRbRoundDuration] = useState(300);
  // timerKey forces IntervalTimer to remount (reset) for each new round
  const [rbTimerKey,   setRbTimerKey]   = useState(0);
  const [rbTimerDone,  setRbTimerDone]  = useState(false);

  const handleRoundBlockComplete = () => {
    const newTimes = [...rbRoundTimes, rbRoundDuration];
    setRbRoundTimes(newTimes);

    if (rbCurrent >= rbTotalRounds) {
      onSave({ roundsCompleted: rbTotalRounds, timeElapsed: newTimes.reduce((a, b) => a + b, 0) });
    } else {
      if (rbRest > 0) startRestTimer(rbRest);
      setRbCurrent((r) => r + 1);
      setRbTimerDone(false);
      setRbTimerKey((k) => k + 1);
    }
  };

  const logResult = () => {
    onSave({ roundsCompleted: rounds, timeElapsed });
  };

  return (
    <div className="space-y-4">
      {/* Config card */}
      <div className="bg-surface rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-1">{label}: {configDesc}</p>
        {exerciseType === 'tabata' && 'workSeconds' in config && (
          <p className="text-xs text-muted-foreground">
            {formatTime((config as TabataConfig).workSeconds)} work / {formatTime((config as TabataConfig).restSeconds)} rest
          </p>
        )}
        {exerciseType === 'emom' && 'intervalSeconds' in config && (
          <p className="text-xs text-muted-foreground">
            {formatTime((config as EmomConfig).intervalSeconds)} intervals
          </p>
        )}
        {movements.length > 0 && (
          <div className="space-y-0.5 mt-2">
            {movements.map((m, idx) => (
              <p key={idx} className="text-sm text-foreground">
                {m.reps && `${m.reps}× `}{m.name}{m.weight ? ` @ ${m.weight} ${m.weightUnit || 'lbs'}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Already logged result */}
      {isLogged && (
        <div className="flex items-center gap-3 bg-surface rounded-lg p-3">
          <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
            <Check size={14} className="text-success" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {data.roundsCompleted} rounds{data.timeElapsed > 0 ? ` in ${formatTime(data.timeElapsed)}` : ''}
          </p>
        </div>
      )}

      {/* ── Round Block: per-round countdown timer ── */}
      {!isLogged && !completed && exerciseType === 'round_block' && (
        <div className="space-y-3">
          {/* Completed rounds */}
          {rbRoundTimes.length > 0 && (
            <div className="space-y-2">
              {rbRoundTimes.map((t, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-surface rounded-lg p-3">
                  <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                    <Check size={14} className="text-success" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    Round {idx + 1}: {formatTime(t)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Current round */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-sm font-semibold text-foreground">Round {rbCurrent} / {rbTotalRounds}</p>
              {rbRest > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Timer size={10} /> {formatTime(rbRest)} rest after
                </p>
              )}
            </div>

              <IntervalTimer
              key={rbTimerKey}
              config={{ kind: 'countdown', totalSeconds: rbRoundDuration }}
              onFinish={() => setRbTimerDone(true)}
              resetKey={rbTimerKey}
              adjustable
              onDurationChange={(s) => setRbRoundDuration(s)}
            />

            <Button
              onClick={handleRoundBlockComplete}
              fullWidth
              variant={rbTimerDone ? 'primary' : 'secondary'}
            >
              {rbCurrent >= rbTotalRounds
                ? rbTimerDone ? '✓ Finish Last Round' : 'Finish Last Round'
                : rbTimerDone ? `✓ Complete Round ${rbCurrent}` : `Complete Round ${rbCurrent}`}
            </Button>
          </div>
        </div>
      )}

      {/* ── AMRAP / EMOM / Tabata: interval timer + log ── */}
      {!isLogged && !completed && exerciseType !== 'round_block' && timerConfig && (
        <div className="space-y-3">
          <IntervalTimer
            config={timerConfig}
            onFinish={handleTimerFinish}
            adjustable={exerciseType === 'amrap' || exerciseType === 'emom'}
          />

          {/* Rounds input — always visible for AMRAP, shown after timer for EMOM/Tabata */}
          {(exerciseType === 'amrap' || timerDone) && (
            <div className="bg-surface rounded-xl p-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  {exerciseType === 'amrap' ? 'Rounds completed' : 'Rounds / intervals completed'}
                </label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setRounds((r) => Math.max(0, r - 1))} className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-foreground font-bold">-</button>
                  <span className="flex-1 text-center text-lg font-bold text-foreground">{rounds}</span>
                  <button onClick={() => setRounds((r) => r + 1)} className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-foreground font-bold">+</button>
                </div>
              </div>
              {timerDone && timeElapsed > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  Time: {formatTime(timeElapsed)}
                </p>
              )}
              <Button
                onClick={logResult}
                disabled={saving || rounds === 0}
                fullWidth
                variant={timerDone ? 'primary' : 'secondary'}
              >
                {saving ? <LoadingSpinner size="sm" /> : timerDone ? '✓ Log Result' : 'Log Result'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
