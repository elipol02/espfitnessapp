'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, ChevronRight, RefreshCw, MessageSquare, Trash2, X, Pencil, Check } from 'lucide-react';
import { Button } from '@/app/components/Button';
import type {
  ExerciseType,
  StrengthConfig,
  DistanceConfig,
  TimeConfig,
  AmrapConfig,
  EmomConfig,
  RoundBlockConfig,
  TabataConfig,
} from '@/app/types';

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

interface WorkoutTypeRecord {
  id: string;
  name: string;
  color: string;
  category: string | null;
  exercises: ExerciseRecord[];
}

interface RotationEntryRecord {
  id: string;
  label: string;
  isNext: boolean;
  workoutType: WorkoutTypeRecord;
}

interface DayAssignment {
  id: string;
  dayOfWeek: number;
  order: number;
  startDate: string;
  rotationId: string | null;
  rotationName: string | null;
  rotationCurrentIndex: number | null;
  rotationSize: number;
  workoutType: WorkoutTypeRecord | null;
  rotationEntries: RotationEntryRecord[];
}

interface Schedule {
  dayAssignments: DayAssignment[];
}

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatExerciseConfig(
  type: ExerciseType,
  config: Record<string, unknown>,
  lastLifted?: { weight: number; weightUnit: string }
): string {
  switch (type) {
    case 'strength': {
      const c = config as unknown as StrengthConfig;
      const reps = c.repsMin === c.repsMax ? `${c.repsMin}` : `${c.repsMin}-${c.repsMax}`;
      let weight: string;
      if (lastLifted) {
        weight = `${lastLifted.weight} ${lastLifted.weightUnit}`;
      } else if (c.weightType === 'bodyweight' || (c.weightType === 'absolute' && c.baseWeight === 0)) {
        weight = 'BW';
      } else if (c.weightType === 'percentage_1rm') {
        weight = `${c.baseWeight}% 1RM`;
      } else {
        weight = `${c.baseWeight} ${c.weightUnit}`;
      }
      return `${c.sets} × ${reps} reps @ ${weight} | Rest ${c.restSeconds}s${c.tempo ? ` | Tempo ${c.tempo}` : ''}`;
    }
    case 'distance': {
      const c = config as unknown as DistanceConfig;
      return `${c.sets} × ${c.distanceTarget} ${c.distanceUnit} | Rest ${c.restSeconds}s`;
    }
    case 'time': {
      const c = config as unknown as TimeConfig;
      return `${c.sets} × ${c.durationSeconds}s | Rest ${c.restSeconds}s`;
    }
    case 'amrap': {
      const c = config as unknown as AmrapConfig;
      return `AMRAP ${Math.floor(c.timeCap / 60)} min`;
    }
    case 'emom': {
      const c = config as unknown as EmomConfig;
      return `EMOM ${c.totalMinutes} min (every ${c.intervalSeconds}s)`;
    }
    case 'round_block': {
      const c = config as unknown as RoundBlockConfig;
      return `${c.rounds} rounds | Rest ${c.restBetweenRounds}s between rounds`;
    }
    case 'tabata': {
      const c = config as unknown as TabataConfig;
      return `Tabata: ${c.rounds} rounds (${c.workSeconds}s work / ${c.restSeconds}s rest)`;
    }
    case 'simple':
      return 'Mark as completed';
    default:
      return '';
  }
}

function formatProgression(progression: Record<string, unknown> | null): string | null {
  if (!progression || progression.type === 'none') return null;
  if (progression.type === 'linear') {
    return `+${progression.incrementValue} ${progression.incrementUnit} per session`;
  }
  if (progression.type === 'double_progression') {
    return `${progression.repsMin}-${progression.repsMax} reps, +${progression.weightIncrement} ${progression.weightIncrementUnit} at top`;
  }
  return null;
}

