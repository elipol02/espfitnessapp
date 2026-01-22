'use client';

import Link from 'next/link';
import { Button } from '@/app/components/Button';
import { Target, ChevronRight, CalendarX, CheckCircle2, Calendar } from 'lucide-react';

interface WorkoutData {
  id: string;
  dayName: string;
  workoutType: string;
  workoutColor: string;
  scheduledDate: string | null;
  exercises: {
    id: string;
    name: string;
    sets: number;
    reps: number;
    restTime: number;
    exerciseType: string;
  }[];
}

interface WorkoutLogData {
  id: string;
  status: string;
}

interface HomeData {
  user: {
    name: string | null;
    bodyweight: number | null;
    onboardingCompleted: boolean;
  } | null;
  userStats: {
    currentStreak: number;
    progressPercentage: number;
  } | null;
  activePlan: {
    id: string;
    goal: string;
    status: string;
    startDate: string | null;
  } | null;
  currentWorkout: WorkoutData | null;
  previousWorkout: WorkoutData | null;
  nextWorkout: WorkoutData | null;
  currentLog: WorkoutLogData | null;
  previousLog: WorkoutLogData | null;
  nextLog: WorkoutLogData | null;
  weekPreview: {
    id: string | null;
    dayNumber: number;
    dayName: string;
    workoutType: string;
    workoutColor: string;
    exerciseCount: number;
    isGenerated: boolean;
    logId: string | null;
    logStatus: string | null;
    scheduledDate: string | null;
    calculatedDate: string;
  }[];
  daysMissed: number;
  completedWorkouts: number;
  weeksRemaining: number;
}

