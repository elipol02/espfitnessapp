'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/app/components/Button';

interface CalendarData {
  workoutDays: {
    id: string;
    dayNumber: number;
    dayName: string;
    scheduledDate: string | null;
    workoutType: string;
    workoutColor: string;
    isGenerated: boolean;
  }[];
  workoutLogs: {
    id: string;
    dayId: string;
    workoutDate: string;
    status: string;
  }[];
  planId: string | null;
  startDate: string | null;
  programEndDate: string | null;
  weeksDuration: number;
}

type ViewMode = 'month' | 'week';

export function CalendarContent({ data }: { data: CalendarData }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  const { workoutDays, workoutLogs, planId, startDate, programEndDate } = data;

  // Check if a date is before the plan start date
  const isBeforeStartDate = (date: Date) => {
    if (!startDate) return false;
    // Parse the ISO date as local date to avoid timezone issues
    const startDateOnly = startDate.split('T')[0]; // Get YYYY-MM-DD part
    const [year, month, day] = startDateOnly.split('-').map(Number);
    const start = new Date(year, month - 1, day);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate < start;
  };

  // Check if a date is after the program end date (for programs with limited duration)
  const isAfterProgramEnd = (date: Date) => {
    if (!programEndDate) return false;
    // Parse the ISO date as local date to avoid timezone issues
    const endDateOnly = programEndDate.split('T')[0]; // Get YYYY-MM-DD part
    const [year, month, day] = endDateOnly.split('-').map(Number);
    const end = new Date(year, month - 1, day);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate > end;
  };

  // Check if a date is in the future (for greying out and preventing submission)
  const isFutureDate = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate > today;
  };

  // Get workout for a specific date by matching scheduledDate
  const getWorkoutForDate = (date: Date) => {
    // First try to find by scheduledDate
    const workout = workoutDays.find((d) => {
      if (!d.scheduledDate) return false;
      // Parse the ISO date as local date to avoid timezone issues
      const scheduledDateOnly = d.scheduledDate.split('T')[0]; // Get YYYY-MM-DD part
      const [year, month, day] = scheduledDateOnly.split('-').map(Number);
      const scheduled = new Date(year, month - 1, day);
      return (
        scheduled.getFullYear() === date.getFullYear() &&
        scheduled.getMonth() === date.getMonth() &&
        scheduled.getDate() === date.getDate()
      );
    });
    
    // If no scheduled workout found, fall back to day of week matching (for legacy plans)
    if (!workout) {
      return workoutDays.find((d) => d.dayNumber === date.getDay());
    }
    
    return workout;
  };

  // Check if a date has a workout log that matches the scheduled workout for that day
  const getLogForDate = (date: Date, dayId?: string) => {
    return workoutLogs.find((log) => {
      const logDate = new Date(log.workoutDate);
      const dateMatches = 
        logDate.getFullYear() === date.getFullYear() &&
        logDate.getMonth() === date.getMonth() &&
        logDate.getDate() === date.getDate();
      
      // Must match both the date AND the scheduled workout (dayId)
      return dateMatches && (!dayId || log.dayId === dayId);
    });
  };

  // Navigation
  const goToPrevious = () => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else {
      setCurrentDate(new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000));
    }
  };

  const goToNext = () => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else {
      setCurrentDate(new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Generate calendar days for month view
  const generateMonthDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days: (Date | null)[] = [];

    // Add padding for days before month starts
    for (let i = 0; i < startPadding; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let i = 1; i <= totalDays; i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  // Generate week days
  const generateWeekDays = () => {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(new Date(startOfWeek.getTime() + i * 24 * 60 * 60 * 1000));
    }

    return days;
  };

  const today = new Date();
  const isToday = (date: Date) =>
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  // Empty state
  if (workoutDays.length === 0) {
    return (
      <div className="px-4 pt-8 pb-24">
        <div className="max-w-lg mx-auto space-y-8">
          <h1 className="text-2xl font-bold text-foreground">Calendar</h1>

          <div className="bg-surface rounded-2xl p-10 text-center space-y-6">
            <div className="text-6xl">📅</div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">No workouts scheduled</h2>
              <p className="text-muted-foreground">
                Create a workout plan to see your schedule here
              </p>
            </div>
            <Link href="/chat/create">
              <Button size="lg">Create a Plan</Button>
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
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
          
          {/* View Toggle */}
          <div className="flex bg-surface rounded-lg p-1">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                viewMode === 'month'
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                viewMode === 'week'
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Week
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={goToPrevious}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors touch-target"
          >
            <ChevronLeft size={24} />
          </button>

          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium text-foreground">
              {currentDate.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </h2>
            <button
              onClick={goToToday}
              className="px-2 py-1 text-xs bg-surface rounded border border-border 
                       text-muted-foreground hover:text-foreground transition-colors"
            >
              Today
            </button>
          </div>

          <button
            onClick={goToNext}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors touch-target"
          >
            <ChevronRight size={24} />
          </button>
        </div>

        {/* Calendar Grid */}
        {viewMode === 'month' ? (
          <div className="bg-surface rounded-2xl p-5">
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-2">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                <div
                  key={i}
                  className="text-center text-sm text-muted-foreground font-medium py-2"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1">
              {generateMonthDays().map((date, i) => {
                if (!date) {
                  return <div key={i} className="aspect-square" />;
                }

                const workout = getWorkoutForDate(date);
                const log = getLogForDate(date, workout?.id);
                const isTodayDate = isToday(date);
                const isCompleted = log?.status === 'completed';
                const beforeStart = isBeforeStartDate(date);
                const afterEnd = isAfterProgramEnd(date);
                const isFuture = isFutureDate(date);
                const isGenerated = workout?.isGenerated ?? false;
                // Allow clicking workouts that are generated, even if they're in the future
                const isClickable = workout && planId && !beforeStart && !afterEnd && isGenerated;

                return (
                  <Link
                    key={i}
                    href={
                      isClickable
                        ? log
                          ? `/workout/live?logId=${log.id}`
                          : `/workout/live?dayId=${workout.id}&planId=${planId}&date=${date.toISOString()}${isFuture ? '&preview=true' : ''}`
                        : '#'
                    }
                    className={`
                      aspect-square flex flex-col items-center justify-center rounded-lg
                      transition-colors relative gap-0.5 p-1
                      ${isTodayDate ? 'ring-2 ring-primary' : ''}
                      ${isClickable ? 'hover:bg-surface-elevated cursor-pointer' : 'cursor-default'}
                      ${beforeStart || afterEnd ? 'opacity-30' : ''}
                    `}
                    onClick={(e) => {
                      if (!isClickable) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <span
                      className={`text-sm ${
                        isTodayDate ? 'font-bold text-primary' : 'text-foreground'
                      }`}
                    >
                      {date.getDate()}
                    </span>

                    {workout && workout.workoutType !== 'rest' && workout.workoutType !== 'Rest' && !beforeStart && !afterEnd && (
                      <div
                        className={`
                          w-6 h-6 rounded-full flex items-center justify-center
                          ${isCompleted ? '' : 'border-2'}
                          ${!isGenerated ? 'opacity-40' : ''}
                        `}
                        style={{
                          backgroundColor: isCompleted ? workout.workoutColor : 'transparent',
                          borderColor: workout.workoutColor,
                        }}
                      >
                        {isCompleted && <Check size={14} className="text-white" />}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : (
          /* Week View */
          <div className="space-y-3">
            {generateWeekDays().map((date) => {
              const workout = getWorkoutForDate(date);
              const log = getLogForDate(date, workout?.id);
              const isTodayDate = isToday(date);
              const isCompleted = log?.status === 'completed';
              const beforeStart = isBeforeStartDate(date);
              const afterEnd = isAfterProgramEnd(date);
              const isFuture = isFutureDate(date);
              const isGenerated = workout?.isGenerated ?? false;

              return (
                <div
                  key={date.toISOString()}
                  className={`
                    bg-surface rounded-xl p-4 
                    ${isTodayDate ? 'ring-2 ring-primary' : ''}
                    ${beforeStart || afterEnd ? 'opacity-50' : ''}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground uppercase">
                          {date.toLocaleDateString('en-US', { weekday: 'short' })}
                        </p>
                        <p className={`text-lg font-bold ${isTodayDate ? 'text-primary' : 'text-foreground'}`}>
                          {date.getDate()}
                        </p>
                      </div>

                      {workout ? (
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: workout.workoutColor }}
                          />
                          <span className="font-medium text-foreground capitalize">
                            {workout.workoutType}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Rest Day</span>
                      )}
                    </div>

                    {workout && workout.workoutType !== 'rest' && workout.workoutType !== 'Rest' && !beforeStart && !afterEnd && (
                      isFuture ? (
                        isGenerated ? (
                          <Link href={`/workout/live?dayId=${workout.id}&planId=${planId}&date=${date.toISOString()}&preview=true`}>
                            <Button size="sm" variant="secondary">
                              Preview
                            </Button>
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground opacity-60">Coming soon</span>
                        )
                      ) : isCompleted && log ? (
                        <Link href={`/workout/live?logId=${log.id}`}>
                          <Button size="sm" variant="secondary">
                            View
                          </Button>
                        </Link>
                      ) : !isGenerated ? (
                        <span className="text-xs text-muted-foreground opacity-60">Coming soon</span>
                      ) : log ? (
                        <Link href={`/workout/live?logId=${log.id}`}>
                          <Button size="sm" variant="secondary">
                            Resume
                          </Button>
                        </Link>
                      ) : (
                        <Link href={`/workout/live?dayId=${workout.id}&planId=${planId}&date=${date.toISOString()}`}>
                          <Button size="sm" variant={isTodayDate ? 'primary' : 'secondary'}>
                            Start
                          </Button>
                        </Link>
                      )
                    )}
                    {(beforeStart || afterEnd) && workout && workout.workoutType !== 'rest' && workout.workoutType !== 'Rest' && (
                      <span className="text-xs text-muted-foreground">{beforeStart ? 'Not started' : 'Program ended'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 justify-center text-sm">
          {Array.from(new Set(workoutDays.map((d) => d.workoutType))).map((type) => {
            const day = workoutDays.find((d) => d.workoutType === type);
            if (!day || type === 'rest') return null;

            return (
              <div key={type} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: day.workoutColor }}
                />
                <span className="text-muted-foreground capitalize">{type}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