function ExerciseList({
  exercises,
  lastLiftedWeights,
  expandedExercises,
  toggleExercise,
}: {
  exercises: ExerciseRecord[];
  lastLiftedWeights: Record<string, { weight: number; weightUnit: string }>;
  expandedExercises: Set<string>;
  toggleExercise: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {exercises
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((exercise) => {
          const isExpanded = expandedExercises.has(exercise.id);
          const type = exercise.exerciseType as ExerciseType;
          const lastLifted = lastLiftedWeights[exercise.id];
          const progression = formatProgression(exercise.progression);
          const movements =
            type === 'amrap' || type === 'emom' || type === 'round_block' || type === 'tabata'
              ? ((exercise.config as Record<string, unknown>).movements as Array<{ name: string; reps?: number; weight?: number; weightUnit?: string }>) || []
              : [];

          return (
            <div key={exercise.id} className="bg-surface rounded-lg overflow-hidden">
              <button
                onClick={() => toggleExercise(exercise.id)}
                className="w-full flex items-center gap-3 p-3 text-left"
              >
                {isExpanded ? (
                  <ChevronDown size={16} className="text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{exercise.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatExerciseConfig(type, exercise.config, lastLifted)}
                    {lastLifted && (
                      <span className="ml-1 text-primary/70">(last lifted)</span>
                    )}
                  </p>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-0 space-y-2 ml-7">
                  {progression && (
                    <p className="text-xs text-primary">Progression: {progression}</p>
                  )}
                  {exercise.notes && (
                    <p className="text-xs text-muted-foreground">{exercise.notes}</p>
                  )}
                  {exercise.groupTag && (
                    <p className="text-xs text-muted-foreground">
                      Superset: {exercise.groupTag}
                    </p>
                  )}
                  {movements.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Movements:</p>
                      {movements.map((m, idx) => (
                        <p key={idx} className="text-xs text-foreground pl-2">
                          {m.reps && `${m.reps}× `}{m.name}
                          {m.weight ? ` @ ${m.weight} ${m.weightUnit || 'lbs'}` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

export function ScheduleContent({
  schedule,
  lastLiftedWeights = {},
}: {
  schedule: Schedule;
  lastLiftedWeights?: Record<string, { weight: number; weightUnit: string }>;
}) {
  const uniqueDays = [...new Set(schedule.dayAssignments.map((da) => da.dayOfWeek))].sort((a, b) => a - b);

  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState(uniqueDays[0] ?? 1);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const [slotMenu, setSlotMenu] = useState<DayAssignment | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [actioning, setActioning] = useState(false);

  // Per-day start date editing
  const toDateInputValue = (iso: string | null) => iso ? iso.slice(0, 10) : '';
  const [editingStartDate, setEditingStartDate] = useState(false);
  const [startDateInput, setStartDateInput] = useState('');
  const [savingStartDate, setSavingStartDate] = useState(false);

  // Slots for the currently selected day — used to derive the displayed start date
  const selectedSlots = schedule.dayAssignments
    .filter((da) => da.dayOfWeek === selectedDay)
    .sort((a, b) => a.order - b.order);

  // Earliest startDate among the selected day's slots
  const currentDayStartDate = selectedSlots.length > 0
    ? selectedSlots.reduce((earliest, da) =>
        da.startDate < earliest ? da.startDate : earliest,
        selectedSlots[0].startDate
      )
    : null;

  // Reset the date input whenever the selected day changes
  useEffect(() => {
    setStartDateInput(toDateInputValue(currentDayStartDate));
    setEditingStartDate(false);
  }, [selectedDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveStartDate = async () => {
    if (!startDateInput) return;
    setSavingStartDate(true);
    try {
      await Promise.all(
        selectedSlots.map((da) =>
          fetch(`/api/schedule/assignment/${da.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startDate: startDateInput }),
          })
        )
      );
      setEditingStartDate(false);
      router.refresh();
    } finally {
      setSavingStartDate(false);
    }
  };

  const cancelStartDate = () => {
    setStartDateInput(toDateInputValue(currentDayStartDate));
    setEditingStartDate(false);
  };

  const runDelete = async (url: string) => {
    setActioning(true);
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        setSlotMenu(null);
        setConfirmClear(false);
        router.refresh();
      }
    } finally {
      setActioning(false);
    }
  };

  function getDayColor(day: number): string {
    const firstSlot = schedule.dayAssignments.find((da) => da.dayOfWeek === day);
    if (firstSlot?.workoutType) return firstSlot.workoutType.color;
    if (firstSlot?.rotationEntries?.[0]?.workoutType) return firstSlot.rotationEntries[0].workoutType.color;
    return '#404040';
  }

  const toggleExercise = (id: string) => {
    setExpandedExercises((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (schedule.dayAssignments.length === 0) {
    return (
      <div className="px-4 pt-8 pb-24">
        <div className="max-w-lg mx-auto space-y-8">
          <h1 className="text-2xl font-bold text-foreground">My Schedule</h1>
          <div className="bg-surface rounded-2xl p-10 text-center space-y-6">
            <div className="text-6xl">🗓️</div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">No schedule yet</h2>
              <p className="text-muted-foreground">Chat with the AI assistant to build your weekly workout schedule</p>
            </div>
            <Link href="/chat">
              <Button size="lg">Create a Schedule</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-foreground">My Schedule</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-error transition-colors"
            >
              <Trash2 size={16} />
              Clear
            </button>
            <Link href="/chat" className="flex items-center gap-1.5 text-sm text-primary">
              <MessageSquare size={16} />
              Edit
            </Link>
          </div>
        </div>
      </div>

      {/* Day tabs */}
      <div className="px-4 pt-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {uniqueDays.map((day) => {
            const color = getDayColor(day);
            const slotsForDay = schedule.dayAssignments.filter((da) => da.dayOfWeek === day);
            const hasMultiple = slotsForDay.length > 1;
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedDay === day
                    ? 'text-white'
                    : 'bg-surface text-muted-foreground hover:text-foreground'
                }`}
                style={selectedDay === day ? { backgroundColor: color } : undefined}
              >
                {DAY_NAMES[day]?.slice(0, 3)}
                {hasMultiple && (
                  <span
                    className="absolute -top-1 -right-1 bg-primary text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center"
                  >
                    {slotsForDay.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-day start date */}
      <div className="px-4 pt-2 pb-1 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Started:</span>
        {editingStartDate ? (
          <>
            <input
              type="date"
              value={startDateInput}
              onChange={(e) => setStartDateInput(e.target.value)}
              disabled={savingStartDate}
              className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 text-foreground focus:outline-none focus:border-primary"
            />
            <button
              onClick={saveStartDate}
              disabled={savingStartDate || !startDateInput}
              className="p-0.5 text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
              aria-label="Save start date"
            >
              <Check size={14} />
            </button>
            <button
              onClick={cancelStartDate}
              disabled={savingStartDate}
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Cancel"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-foreground">
              {currentDayStartDate
                ? new Date(currentDayStartDate).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
                : 'Not set'}
            </span>
            <button
              onClick={() => {
                setStartDateInput(toDateInputValue(currentDayStartDate));
                setEditingStartDate(true);
              }}
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Edit start date"
            >
              <Pencil size={12} />
            </button>
          </>
        )}
      </div>

      {/* Selected day content */}
      <div className="px-4 py-4 space-y-6">
        {selectedSlots.map((slot, slotIdx) => {
          // Fixed slot
          if (slot.workoutType) {
            return (
              <div key={slot.id}>
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: slot.workoutType.color }}
                  />
                  <h2 className="text-lg font-bold text-foreground">{slot.workoutType.name}</h2>
                  {selectedSlots.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                      ({slotIdx + 1}/{selectedSlots.length})
                    </span>
                  )}
                  <button
                    onClick={() => setSlotMenu(slot)}
                    className="ml-auto p-1.5 text-muted-foreground hover:text-error transition-colors"
                    aria-label="Remove workout"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <ExerciseList
                  exercises={slot.workoutType.exercises}
                  lastLiftedWeights={lastLiftedWeights}
                  expandedExercises={expandedExercises}
                  toggleExercise={toggleExercise}
                />
              </div>
            );
          }

          // Rotation slot
          if (slot.rotationEntries.length > 0) {
            return (
              <div key={slot.id}>
                <div className="flex items-center gap-2 mb-3">
                  <RefreshCw size={16} className="text-muted-foreground" />
                  <h2 className="text-lg font-bold text-foreground">
                    {slot.rotationName ?? 'A/B Rotation'}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    ({slot.rotationEntries.length} slots)
                  </span>
                  {selectedSlots.length > 1 && (
                    <span className="text-xs text-muted-foreground">· {slotIdx + 1}/{selectedSlots.length}</span>
                  )}
                  <button
                    onClick={() => setSlotMenu(slot)}
                    className="ml-auto p-1.5 text-muted-foreground hover:text-error transition-colors"
                    aria-label="Remove rotation"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="space-y-4">
                  {slot.rotationEntries.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-border overflow-hidden">
                      <div
                        className="flex items-center gap-2 px-3 py-2"
                        style={{ backgroundColor: entry.workoutType.color + '20', borderBottom: `1px solid ${entry.workoutType.color}40` }}
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: entry.workoutType.color }}
                        >
                          {entry.label}
                        </div>
                        <span className="text-sm font-semibold text-foreground">{entry.workoutType.name}</span>
                        {entry.isNext && (
                          <span className="ml-auto text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                            Next up
                          </span>
                        )}
                      </div>
                      <div className="p-2">
                        <ExerciseList
                          exercises={entry.workoutType.exercises}
                          lastLiftedWeights={lastLiftedWeights}
                          expandedExercises={expandedExercises}
                          toggleExercise={toggleExercise}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Per-slot remove menu */}
      {slotMenu && (() => {
        const dayLabel = DAY_NAMES[slotMenu.dayOfWeek];
        const isRotation = !slotMenu.workoutType && slotMenu.rotationEntries.length > 0;
        const title = slotMenu.workoutType?.name ?? slotMenu.rotationName ?? 'Workout';
        return (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
            onClick={() => !actioning && setSlotMenu(null)}
          >
            <div className="absolute inset-0 bg-black/50" />
            <div
              className="relative bg-surface rounded-2xl w-full max-w-sm m-4 p-5 space-y-4 animate-[fadeSlideIn_0.2s_ease-out]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-foreground">{title}</h3>
                  <p className="text-sm text-muted-foreground">{dayLabel}</p>
                </div>
                <button onClick={() => setSlotMenu(null)} disabled={actioning} className="p-1 text-muted-foreground hover:text-foreground touch-target">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => runDelete(`/api/schedule/assignment/${slotMenu.id}`)}
                  disabled={actioning}
                  className="w-full text-left bg-surface-elevated rounded-xl p-3 border border-border hover:border-primary/50 transition-colors disabled:opacity-50"
                >
                  <p className="font-medium text-foreground">Remove from {dayLabel}</p>
                  <p className="text-xs text-muted-foreground">Unschedule it from this day only.</p>
                </button>
                {!isRotation && slotMenu.workoutType && (
                  <button
                    onClick={() => runDelete(`/api/schedule/workout-type/${slotMenu.workoutType!.id}`)}
                    disabled={actioning}
                    className="w-full text-left bg-surface-elevated rounded-xl p-3 border border-border hover:border-error/50 transition-colors disabled:opacity-50"
                  >
                    <p className="font-medium text-error">Remove from entire schedule</p>
                    <p className="text-xs text-muted-foreground">Take it off every day. Your logged history is kept.</p>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Clear-schedule confirm */}
      {confirmClear && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onClick={() => !actioning && setConfirmClear(false)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-surface rounded-2xl w-full max-w-sm m-4 p-5 space-y-4 animate-[fadeSlideIn_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-lg font-bold text-foreground">Clear entire schedule?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Removes all scheduled days and rotations. Your workouts and logged history are kept.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => setConfirmClear(false)} disabled={actioning}>
                Cancel
              </Button>
              <Button variant="danger" fullWidth onClick={() => runDelete('/api/schedule')} loading={actioning}>
                Clear
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