export function HomeContent({ data }: { data: HomeData }) {
  const { user, userStats, activePlan, currentWorkout, previousWorkout, nextWorkout, currentLog, previousLog, nextLog, weekPreview, daysMissed, completedWorkouts, weeksRemaining } = data;

  const today = new Date();
  const todayISO = today.toISOString();
  const formattedDate = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const greeting = getGreeting();
  const userName = user?.name?.split(' ')[0] || 'there';

  // Determine which workout is "today's workout" based on local time
  // Compare the scheduled dates with the client's local date
  const localToday = new Date();
  localToday.setHours(0, 0, 0, 0);
  
  let todayWorkout: WorkoutData | null = null;
  let todayLog: WorkoutLogData | null = null;

  // Check each workout to see which one matches today's local date
  if (currentWorkout?.scheduledDate) {
    const scheduledDate = new Date(currentWorkout.scheduledDate);
    scheduledDate.setHours(0, 0, 0, 0);
    if (scheduledDate.getTime() === localToday.getTime()) {
      todayWorkout = currentWorkout;
      todayLog = currentLog;
    }
  }

  if (!todayWorkout && previousWorkout?.scheduledDate) {
    const scheduledDate = new Date(previousWorkout.scheduledDate);
    scheduledDate.setHours(0, 0, 0, 0);
    if (scheduledDate.getTime() === localToday.getTime()) {
      todayWorkout = previousWorkout;
      todayLog = previousLog;
    }
  }

  if (!todayWorkout && nextWorkout?.scheduledDate) {
    const scheduledDate = new Date(nextWorkout.scheduledDate);
    scheduledDate.setHours(0, 0, 0, 0);
    if (scheduledDate.getTime() === localToday.getTime()) {
      todayWorkout = nextWorkout;
      todayLog = nextLog;
    }
  }

  // No active plan - show empty state
  if (!activePlan) {
    return (
    <div className="px-5 pt-10 pb-28">
      <div className="max-w-lg mx-auto space-y-8">
          {/* Header */}
          <div>
            <p className="text-muted-foreground">{formattedDate}</p>
            <h1 className="text-2xl font-bold text-foreground mt-1">
              {greeting}, {userName}!
            </h1>
          </div>

          {/* Empty State */}
          <div className="bg-surface rounded-2xl p-10 text-center space-y-8">
            <div className="text-6xl">🏋️</div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">
                Start your fitness journey
              </h2>
              <p className="text-muted-foreground">
                Create your first personalized workout plan with AI
              </p>
            </div>
            <Link href="/chat/create">
              <Button size="lg" fullWidth>
                Create Your Plan
              </Button>
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

        {/* Progress toward goal */}
        {userStats && userStats.progressPercentage > 0 && (
          <div className="bg-surface rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-2">
                <Target className="w-4 h-4" />
                Progress toward goal
              </span>
              <span className="font-medium text-foreground">
                {Math.round(userStats.progressPercentage)}%
              </span>
            </div>
            <div className="h-2 bg-background rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, userStats.progressPercentage)}%` }}
              />
            </div>
          </div>
        )}

        {/* Today's Workout Card */}
        {todayWorkout ? (
          <div className="bg-surface rounded-2xl p-7 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground uppercase tracking-wide">
                  Today&apos;s Workout
                </p>
                <h2 className="text-xl font-bold text-foreground mt-1">
                  {todayWorkout.workoutType.charAt(0).toUpperCase() + todayWorkout.workoutType.slice(1)}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{todayWorkout.exercises.length} exercises</span>
              <span>~{calculateWorkoutDuration(todayWorkout.exercises)} min</span>
            </div>

            {/* Exercise List */}
            <div className="space-y-2">
              {todayWorkout.exercises.map((exercise) => (
                <div
                  key={exercise.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-foreground">{exercise.name}</span>
                  <span className="text-muted-foreground">
                    {formatExerciseDisplay(exercise)}
                  </span>
                </div>
              ))}
            </div>

            {/* Action Button */}
            {todayLog?.status === 'in_progress' ? (
              <Link href={`/workout/live?logId=${todayLog.id}`}>
                <Button fullWidth size="lg" variant="secondary">
                  Resume Workout
                </Button>
              </Link>
            ) : todayLog?.status === 'completed' ? (
              <Link href={`/workout/live?logId=${todayLog.id}`}>
                <Button fullWidth size="lg" variant="secondary">
                  View Workout
                </Button>
              </Link>
            ) : (
              <Link href={`/workout/live?dayId=${todayWorkout.id}&planId=${activePlan.id}&date=${todayISO}`}>
                <Button fullWidth size="lg">
                  Start Workout
                </Button>
              </Link>
            )}
          </div>
        ) : (
          /* Rest Day */
          <div className="bg-surface rounded-2xl p-6 text-center space-y-3">
            <div className="text-4xl">😴</div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Rest Day</h2>
              <p className="text-muted-foreground mt-1">
                Recovery is part of the process!
              </p>
            </div>
          </div>
        )}

        {/* Week Preview */}
        {weekPreview.length > 0 && (
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
              {weekPreview.map((day, index) => {
                const isToday = index === new Date().getDay();
                const dayAbbr = day.dayName.slice(0, 3);
                const hasWorkout = day.id && day.workoutType !== 'rest' && day.exerciseCount > 0;
                const isCompleted = day.logStatus === 'completed';
                
                // Check if this workout is in the future
                const isFuture = day.scheduledDate ? (() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const scheduledDate = new Date(day.scheduledDate);
                  scheduledDate.setHours(0, 0, 0, 0);
                  return scheduledDate > today;
                })() : false;

                const content = (
                  <div
                    className={`
                      flex flex-col items-center gap-2 py-3 rounded-lg min-h-[110px] w-[75px] flex-shrink-0
                      ${isToday ? 'bg-surface ring-2 ring-primary' : 'bg-surface/50'}
                      ${hasWorkout && !isCompleted ? 'cursor-pointer hover:bg-surface transition-colors' : ''}
                    `}
                  >
                    <span className="text-xs text-muted-foreground">{dayAbbr}</span>
                    <div
                      className="rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ 
                        width: '28px',
                        height: '28px',
                        backgroundColor: day.workoutType === 'rest' 
                          ? 'transparent' 
                          : isCompleted
                          ? day.workoutColor
                          : day.workoutColor + '30',
                        border: day.workoutType === 'rest' 
                          ? '2px solid var(--border)' 
                          : isCompleted
                          ? 'none'
                          : `2px solid ${day.workoutColor}`,
                      }}
                    >
                      {isCompleted ? (
                        <span className="text-white text-xs">✓</span>
                      ) : (
                        <span className="text-xs font-medium" style={{ color: day.workoutType === 'rest' ? 'var(--muted)' : day.workoutColor }}>
                          {day.workoutType === 'rest' ? '' : day.workoutType.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="text-xs capitalize text-muted-foreground text-center leading-tight w-full px-1">
                      {day.workoutType}
                    </span>
                  </div>
                );

                // If completed, link to view
                if (isCompleted && day.logId) {
                  return (
                    <Link
                      key={day.dayNumber}
                      href={`/workout/live?logId=${day.logId}`}
                    >
                      {content}
                    </Link>
                  );
                }

                // If has workout log (in progress), link to resume
                if (hasWorkout && day.logId) {
                  return (
                    <Link
                      key={day.dayNumber}
                      href={`/workout/live?logId=${day.logId}`}
                    >
                      {content}
                    </Link>
                  );
                }

                // If has workout but no log - check if future or not
                if (hasWorkout && day.isGenerated) {
                  // For future workouts, add preview=true
                  const url = isFuture
                    ? `/workout/live?dayId=${day.id}&planId=${activePlan.id}&date=${day.calculatedDate}&preview=true`
                    : `/workout/live?dayId=${day.id}&planId=${activePlan.id}&date=${day.calculatedDate}`;
                  
                  return (
                    <Link
                      key={day.dayNumber}
                      href={url}
                    >
                      {content}
                    </Link>
                  );
                }

                // Rest day or no workout generated yet
                return (
                  <div key={day.dayNumber}>
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          {/* Completed Workouts */}
          <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-success mb-2" />
            <span className="text-2xl font-bold text-foreground">
              {completedWorkouts}
            </span>
            <span className="text-xs text-muted-foreground text-center mt-1">
              Completed
            </span>
          </div>

          {/* Workouts Missed */}
          <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center">
            <CalendarX className="w-5 h-5 text-muted-foreground mb-2" />
            <span className="text-2xl font-bold text-foreground">
              {daysMissed}
            </span>
            <span className="text-xs text-muted-foreground text-center mt-1">
              Missed
            </span>
          </div>

          {/* Weeks Remaining */}
          <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center">
            <Calendar className="w-5 h-5 text-primary mb-2" />
            <span className="text-2xl font-bold text-foreground">
              {weeksRemaining}
            </span>
            <span className="text-xs text-muted-foreground text-center mt-1">
              Weeks left
            </span>
          </div>
        </div>
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

function calculateWorkoutDuration(exercises: { sets: number; reps: number; restTime: number; exerciseType: string }[]): number {
  let totalMinutes = 0;
  
  for (const exercise of exercises) {
    if (exercise.exerciseType === 'cardio_time' || exercise.exerciseType === 'mobility_time') {
      // For time-based exercises, reps = duration in minutes
      totalMinutes += exercise.reps;
    } else {
      // For strength exercises: estimate set time + rest time
      const estimatedSetTime = 30; // seconds per set (average time to complete reps)
      const totalSetTime = (estimatedSetTime * exercise.sets) / 60; // convert to minutes
      const totalRestTime = (exercise.restTime * (exercise.sets - 1)) / 60; // rest between sets
      totalMinutes += totalSetTime + totalRestTime;
    }
  }
  
  return Math.round(totalMinutes);
}

function formatExerciseDisplay(exercise: { sets: number; reps: number; exerciseType: string }): string {
  if (exercise.exerciseType === 'cardio_time' || exercise.exerciseType === 'mobility_time') {
    return `${exercise.reps} min`;
  }
  return `${exercise.sets}×${exercise.reps}`;
}
