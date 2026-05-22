'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/app/components/Button';
import { ChevronRight, CheckCircle2, X, Calendar, Check, RefreshCw } from 'lucide-react';

interface WorkoutTypeSummary {
  id: string;
  name: string;
  color: string;
  exerciseCount: number;
  exercises: { id: string; name: string }[];
}

interface DayAssignment {
  id: string;
  dayOfWeek: number;
  order: number;
  rotationId: string | null;
  rotationName: string | null;
  rotationSize: number;
  rotationSlotIndex: number;
  workoutType: WorkoutTypeSummary | null;
}

interface SessionData {
  id: string;
  workoutTypeId: string;
  rotationId: string | null;
  workoutDate: string;
  status: string;
}

interface HomeData {
  user: {
    name: string | null;
    bodyweight: number | null;
    onboardingCompleted: boolean;
  } | null;
  currentStreak: number;
  schedule: {
    dayAssignments: DayAssignment[];
  } | null;
  /** The user's first-ever workout date — floors the week preview / stats. */
  scheduleStartDate: string | null;
  recentSessions: SessionData[];
  completedWorkouts: number;
  missedWorkouts: number;
  completionRateToDate: number;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

// Slot labels for rotation display: A, B, C, ...
const SLOT_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function HomeContent({ data }: { data: HomeData }) {
  const router = useRouter();
  const { user, currentStreak, schedule, scheduleStartDate, recentSessions, completedWorkouts, missedWorkouts, completionRateToDate } = data;

  useEffect(() => {
    const offset = new Date().getTimezoneOffset();
    document.cookie = `tz-offset=${offset}; path=/; max-age=86400; SameSite=Lax`;
  }, []);

  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const clientToday = new Date();
  clientToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(clientToday);
  startOfWeek.setDate(clientToday.getDate() - clientToday.getDay());

  const planStartDate = scheduleStartDate
    ? (() => { const d = new Date(scheduleStartDate); d.setHours(0, 0, 0, 0); return d; })()
    : null;

  /** Find all sessions for a specific date and a specific workoutTypeId */
  function sessionsForSlot(dateStr: string, workoutTypeId: string): SessionData[] {
    return recentSessions.filter(
      (s) => s.workoutDate.slice(0, 10) === dateStr && s.workoutTypeId === workoutTypeId,
    );
  }

  const weekPreview = DAY_NAMES.map((dayName, index) => {
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(startOfWeek.getDate() + index);
    const dateStr = dayDate.toLocaleDateString('en-CA');
    const dow = DAY_MAP[index];

    const beforePlanStart = planStartDate ? dayDate < planStartDate : false;
    const afterPlanEnd = false; // ongoing schedule has no end date

    // All slots for this day, sorted by order
    const dayAssignments = schedule?.dayAssignments
      .filter((a) => a.dayOfWeek === dow)
      .sort((a, b) => a.order - b.order) ?? [];

    // Collect all sessions for this day
    const daySessions = recentSessions.filter((s) => s.workoutDate.slice(0, 10) === dateStr);

    // A day is "completed" only if every slot has a completed session
    const isFullyCompleted =
      dayAssignments.length > 0 &&
      dayAssignments.every((da) => {
        if (!da.workoutType) return false;
        return daySessions.some(
          (s) => s.workoutTypeId === da.workoutType!.id && s.status === 'completed',
        );
      });

    // Primary slot for display (first one)
    const primaryAssignment = dayAssignments[0] ?? null;

    return {
      dayName,
      dateStr,
      dow,
      dayDate,
      isToday: index === clientToday.getDay(),
      isFuture: dayDate > clientToday,
      beforePlanStart,
      afterPlanEnd,
      dayAssignments,
      daySessions,
      isFullyCompleted,
      primaryAssignment,
      extraSlotCount: Math.max(0, dayAssignments.length - 1),
    };
  });

  const greeting = getGreeting();
  const userName = user?.name?.split(' ')[0] || 'there';

  const todayPreview = weekPreview.find((d) => d.isToday);
  const todaySlots = todayPreview?.dayAssignments ?? [];

  const startWorkout = (assignment: DayAssignment, dateStr: string) => {
    if (!assignment.workoutType) return;
    const params = new URLSearchParams({
      workoutTypeId: assignment.workoutType.id,
      date: dateStr,
    });
    if (assignment.rotationId) params.set('rotationId', assignment.rotationId);
    router.push(`/workout/today?${params.toString()}`);
  };

  if (!schedule) {
    return (
      <div className="px-5 pt-10 pb-28">
        <div className="max-w-lg mx-auto space-y-8">
          <div>
            <p className="text-muted-foreground">{formattedDate}</p>
            <h1 className="text-2xl font-bold text-foreground mt-1">
              {greeting}, {userName}!
            </h1>
          </div>

          <div className="bg-surface rounded-2xl p-10 text-center space-y-8">
            <div className="text-6xl">🏋️</div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">Start your fitness journey</h2>
              <p className="text-muted-foreground">Create your first personalized workout plan with AI</p>
            </div>
            <Link href="/chat">
              <Button size="lg" fullWidth>Create Your Plan</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-10 pb-28">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div>
          <p className="text-muted-foreground">{formattedDate}</p>
          <h1 className="text-2xl font-bold text-foreground mt-1">
            {greeting}, {userName}!
          </h1>
        </div>

        {/* Progress — rolling 30-day completion */}
        <div className="bg-surface rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Completion (last 30 days)</span>
            <span className="font-medium text-foreground">{completionRateToDate}%</span>
          </div>
          <div className="h-2 bg-background rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, completionRateToDate)}%` }}
            />
          </div>
        </div>

        {/* Today's Workout(s) */}
        {todaySlots.length === 0 ? (
          <div className="bg-surface rounded-2xl p-6 text-center space-y-3">
            <div className="text-4xl">😴</div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Rest Day</h2>
              <p className="text-muted-foreground mt-1">Recovery is part of the process!</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground uppercase tracking-wide">
              {todaySlots.length === 1 ? "Today's Workout" : `Today's Workouts (${todaySlots.length})`}
            </p>
            {todaySlots.map((slot, slotIdx) => {
              if (!slot.workoutType) return null;
              const slotSessions = sessionsForSlot(todayPreview!.dateStr, slot.workoutType.id);
              const activeSession = slotSessions.find((s) => s.status === 'in_progress') ?? slotSessions.find((s) => s.status === 'completed');
              const isCompleted = activeSession?.status === 'completed';
              const isInProgress = activeSession?.status === 'in_progress';

              return (
                <div key={slot.id} className="bg-surface rounded-2xl p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: slot.workoutType.color }}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-bold text-foreground">{slot.workoutType.name}</h2>
                          {slot.rotationId && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
                              <RefreshCw className="w-3 h-3" />
                              {SLOT_LABELS[slot.rotationSlotIndex] ?? slot.rotationSlotIndex + 1}
                              {slot.rotationName ? ` · ${slot.rotationName}` : ''}
                            </span>
                          )}
                          {todaySlots.length > 1 && (
                            <span className="text-xs text-muted-foreground">
                              {slotIdx + 1}/{todaySlots.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {isCompleted && (
                      <div className="flex items-center gap-1.5 text-success flex-shrink-0">
                        <span className="text-sm font-medium">Done</span>
                        <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      </div>
                    )}
                    {isInProgress && (
                      <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full flex-shrink-0">
                        In Progress
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {slot.workoutType.exercises.map((exercise) => (
                      <div key={exercise.id} className="text-sm text-muted-foreground">
                        {exercise.name}
                      </div>
                    ))}
                  </div>

                  {isInProgress ? (
                    <Button
                      fullWidth
                      variant="secondary"
                      onClick={() => router.push(`/workout/live?sessionId=${activeSession!.id}`)}
                    >
                      Resume
                    </Button>
                  ) : isCompleted ? (
                    <Button
                      fullWidth
                      variant="secondary"
                      onClick={() => router.push(`/workout/live?sessionId=${activeSession!.id}`)}
                    >
                      View
                    </Button>
                  ) : (
                    <Button
                      fullWidth
                      onClick={() => startWorkout(slot, todayPreview!.dateStr)}
                    >
                      Start
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Week Preview */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-foreground">This Week</h3>
            <Link
              href="/calendar"
              className="text-sm text-primary flex items-center gap-1 hover:text-primary-hover transition-colors"
            >
              View Calendar
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 pt-1">
            {weekPreview.map((day) => {
              const hasWorkout = day.dayAssignments.length > 0 && (!day.beforePlanStart && !day.afterPlanEnd);
              const primaryAssignment = day.primaryAssignment;
              const color = primaryAssignment?.workoutType?.color || '#404040';
              const primaryName = primaryAssignment?.workoutType?.name ?? '';
              const isRotation = !!primaryAssignment?.rotationId;

              // Find the first active session for click navigation
              const firstSession = day.daySessions[0];

              const content = (
                <div
                  className={`
                    flex flex-col items-center gap-2 py-3 rounded-lg min-h-[110px] w-[75px] flex-shrink-0
                    ${day.isToday ? 'bg-surface ring-2 ring-primary' : 'bg-surface/50'}
                    ${hasWorkout ? 'hover:bg-surface transition-colors' : ''}
                    ${hasWorkout && day.isFuture ? 'opacity-60' : ''}
                  `}
                >
                  <span className="text-xs text-muted-foreground">{day.dayName.slice(0, 3)}</span>
                  <div className="relative">
                    <div
                      className="rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        width: '28px',
                        height: '28px',
                        backgroundColor: !hasWorkout ? 'transparent' : day.isFullyCompleted ? color : color + '30',
                        border: !hasWorkout ? '2px solid var(--border)' : day.isFullyCompleted ? 'none' : `2px solid ${color}`,
                      }}
                    >
                      {day.isFullyCompleted ? (
                        <Check size={14} className="text-white" />
                      ) : hasWorkout ? (
                        <span className="text-xs font-medium" style={{ color }}>
                          {isRotation ? '↻' : primaryName.charAt(0).toUpperCase()}
                        </span>
                      ) : null}
                    </div>
                    {hasWorkout && day.extraSlotCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-primary text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                        +{day.extraSlotCount}
                      </span>
                    )}
                  </div>
                  <span className="text-xs capitalize text-muted-foreground text-center leading-tight w-full px-1 truncate">
                    {hasWorkout ? primaryName : 'Rest'}
                  </span>
                </div>
              );

              if (firstSession && day.daySessions.length > 0) {
                // If day has exactly one session, go directly to it; otherwise go to home/today to pick
                return (
                  <div
                    key={day.dow}
                    onClick={() => {
                      if (day.daySessions.length === 1) {
                        router.push(`/workout/live?sessionId=${firstSession.id}`);
                      } else {
                        router.push(`/workout/today?date=${day.dateStr}`);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    {content}
                  </div>
                );
              }

              if (hasWorkout) {
                return (
                  <div
                    key={day.dow}
                    onClick={() => {
                      if (day.isFuture) {
                        if (primaryAssignment?.workoutType) {
                          router.push(`/workout/preview?workoutTypeId=${primaryAssignment.workoutType.id}&date=${day.dateStr}`);
                        }
                      } else {
                        router.push(`/workout/today?date=${day.dateStr}`);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    {content}
                  </div>
                );
              }

              return <div key={day.dow}>{content}</div>;
            })}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-success mb-2" />
            <span className="text-2xl font-bold text-foreground">{completedWorkouts}</span>
            <span className="text-xs text-muted-foreground text-center mt-1">Completed</span>
          </div>
          <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center">
            <Calendar className="w-5 h-5 text-primary mb-2" />
            <span className="text-2xl font-bold text-foreground">{currentStreak}</span>
            <span className="text-xs text-muted-foreground text-center mt-1">Streak</span>
          </div>
          <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center">
            <X className="w-5 h-5 mb-2" style={{ color: '#ef4444' }} />
            <span className="text-2xl font-bold text-foreground">{missedWorkouts}</span>
            <span className="text-xs text-muted-foreground text-center mt-1">Missed</span>
          </div>
        </div>

        {/* View Schedule */}
        <Link href="/schedule">
          <div className="bg-surface rounded-xl p-4 flex items-center justify-between hover:bg-surface-elevated transition-colors">
            <div>
              <p className="font-medium text-foreground">My Schedule</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Set(schedule.dayAssignments.map((a) => a.dayOfWeek)).size} training days
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </div>
        </Link>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
