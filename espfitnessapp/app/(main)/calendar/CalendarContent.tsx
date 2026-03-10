'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/app/components/Button';
import { useRestTimer } from '@/app/components/RestTimerBadge';

interface DayAssignment {
  dayOfWeek: number;
  workoutType: {
    id: string;
    name: string;
    color: string;
  };
}

interface SessionData {
  id: string;
  workoutTypeId: string;
  workoutDate: string;
  status: string;
}

interface CalendarData {
  planId: string | null;
  startDate: string | null;
  endDate: string | null;
  dayAssignments: DayAssignment[];
  sessions: SessionData[];
}

type ViewMode = 'month' | 'week';

const DAY_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

export function CalendarContent({ data }: { data: CalendarData }) {
  const restTimer = useRestTimer();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  const { startDate, endDate, dayAssignments, sessions } = data;

  const planStartDate = startDate ? (() => { const d = new Date(startDate); d.setHours(0, 0, 0, 0); return d; })() : null;
  const planEndDate = endDate ? (() => { const d = new Date(endDate); d.setHours(0, 0, 0, 0); return d; })() : null;

  const isBeforePlanStart = (date: Date): boolean => {
    if (!planStartDate) return false;
    const check = new Date(date);
    check.setHours(0, 0, 0, 0);
    return check < planStartDate;
  };

  const isAfterPlanEnd = (date: Date): boolean => {
    if (!planEndDate) return false;
    const check = new Date(date);
    check.setHours(0, 0, 0, 0);
    return check > planEndDate;
  };

  const getAssignmentForDate = (date: Date): DayAssignment | undefined => {
    const dow = DAY_MAP[date.getDay()];
    return dayAssignments.find((a) => a.dayOfWeek === dow);
  };

  const getSessionForDate = (date: Date, workoutTypeId?: string): SessionData | undefined => {
    const dateStr = date.toLocaleDateString('en-CA');
    return sessions.find((s) => {
      // Use UTC date slice directly — sessions are stored as UTC midnight of the local date string,
      // so reading via toLocaleDateString would shift the date in non-UTC timezones.
      const sDate = s.workoutDate.slice(0, 10);
      return sDate === dateStr && (!workoutTypeId || s.workoutTypeId === workoutTypeId);
    });
  };

  const isFutureDate = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const check = new Date(date);
    check.setHours(0, 0, 0, 0);
    return check > today;
  };

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

  const goToToday = () => setCurrentDate(new Date());

  const generateMonthDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const days: (Date | null)[] = [];
    for (let i = 0; i < startPadding; i++) days.push(null);
    for (let i = 1; i <= totalDays; i++) days.push(new Date(year, month, i));
    return days;
  };

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

  if (dayAssignments.length === 0) {
    return (
      <div className="px-4 pt-8 pb-24">
        <div className="max-w-lg mx-auto space-y-8">
          <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
          <div className="bg-surface rounded-2xl p-10 text-center space-y-6">
            <div className="text-6xl">📅</div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">No workouts scheduled</h2>
              <p className="text-muted-foreground">Create a workout plan to see your schedule here</p>
            </div>
            <Link href="/chat">
              <Button size="lg">Create a Plan</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="px-5 py-3 max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
          <div className={`flex bg-surface rounded-lg p-1 transition-all duration-200 ${restTimer !== null ? 'mr-24' : ''}`}>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${viewMode === 'month' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${viewMode === 'week' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Week
            </button>
          </div>
        </div>
      </div>

    <div className="px-5 py-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button onClick={goToPrevious} className="p-2 text-muted-foreground hover:text-foreground transition-colors touch-target">
            <ChevronLeft size={24} />
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium text-foreground">
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <button
              onClick={goToToday}
              className="px-2 py-1 text-xs bg-surface rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Today
            </button>
          </div>
          <button onClick={goToNext} className="p-2 text-muted-foreground hover:text-foreground transition-colors touch-target">
            <ChevronRight size={24} />
          </button>
        </div>

        {/* Calendar Grid */}
        {viewMode === 'month' ? (
          <div className="bg-surface rounded-2xl p-5">
            <div className="grid grid-cols-7 mb-2">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                <div key={i} className="text-center text-sm text-muted-foreground font-medium py-2">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {generateMonthDays().map((date, i) => {
                if (!date) return <div key={i} className="aspect-square" />;

                const assignment = getAssignmentForDate(date);
                const session = getSessionForDate(date, assignment?.workoutType.id);
                const isTodayDate = isToday(date);
                const isCompleted = session?.status === 'completed';
                const future = isFutureDate(date);
                const beforePlanStart = isBeforePlanStart(date);
                const afterPlanEnd = isAfterPlanEnd(date);
                // Always show completed sessions; only show uncompleted indicators within plan date range
                const hasWorkout = !!assignment && (isCompleted || (!beforePlanStart && !afterPlanEnd));
                const dateStr = date.toLocaleDateString('en-CA');

                const workoutHref = hasWorkout
                  ? session
                    ? `/workout/live?sessionId=${session.id}`
                    : future
                      ? `/workout/preview?workoutTypeId=${assignment!.workoutType.id}&date=${dateStr}`
                      : `/workout/today?workoutTypeId=${assignment!.workoutType.id}&date=${dateStr}`
                  : null;

                const cellClass = `
                  aspect-square flex flex-col items-center justify-center rounded-lg
                  transition-colors relative gap-1.25 p-1
                  ${isTodayDate ? 'ring-2 ring-primary' : ''}
                  ${hasWorkout ? 'hover:bg-surface-elevated cursor-pointer' : 'cursor-default'}
                `;

                const cellContent = (
                  <>
                    <span className={`text-sm leading-none ${isTodayDate ? 'font-bold text-primary' : 'text-foreground'}`}>
                      {date.getDate()}
                    </span>
                    {hasWorkout && (
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center mb-0.5 ${isCompleted ? '' : 'border-2'}`}
                        style={{
                          backgroundColor: isCompleted ? assignment!.workoutType.color : 'transparent',
                          borderColor: assignment!.workoutType.color,
                        }}
                      >
                        {isCompleted && <Check size={14} className="text-white" />}
                      </div>
                    )}
                  </>
                );

                return workoutHref ? (
                  <Link key={i} href={workoutHref} className={cellClass}>
                    {cellContent}
                  </Link>
                ) : (
                  <div key={i} className={cellClass}>
                    {cellContent}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {generateWeekDays().map((date) => {
              const assignment = getAssignmentForDate(date);
              const beforePlanStart = isBeforePlanStart(date);
              const afterPlanEnd = isAfterPlanEnd(date);
              const session = getSessionForDate(date, assignment?.workoutType.id);
              const isTodayDate = isToday(date);
              const isCompleted = session?.status === 'completed';
              const future = isFutureDate(date);
              const dateStr = date.toLocaleDateString('en-CA');
              // Show workout row if completed session exists, or date is within plan date range
              const showWorkout = !!assignment && (isCompleted || (!beforePlanStart && !afterPlanEnd));

              return (
                <div
                  key={date.toISOString()}
                  className={`bg-surface rounded-xl p-4 ${isTodayDate ? 'ring-2 ring-primary' : ''}`}
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
                      {showWorkout ? (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: assignment!.workoutType.color }} />
                          <span className="font-medium text-foreground">{assignment!.workoutType.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Rest Day</span>
                      )}
                    </div>

                    {showWorkout && (
                      future ? (
                        <Link
                          href={`/workout/preview?workoutTypeId=${assignment!.workoutType.id}&date=${dateStr}`}
                          className="inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-150 touch-target px-3 py-1.5 text-sm min-h-[36px] bg-surface hover:bg-surface-elevated text-foreground border border-border"
                        >
                          Preview
                        </Link>
                      ) : session ? (
                        <Link
                          href={`/workout/live?sessionId=${session.id}`}
                          className="inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-150 touch-target px-3 py-1.5 text-sm min-h-[36px] bg-surface hover:bg-surface-elevated text-foreground border border-border"
                        >
                          {isCompleted ? 'View' : 'Resume'}
                        </Link>
                      ) : (
                        <Link
                          href={`/workout/today?workoutTypeId=${assignment!.workoutType.id}&date=${dateStr}`}
                          className={`inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-150 touch-target px-3 py-1.5 text-sm min-h-[36px] ${isTodayDate ? 'bg-primary hover:bg-primary-hover text-white' : 'bg-surface hover:bg-surface-elevated text-foreground border border-border'}`}
                        >
                          Start
                        </Link>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 justify-center text-sm">
          {dayAssignments.map((da) => (
            <div key={da.dayOfWeek} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: da.workoutType.color }} />
              <span className="text-muted-foreground">{da.workoutType.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
