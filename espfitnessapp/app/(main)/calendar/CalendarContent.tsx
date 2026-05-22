'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/app/components/Button';
import { useRestTimer } from '@/app/components/RestTimerBadge';

interface WorkoutRef {
  id: string;
  name: string;
  color: string;
}

interface Slot {
  dayOfWeek: number;
  order: number;
  rotationId: string | null;
  workoutType: WorkoutRef | null;
  rotation: { id: string; currentIndex: number; entries: WorkoutRef[] } | null;
}

interface SessionData {
  id: string;
  workoutTypeId: string;
  rotationId: string | null;
  workoutDate: string;
  status: string;
}

interface CalendarData {
  planId: string | null;
  startDate: string | null;
  endDate: string | null;
  slots: Slot[];
  sessions: SessionData[];
}

/** A slot resolved to a concrete workout for a specific calendar date. */
interface ResolvedSlot {
  order: number;
  rotationId: string | null;
  workout: WorkoutRef;
  label: string | null; // 'A', 'B', … for rotation slots
  session: SessionData | undefined;
  isCompleted: boolean;
}

type ViewMode = 'month' | 'week';

const DAY_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

export function CalendarContent({ data }: { data: CalendarData }) {
  const restTimer = useRestTimer();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [pickerDate, setPickerDate] = useState<Date | null>(null);

  const { startDate, endDate, slots, sessions } = data;

  const planStartDate = startDate ? (() => { const d = new Date(startDate); d.setHours(0, 0, 0, 0); return d; })() : null;
  const planEndDate = endDate ? (() => { const d = new Date(endDate); d.setHours(0, 0, 0, 0); return d; })() : null;

  // ── Rotation projection ──────────────────────────────────────────────────
  // For each rotation, walk the plan day-by-day building the chronological list
  // of its scheduled occurrences. The first occurrence on/after today maps to the
  // rotation's currentIndex; every other occurrence steps the index forward or
  // backward, producing the A/B/A… cycle across real dates.
  const rotationProjections = useMemo(() => {
    const map = new Map<string, {
      entries: WorkoutRef[];
      currentIndex: number;
      indexByDate: Map<string, number>;
      anchorIndex: number;
    }>();
    if (!planStartDate) return map;

    const dowsByRot = new Map<string, Set<number>>();
    const rotById = new Map<string, { currentIndex: number; entries: WorkoutRef[] }>();
    for (const s of slots) {
      if (!s.rotationId || !s.rotation) continue;
      if (!dowsByRot.has(s.rotationId)) dowsByRot.set(s.rotationId, new Set());
      dowsByRot.get(s.rotationId)!.add(s.dayOfWeek);
      rotById.set(s.rotationId, { currentIndex: s.rotation.currentIndex, entries: s.rotation.entries });
    }

    const cap = planEndDate ?? (() => { const d = new Date(planStartDate); d.setDate(d.getDate() + 365); return d; })();
    const todayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

    for (const [rotId, dows] of dowsByRot) {
      const rot = rotById.get(rotId)!;
      const indexByDate = new Map<string, number>();
      let occ = 0;
      let anchorIndex = -1;
      const d = new Date(planStartDate);
      while (d.getTime() <= cap.getTime()) {
        if (dows.has(DAY_MAP[d.getDay()])) {
          indexByDate.set(d.toLocaleDateString('en-CA'), occ);
          if (anchorIndex === -1 && d.getTime() >= todayStart.getTime()) anchorIndex = occ;
          occ++;
        }
        d.setDate(d.getDate() + 1);
      }
      if (anchorIndex === -1) anchorIndex = occ; // entire rotation is in the past
      map.set(rotId, { entries: rot.entries, currentIndex: rot.currentIndex, indexByDate, anchorIndex });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, startDate, endDate]);

  const resolveRotationEntry = (rotationId: string, dateStr: string): { workout: WorkoutRef; label: string } | null => {
    const proj = rotationProjections.get(rotationId);
    if (!proj || proj.entries.length === 0) return null;
    const len = proj.entries.length;
    const p = proj.indexByDate.get(dateStr);
    const raw = p === undefined ? proj.currentIndex : proj.currentIndex + (p - proj.anchorIndex);
    const idx = ((raw % len) + len) % len;
    return { workout: proj.entries[idx], label: String.fromCharCode(65 + idx) };
  };

  const getResolvedSlots = (date: Date): ResolvedSlot[] => {
    const dow = DAY_MAP[date.getDay()];
    const dateStr = date.toLocaleDateString('en-CA');
    const daySlots = slots.filter((s) => s.dayOfWeek === dow).sort((a, b) => a.order - b.order);
    const resolved: ResolvedSlot[] = [];

    for (const s of daySlots) {
      let workout: WorkoutRef | null = null;
      let label: string | null = null;

      if (s.rotation && s.rotationId) {
        const r = resolveRotationEntry(s.rotationId, dateStr);
        if (r) { workout = r.workout; label = r.label; }
      } else if (s.workoutType) {
        workout = s.workoutType;
      }
      if (!workout) continue;

      // Sessions are stored as UTC midnight of the local date string, so compare the raw slice.
      const session = s.rotationId
        ? sessions.find((se) => se.workoutDate.slice(0, 10) === dateStr &&
            (se.rotationId === s.rotationId || (s.rotation?.entries.some((e) => e.id === se.workoutTypeId) ?? false)))
        : sessions.find((se) => se.workoutDate.slice(0, 10) === dateStr && se.workoutTypeId === workout!.id);

      // If a real session exists for a rotation day, show what was actually recorded.
      if (session && s.rotation) {
        const actualIdx = s.rotation.entries.findIndex((e) => e.id === session.workoutTypeId);
        if (actualIdx >= 0) {
          workout = s.rotation.entries[actualIdx];
          label = String.fromCharCode(65 + actualIdx);
        }
      }

      resolved.push({
        order: s.order,
        rotationId: s.rotationId,
        workout,
        label,
        session,
        isCompleted: session?.status === 'completed',
      });
    }
    return resolved;
  };

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

  const isFutureDate = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const check = new Date(date);
    check.setHours(0, 0, 0, 0);
    return check > today;
  };

  // Slots to display for a date, honoring plan range (completed sessions always show).
  const getVisibleSlots = (date: Date): ResolvedSlot[] => {
    const inRange = !isBeforePlanStart(date) && !isAfterPlanEnd(date);
    return getResolvedSlots(date).filter((rs) => rs.isCompleted || inRange);
  };

  const slotHref = (date: Date, rs: ResolvedSlot): string => {
    const dateStr = date.toLocaleDateString('en-CA');
    if (rs.session) return `/workout/live?sessionId=${rs.session.id}`;
    if (isFutureDate(date)) return `/workout/preview?workoutTypeId=${rs.workout.id}&date=${dateStr}`;
    if (rs.rotationId) return `/workout/today?rotationId=${rs.rotationId}&date=${dateStr}`;
    return `/workout/today?workoutTypeId=${rs.workout.id}&date=${dateStr}`;
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

  // Legend: every distinct workout type, including each rotation entry.
  const legendItems = useMemo(() => {
    const map = new Map<string, WorkoutRef>();
    for (const s of slots) {
      if (s.rotation) for (const e of s.rotation.entries) map.set(e.id, e);
      else if (s.workoutType) map.set(s.workoutType.id, s.workoutType);
    }
    return [...map.values()];
  }, [slots]);

  if (slots.length === 0) {
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

                const isTodayDate = isToday(date);
                const visibleSlots = getVisibleSlots(date);
                const hasWorkout = visibleSlots.length > 0;
                const single = visibleSlots.length === 1 ? visibleSlots[0] : null;

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
                    {single ? (
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center mb-0.5 ${single.isCompleted ? '' : 'border-2'}`}
                        style={{
                          backgroundColor: single.isCompleted ? single.workout.color : 'transparent',
                          borderColor: single.workout.color,
                        }}
                      >
                        {single.isCompleted && <Check size={14} className="text-white" />}
                      </div>
                    ) : hasWorkout ? (
                      <div className="flex items-center justify-center gap-0.5 flex-wrap max-w-full mb-0.5">
                        {visibleSlots.map((rs, idx) => (
                          <div
                            key={idx}
                            className={`w-2.5 h-2.5 rounded-full ${rs.isCompleted ? '' : 'border-2'}`}
                            style={{
                              backgroundColor: rs.isCompleted ? rs.workout.color : 'transparent',
                              borderColor: rs.workout.color,
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </>
                );

                if (single) {
                  return (
                    <Link key={i} href={slotHref(date, single)} className={cellClass}>
                      {cellContent}
                    </Link>
                  );
                }
                if (hasWorkout) {
                  return (
                    <div
                      key={i}
                      role="button"
                      tabIndex={0}
                      onClick={() => setPickerDate(date)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setPickerDate(date);
                        }
                      }}
                      className={cellClass}
                    >
                      {cellContent}
                    </div>
                  );
                }
                return (
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
              const isTodayDate = isToday(date);
              const future = isFutureDate(date);
              const visibleSlots = getVisibleSlots(date);

              return (
                <div
                  key={date.toISOString()}
                  className={`bg-surface rounded-xl p-4 ${isTodayDate ? 'ring-2 ring-primary' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-center w-9 shrink-0">
                      <p className="text-xs text-muted-foreground uppercase">
                        {date.toLocaleDateString('en-US', { weekday: 'short' })}
                      </p>
                      <p className={`text-lg font-bold ${isTodayDate ? 'text-primary' : 'text-foreground'}`}>
                        {date.getDate()}
                      </p>
                    </div>

                    {visibleSlots.length === 0 ? (
                      <span className="text-muted-foreground">Rest Day</span>
                    ) : (
                      <div className="flex-1 space-y-2">
                        {visibleSlots.map((rs, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={`w-3 h-3 rounded-full shrink-0 flex items-center justify-center ${rs.isCompleted ? '' : 'border-2'}`}
                                style={{
                                  backgroundColor: rs.isCompleted ? rs.workout.color : 'transparent',
                                  borderColor: rs.workout.color,
                                }}
                              />
                              <span className="font-medium text-foreground truncate">
                                {rs.workout.name}
                                {rs.label && <span className="text-muted-foreground ml-1">({rs.label})</span>}
                              </span>
                            </div>
                            <Link
                              href={slotHref(date, rs)}
                              className={`inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-150 touch-target px-3 py-1.5 text-sm min-h-[36px] shrink-0 ${
                                !rs.session && !future && isTodayDate
                                  ? 'bg-primary hover:bg-primary-hover text-white'
                                  : 'bg-surface-elevated hover:bg-surface text-foreground border border-border'
                              }`}
                            >
                              {future ? 'Preview' : rs.session ? (rs.isCompleted ? 'View' : 'Resume') : 'Start'}
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 justify-center text-sm">
          {legendItems.map((w) => (
            <div key={w.id} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: w.color }} />
              <span className="text-muted-foreground">{w.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Multi-workout day picker */}
    {pickerDate && (() => {
      const daySlots = getVisibleSlots(pickerDate);
      const future = isFutureDate(pickerDate);
      return (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onClick={() => setPickerDate(null)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-surface rounded-2xl w-full max-w-sm m-4 p-5 space-y-4 animate-[fadeSlideIn_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  {pickerDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </h3>
                <p className="text-sm text-muted-foreground">{daySlots.length} workouts scheduled</p>
              </div>
              <button onClick={() => setPickerDate(null)} className="p-1 text-muted-foreground hover:text-foreground touch-target">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-2">
              {daySlots.map((rs, idx) => (
                <Link
                  key={idx}
                  href={slotHref(pickerDate, rs)}
                  className="flex items-center justify-between gap-2 bg-surface-elevated hover:bg-surface rounded-xl p-3 border border-border transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center ${rs.isCompleted ? '' : 'border-2'}`}
                      style={{
                        backgroundColor: rs.isCompleted ? rs.workout.color : 'transparent',
                        borderColor: rs.workout.color,
                      }}
                    >
                      {rs.isCompleted && <Check size={10} className="text-white" />}
                    </div>
                    <span className="font-medium text-foreground truncate">
                      {rs.workout.name}
                      {rs.label && <span className="text-muted-foreground ml-1">({rs.label})</span>}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-primary shrink-0">
                    {future ? 'Preview' : rs.session ? (rs.isCompleted ? 'View' : 'Resume') : 'Start'}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      );
    })()}
    </div>
  );
}
