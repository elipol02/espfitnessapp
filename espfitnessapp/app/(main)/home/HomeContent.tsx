'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/app/components/Button';
import { ChevronRight, CheckCircle2, X, Calendar, Check } from 'lucide-react';

interface DayAssignment {
  dayOfWeek: number;
  workoutType: {
    id: string;
    name: string;
    color: string;
    exerciseCount: number;
    exercises: { id: string; name: string }[];
  };
}

interface SessionData {
  id: string;
  workoutTypeId: string;
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
  activePlan: {
    id: string;
    name: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    planCompletionPercentage: number | null;
    dayAssignments: DayAssignment[];
  } | null;
  recentSessions: SessionData[];
  completedWorkouts: number;
  missedWorkouts: number;
  completionRateToDate: number;
  motivationalMessage: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

export function HomeContent({ data }: { data: HomeData }) {
  const router = useRouter();
  const { user, currentStreak, activePlan, recentSessions, completedWorkouts, missedWorkouts, motivationalMessage } = data;

  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  // Build week preview
  const clientToday = new Date();
  clientToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(clientToday);
  startOfWeek.setDate(clientToday.getDate() - clientToday.getDay());

  const planStartDate = activePlan?.startDate
    ? (() => { const d = new Date(activePlan.startDate); d.setHours(0, 0, 0, 0); return d; })()
    : null;

  const planEndDate = activePlan?.endDate
    ? (() => { const d = new Date(activePlan.endDate); d.setHours(0, 0, 0, 0); return d; })()
    : null;

  const weekPreview = DAY_NAMES.map((dayName, index) => {
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(startOfWeek.getDate() + index);
    const dateStr = dayDate.toLocaleDateString('en-CA'); // YYYY-MM-DD

    // Map JS day-of-week (0=Sun) to our 1=Mon..7=Sun
    const dow = DAY_MAP[index];

    const beforePlanStart = planStartDate ? dayDate < planStartDate : false;
    const afterPlanEnd = planEndDate ? dayDate > planEndDate : false;

    const rawAssignment = activePlan?.dayAssignments.find((a) => a.dayOfWeek === dow);
    const assignment = rawAssignment;

    const rawSession = recentSessions.find((s) => {
      // Use UTC date slice directly — sessions are stored as UTC midnight of the local date string
      const sDate = s.workoutDate.slice(0, 10);
      const matchedAssignment = activePlan?.dayAssignments.find((a) => a.dayOfWeek === dow);
      return sDate === dateStr && matchedAssignment && s.workoutTypeId === matchedAssignment.workoutType.id;
    });

    const session = rawSession;

    return {
      dayName,
      dateStr,
      dow,
      dayDate,
      isToday: index === clientToday.getDay(),
      isFuture: dayDate > clientToday,
      beforePlanStart,
      afterPlanEnd,
      assignment,
      session,
    };
  });

  const greeting = getGreeting();
  const userName = user?.name?.split(' ')[0] || 'there';


  // Today's workout
  const todayPreview = weekPreview.find((d) => d.isToday);
  const todayAssignment = todayPreview?.assignment;
  const todaySession = todayPreview?.session;

  const startOrResumeWorkout = (workoutTypeId: string, dateStr: string) => {
    router.push(`/workout/today?workoutTypeId=${workoutTypeId}&date=${dateStr}`);
  };

  if (!activePlan) {
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
          {motivationalMessage && (
            <p className="text-sm text-muted-foreground mt-1 italic">{motivationalMessage}</p>
          )}
        </div>

        {/* Progress */}
        {activePlan.planCompletionPercentage !== null ? (
          <div className="bg-surface rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Plan Completion</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{activePlan.planCompletionPercentage}%</span>
                {activePlan.endDate && (
                  <span className="text-xs text-muted-foreground">
                    ends {new Date(activePlan.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
            <div className="h-2 bg-background rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, activePlan.planCompletionPercentage)}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Today's Workout Card */}
        {todayAssignment ? (
          <div className="bg-surface rounded-2xl p-7 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground uppercase tracking-wide">Today&apos;s Workout</p>
                <h2 className="text-xl font-bold text-foreground mt-1">{todayAssignment.workoutType.name}</h2>
              </div>
              {todaySession?.status === 'completed' && (
                <div className="flex items-center gap-2 text-success">
                  <span className="text-sm font-medium">Completed</span>
                  <div className="w-6 h-6 rounded-full bg-success flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              {todayAssignment.workoutType.exercises.map((exercise) => (
                <div key={exercise.id} className="text-sm text-muted-foreground">
                  {exercise.name}
                </div>
              ))}
            </div>

            {todaySession?.status === 'in_progress' ? (
              <Button
                fullWidth
                size="lg"
                variant="secondary"
                onClick={() => router.push(`/workout/live?sessionId=${todaySession.id}`)}
              >
                Resume Workout
              </Button>
            ) : todaySession?.status === 'completed' ? (
              <Button
                fullWidth
                size="lg"
                variant="secondary"
                onClick={() => router.push(`/workout/live?sessionId=${todaySession.id}`)}
              >
                View Workout
              </Button>
            ) : (
              <Button
                fullWidth
                size="lg"
                onClick={() => startOrResumeWorkout(todayAssignment.workoutType.id, todayPreview!.dateStr)}
              >
                Start Workout
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-surface rounded-2xl p-6 text-center space-y-3">
            <div className="text-4xl">😴</div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Rest Day</h2>
              <p className="text-muted-foreground mt-1">Recovery is part of the process!</p>
            </div>
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
              const isCompleted = day.session?.status === 'completed';
              // Show workout indicator if: completed session exists, OR assigned day within plan date range
              const hasWorkout = !!day.assignment && (isCompleted || (!day.beforePlanStart && !day.afterPlanEnd));
              const color = day.assignment?.workoutType.color || '#404040';

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
                  <div
                    className="rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      width: '28px',
                      height: '28px',
                      backgroundColor: !hasWorkout ? 'transparent' : isCompleted ? color : color + '30',
                      border: !hasWorkout ? '2px solid var(--border)' : isCompleted ? 'none' : `2px solid ${color}`,
                    }}
                  >
                    {isCompleted ? (
                      <Check size={14} className="text-white" />
                    ) : hasWorkout ? (
                      <span className="text-xs font-medium" style={{ color }}>
                        {day.assignment!.workoutType.name.charAt(0).toUpperCase()}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs capitalize text-muted-foreground text-center leading-tight w-full px-1">
                    {hasWorkout ? day.assignment!.workoutType.name : 'Rest'}
                  </span>
                </div>
              );

              if (day.session) {
                return (
                  <div
                    key={day.dow}
                    onClick={() => router.push(`/workout/live?sessionId=${day.session!.id}`)}
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
                        router.push(`/workout/preview?workoutTypeId=${day.assignment!.workoutType.id}&date=${day.dateStr}`);
                      } else {
                        startOrResumeWorkout(day.assignment!.workoutType.id, day.dateStr);
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

        {/* View Plan */}
        <Link href={`/plan/${activePlan.id}`}>
          <div className="bg-surface rounded-xl p-4 flex items-center justify-between hover:bg-surface-elevated transition-colors">
            <div>
              <p className="font-medium text-foreground">{activePlan.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{activePlan.dayAssignments.length} training days</p>
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
