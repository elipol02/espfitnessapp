'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, ArrowLeft, Calendar } from 'lucide-react';
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

interface DayAssignment {
  id: string;
  dayOfWeek: number;
  workoutType: WorkoutTypeRecord;
}

interface Plan {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  dayAssignments: DayAssignment[];
}

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function toDateInputValue(dateString: string): string {
  return dateString.includes('T') ? dateString.split('T')[0] : dateString;
}

function formatLocalDate(dateString: string): string {
  const datePart = dateString.includes('T') ? dateString.split('T')[0] : dateString;
  const [year, month, day] = datePart.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

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

export function PlanViewerContent({
  plan,
  lastLiftedWeights = {},
}: {
  plan: Plan;
  lastLiftedWeights?: Record<string, { weight: number; weightUnit: string }>;
}) {
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState(
    plan.dayAssignments.length > 0 ? plan.dayAssignments[0].dayOfWeek : 1
  );
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const [editingStart, setEditingStart] = useState(false);
  const [startDate, setStartDate] = useState(plan.startDate || '');
  const [editingEnd, setEditingEnd] = useState(false);
  const [endDate, setEndDate] = useState(plan.endDate || '');
  const [savingDate, setSavingDate] = useState(false);

  const sortedAssignments = [...plan.dayAssignments].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const selectedAssignment = sortedAssignments.find((a) => a.dayOfWeek === selectedDay);

  const toggleExercise = (id: string) => {
    setExpandedExercises((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveStartDate = async () => {
    setSavingDate(true);
    try {
      await fetch(`/api/plan/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: startDate || null }),
      });
      setEditingStart(false);
      router.refresh();
    } catch (error) {
      console.error('Error saving start date:', error);
    } finally {
      setSavingDate(false);
    }
  };

  const saveEndDate = async () => {
    setSavingDate(true);
    try {
      await fetch(`/api/plan/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endDate: endDate || null }),
      });
      setEditingEnd(false);
      router.refresh();
    } catch (error) {
      console.error('Error saving end date:', error);
    } finally {
      setSavingDate(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/plans')} className="p-2 -ml-2">
            <ArrowLeft size={20} className="text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">{plan.name}</h1>
          <div className="w-8" />
        </div>
      </div>

      {/* Plan dates */}
      <div className="px-4 py-3 border-b border-border space-y-3">
        {/* Start date */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-muted-foreground" />
            {!editingStart ? (
              <span className="text-sm text-muted-foreground">
                {plan.startDate
                  ? `Start: ${formatLocalDate(plan.startDate)}`
                  : 'No start date set'}
              </span>
            ) : (
              <input
                type="date"
                value={startDate ? toDateInputValue(startDate) : ''}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-sm bg-surface border border-border rounded px-2 py-1 text-foreground"
              />
            )}
          </div>
          {!editingStart ? (
            <button
              onClick={() => setEditingStart(true)}
              className="text-sm text-primary"
            >
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveStartDate} disabled={savingDate}>
                Save
              </Button>
              <button
                onClick={() => { setStartDate(plan.startDate || ''); setEditingStart(false); }}
                className="text-sm text-muted-foreground"
                disabled={savingDate}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* End date */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-muted-foreground" />
            {!editingEnd ? (
              <span className="text-sm text-muted-foreground">
                {plan.endDate
                  ? `End: ${formatLocalDate(plan.endDate)}`
                  : 'No end date set'}
              </span>
            ) : (
              <input
                type="date"
                value={endDate ? toDateInputValue(endDate) : ''}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-sm bg-surface border border-border rounded px-2 py-1 text-foreground"
              />
            )}
          </div>
          {!editingEnd ? (
            <button
              onClick={() => setEditingEnd(true)}
              className="text-sm text-primary"
            >
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveEndDate} disabled={savingDate}>
                Save
              </Button>
              <button
                onClick={() => { setEndDate(plan.endDate || ''); setEditingEnd(false); }}
                className="text-sm text-muted-foreground"
                disabled={savingDate}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Day tabs */}
      <div className="px-4 pt-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {sortedAssignments.map((da) => (
            <button
              key={da.dayOfWeek}
              onClick={() => setSelectedDay(da.dayOfWeek)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedDay === da.dayOfWeek
                  ? 'text-white'
                  : 'bg-surface text-muted-foreground hover:text-foreground'
              }`}
              style={
                selectedDay === da.dayOfWeek
                  ? { backgroundColor: da.workoutType.color }
                  : undefined
              }
            >
              {DAY_NAMES[da.dayOfWeek]?.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Selected day exercises */}
      {selectedAssignment && (
        <div className="px-4 py-4">
          <div className="flex items-center gap-2 mb-4">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: selectedAssignment.workoutType.color }}
            />
            <h2 className="text-lg font-bold text-foreground">
              {selectedAssignment.workoutType.name}
            </h2>
          </div>

          <div className="space-y-2">
            {selectedAssignment.workoutType.exercises
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
        </div>
      )}

      {!selectedAssignment && (
        <div className="px-4 py-8 text-center text-muted-foreground">
          Select a day to view exercises
        </div>
      )}
    </div>
  );
}
