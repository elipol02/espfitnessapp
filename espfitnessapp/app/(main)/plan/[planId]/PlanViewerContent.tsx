'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, ArrowLeft, Check, MessageSquare, Calendar, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/app/components/Button';

interface Progression {
  type: string;
  increment: number;
  frequency: string;
}

interface MovementDetails {
  description: string;
  cues: string[];
  muscles: string[];
}

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
  progression: Progression | null | unknown;
  movementDetails: MovementDetails | null | unknown;
  // Complex exercise type fields
  distance?: number;
  distanceUnit?: 'feet' | 'yards' | 'meters';
  intervals?: IntervalStructure;
  tempo?: string;
  timeCap?: number;
}

interface WorkoutDay {
  id: string;
  dayNumber: number;
  dayName: string;
  workoutType: string;
  workoutColor: string;
  exercises: Exercise[];
}

interface Plan {
  id: string;
  goal: string;
  status: string;
  weeksDuration: number;
  startDate: string | null;
  createdAt: string;
  workoutDays: WorkoutDay[];
}

export function PlanViewerContent({ plan }: { plan: Plan }) {
  const router = useRouter();
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const initialDate = plan.startDate 
    ? new Date(plan.startDate).toISOString().split('T')[0] 
    : new Date().toISOString().split('T')[0];
  
  const [startDate, setStartDate] = useState<string>(initialDate);
  const [savingDate, setSavingDate] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [tempDate, setTempDate] = useState<string>(initialDate);

  // Generate full 7-day week with rest days filled in
  // Only use workout days that have exercises generated (isGenerated = true)
  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  // Filter to get only the first week's worth of workout days (those with exercises)
  const workoutDaysWithExercises = plan.workoutDays.filter(d => d.exercises && d.exercises.length > 0);
  
  const fullWeek = daysOfWeek.map((dayName, index) => {
    // First try to find a workout day with exercises for this day name
    const workoutDay = workoutDaysWithExercises.find(
      (d) => d.dayName.toLowerCase() === dayName.toLowerCase()
    ) || plan.workoutDays.find(
      (d) => d.dayName.toLowerCase() === dayName.toLowerCase()
    );
    
    if (workoutDay) {
      return workoutDay;
    } else {
      // Create a rest day placeholder
      return {
        id: `rest-${index}`,
        dayNumber: index + 1,
        dayName,
        workoutType: 'rest',
        workoutColor: '#404040',
        exercises: [],
      };
    }
  });

  const [activeDay, setActiveDay] = useState<string>(fullWeek[0]?.id || '');
  const selectedDay = fullWeek.find((d) => d.id === activeDay);

  const toggleExercise = (exerciseId: string) => {
    const newExpanded = new Set(expandedExercises);
    if (newExpanded.has(exerciseId)) {
      newExpanded.delete(exerciseId);
    } else {
      newExpanded.add(exerciseId);
    }
    setExpandedExercises(newExpanded);
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await fetch(`/api/plan/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      router.push('/home');
      router.refresh();
    } catch (error) {
      console.error('Approval error:', error);
    } finally {
      setApproving(false);
    }
  };

  const handleOpenDateModal = () => {
    setTempDate(startDate);
    setShowDateModal(true);
  };

  const handleSaveDate = async () => {
    setShowDateModal(false);
    setSavingDate(true);
    try {
      await fetch(`/api/plan/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: new Date(tempDate).toISOString() }),
      });
      setStartDate(tempDate);
      // Refresh to get updated data
      router.refresh();
    } catch (error) {
      console.error('Start date update error:', error);
      // Revert on error
      setTempDate(startDate);
    } finally {
      setSavingDate(false);
    }
  };

  const formatDisplayDate = (dateString: string) => {
    // Parse as local date to avoid timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const renderMovementDetails = (details: unknown) => {
    if (!details || typeof details !== 'object') return null;
    const md = details as MovementDetails;
    if (!md.description) return null;
    
    return (
      <div className="p-2 bg-background rounded space-y-1.5">
        <p className="text-sm text-foreground">{md.description}</p>
        {md.cues && md.cues.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Cues:</p>
            <ul className="text-sm text-foreground space-y-0.5">
              {md.cues.map((cue, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-primary">•</span>
                  {cue}
                </li>
              ))}
            </ul>
          </div>
        )}
        {md.muscles && md.muscles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {md.muscles.map((muscle) => (
              <span
                key={muscle}
                className="px-1.5 py-0.5 bg-surface rounded text-xs text-muted-foreground"
              >
                {muscle}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderProgression = (prog: unknown) => {
    if (!prog || typeof prog !== 'object') return null;
    const p = prog as Progression;
    if (!p.increment) return null;
    
    // If increment is less than 1, treat it as a percentage
    const incrementDisplay = p.increment < 1 
      ? `${(p.increment * 100).toFixed(1)}%`
      : `${p.increment} lbs`;
    
    return (
      <div className="p-2 bg-background rounded">
        <p className="text-xs text-muted-foreground">Progression: <span className="text-foreground">+{incrementDisplay} {p.frequency}</span></p>
      </div>
    );
  };

  const formatWeight = (type: string, value: number) => {
    switch (type) {
      case 'BW':
        return `${Math.round(value * 100)}% BW`;
      case '1RM':
        return `${Math.round(value * 100)}% 1RM`;
      default:
        return `${value} lbs`;
    }
  };

  const formatRestTime = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes} min`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatExerciseDisplay = (exercise: Exercise) => {
    const exerciseType = exercise.exerciseType || 'strength';
    
    switch (exerciseType) {
      case 'cardio_time':
      case 'mobility_time':
        return `${exercise.reps} min`;
      
      case 'distance':
        const unit = exercise.distanceUnit || 'feet';
        const distWeight = exercise.weightValue > 0 
          ? ` @ ${formatWeight(exercise.weightType, exercise.weightValue)}`
          : '';
        return `${exercise.sets} × ${exercise.distance || 0} ${unit}${distWeight}`;
      
      case 'interval':
        if (exercise.intervals) {
          const { rounds, phases } = exercise.intervals;
          if (phases.length === 2) {
            // Simple work/rest format
            return `${rounds} rounds: ${formatDuration(phases[0].duration)} ${phases[0].name.toLowerCase()} / ${formatDuration(phases[1].duration)} ${phases[1].name.toLowerCase()}`;
          } else {
            // Complex multi-phase
            const totalTime = phases.reduce((sum, p) => sum + p.duration, 0) * rounds;
            return `${rounds} rounds • ${formatDuration(totalTime)} total`;
          }
        }
        return 'Interval training';
      
      case 'amrap':
        const timeCap = exercise.timeCap || 600;
        return `AMRAP ${formatDuration(timeCap)}`;
      
      case 'emom':
        return `EMOM ${exercise.sets} min × ${exercise.reps} reps`;
      
      case 'tabata':
        return `Tabata ${exercise.sets} rounds (20s/10s)`;
      
      case 'tempo':
        const tempoPattern = exercise.tempo || '3-1-3-1';
        return `${exercise.sets}×${exercise.reps} @ tempo ${tempoPattern}`;
      
      case 'strength':
      default:
        return `${exercise.sets}×${exercise.reps} @ ${formatWeight(exercise.weightType, exercise.weightValue)} • ${formatRestTime(exercise.restTime || 90)} rest`;
    }
  };

  const renderIntervalDetails = (intervals: IntervalStructure | undefined) => {
    if (!intervals) return null;
    
    return (
      <div className="p-2 bg-background rounded space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {intervals.type === 'simple' ? 'Simple Interval' : 'Complex Interval'} • {intervals.rounds} rounds
        </p>
        <div className="space-y-1">
          {intervals.phases.map((phase, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span 
                className={`w-2 h-2 rounded-full ${
                  phase.intensity === 'hard' ? 'bg-red-500' :
                  phase.intensity === 'moderate' ? 'bg-yellow-500' :
                  'bg-green-500'
                }`}
              />
              <span className="text-foreground">{phase.name}</span>
              <span className="text-muted-foreground">{formatDuration(phase.duration)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTempoDetails = (tempo: string | undefined) => {
    if (!tempo) return null;
    
    const parts = tempo.split('-').map(Number);
    if (parts.length !== 4) return null;
    
    return (
      <div className="p-2 bg-background rounded">
        <p className="text-xs text-muted-foreground mb-1">Tempo: {tempo}</p>
        <p className="text-sm text-foreground">
          {parts[0]}s down • {parts[1]}s pause • {parts[2]}s up • {parts[3]}s pause
        </p>
      </div>
    );
  };

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-foreground truncate">
              {plan.status === 'draft' ? 'Review Your Plan' : 'Workout Plan'}
            </h1>
            <p className="text-sm text-muted-foreground truncate">{plan.goal}</p>
          </div>
        </div>
      </div>

      {/* Plan Details */}
      <div className="px-4 py-3 space-y-3">
        {/* Start Date */}
        <button
          onClick={handleOpenDateModal}
          disabled={savingDate}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface rounded-lg hover:bg-surface-elevated 
                   transition-colors border border-border disabled:opacity-50 text-xs text-muted-foreground"
        >
          <Calendar size={14} />
          <span>Start: {formatDisplayDate(startDate)}</span>
          {savingDate && (
            <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full" />
          )}
        </button>

        {/* Date Picker Modal */}
        {showDateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-background rounded-2xl shadow-xl max-w-sm w-full overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-lg font-semibold text-foreground">Plan Start Date</h3>
                <button
                  onClick={() => setShowDateModal(false)}
                  className="p-1 hover:bg-surface rounded-lg transition-colors"
                >
                  <X size={20} className="text-muted-foreground" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Workouts will only appear on the calendar and be available to start from this date onwards
                </p>
                <input
                  type="date"
                  value={tempDate}
                  onChange={(e) => setTempDate(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg 
                           text-foreground focus:outline-none focus:ring-2 focus:ring-primary
                           [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:brightness-0 
                           [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-70
                           [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                />
              </div>

              {/* Modal Footer */}
              <div className="flex gap-3 p-4 border-t border-border">
                <Button
                  variant="secondary"
                  onClick={() => setShowDateModal(false)}
                  fullWidth
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveDate}
                  fullWidth
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Day Tabs */}
        <div className="overflow-x-auto -mx-4 px-4">
          <div className="flex gap-2 min-w-min">
            {fullWeek.map((day) => {
              const isActive = activeDay === day.id;
              const isRestDay = day.workoutType === 'rest';

              return (
                <button
                  key={day.id}
                  onClick={() => setActiveDay(day.id)}
                  className={`
                    flex-shrink-0 px-3 py-2 rounded-lg transition-all
                    ${isActive 
                      ? 'bg-surface border-2' 
                      : 'bg-surface/50 border-2 border-transparent hover:bg-surface'
                    }
                  `}
                  style={{
                    borderColor: isActive && !isRestDay ? day.workoutColor : undefined,
                  }}
                >
                  <div className="flex flex-col items-center gap-1 min-w-[60px]">
                    <div
                      className="rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        width: '40px',
                        height: '28px',
                        backgroundColor: isRestDay ? 'transparent' : day.workoutColor + '20',
                        border: isRestDay ? '2px dashed var(--border)' : `2px solid ${day.workoutColor}`,
                      }}
                    >
                      <span
                        className="text-xs font-bold"
                        style={{ color: isRestDay ? 'var(--muted)' : day.workoutColor }}
                      >
                        {isRestDay ? '' : day.workoutType.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className={`text-xs ${isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {day.dayName.slice(0, 3)}
                    </span>
                    <span className={`text-xs capitalize ${isActive ? 'text-foreground' : 'text-muted-foreground'} text-center`}>
                      {isRestDay ? 'Rest' : day.workoutType}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Exercises for Selected Day */}
        {selectedDay && selectedDay.workoutType !== 'rest' && (
          <div className="space-y-2">
            {selectedDay.exercises.map((exercise, index) => {
              const isExerciseExpanded = expandedExercises.has(exercise.id);

              return (
                <div
                  key={exercise.id}
                  className="bg-surface rounded-lg overflow-hidden"
                >
                  {/* Exercise Summary */}
                  <button
                    onClick={() => toggleExercise(exercise.id)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-surface-elevated transition-colors"
                  >
                    <span className="text-sm text-muted-foreground w-5">
                      {index + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">{exercise.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatExerciseDisplay(exercise)}
                      </p>
                    </div>
                    {Boolean(exercise.movementDetails || exercise.progression || exercise.intervals || exercise.tempo) && (
                      isExerciseExpanded ? (
                        <ChevronDown size={18} className="text-muted-foreground" />
                      ) : (
                        <ChevronRight size={18} className="text-muted-foreground" />
                      )
                    )}
                  </button>

                  {/* Exercise Details */}
                  {isExerciseExpanded && (
                    <div className="px-3 pb-3 space-y-2">
                      {renderMovementDetails(exercise.movementDetails)}
                      {renderProgression(exercise.progression)}
                      {exercise.exerciseType === 'interval' && renderIntervalDetails(exercise.intervals)}
                      {exercise.exerciseType === 'tempo' && renderTempoDetails(exercise.tempo)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Rest Day Message */}
        {selectedDay && selectedDay.workoutType === 'rest' && (
          <div className="bg-surface rounded-lg p-6 text-center">
            <p className="text-muted-foreground">Rest Day</p>
          </div>
        )}
      </div>

      {/* Approval Footer (for draft plans) */}
      {plan.status === 'draft' && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 safe-bottom">
          <div className="max-w-lg mx-auto flex gap-3">
            <Link href="/chat/create" className="flex-1">
              <Button variant="secondary" fullWidth size="lg">
                <MessageSquare size={18} className="mr-2" />
                Edit
              </Button>
            </Link>
            <Button
              onClick={handleApprove}
              loading={approving}
              fullWidth
              size="lg"
              className="flex-1"
            >
              <Check size={18} className="mr-2" />
              Approve Plan
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
