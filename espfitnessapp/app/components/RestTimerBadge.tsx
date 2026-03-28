'use client';

import { useState, useEffect } from 'react';
import { Timer, X, CheckCircle } from 'lucide-react';

export const REST_TIMER_KEY          = 'esp_rest_timer_end';
export const REST_TIMER_EXERCISE_KEY = 'esp_rest_timer_exercise';
const REST_TIMER_SUPPRESS_KEY        = 'esp_rest_timer_suppress';
const REST_TIMER_DONE_KEY            = 'esp_rest_timer_done';
const TIMER_UPDATE_EVENT             = 'esp_rest_timer_update';

export function startRestTimer(seconds: number, exerciseId?: string) {
  if (seconds <= 0) return;
  const endTime = Date.now() + seconds * 1000;
  localStorage.setItem(REST_TIMER_KEY, String(endTime));
  localStorage.removeItem(REST_TIMER_DONE_KEY);
  if (exerciseId) {
    localStorage.setItem(REST_TIMER_EXERCISE_KEY, exerciseId);
  } else {
    localStorage.removeItem(REST_TIMER_EXERCISE_KEY);
  }
  window.dispatchEvent(new Event(TIMER_UPDATE_EVENT));
}

export function cancelRestTimer() {
  localStorage.removeItem(REST_TIMER_KEY);
  localStorage.removeItem(REST_TIMER_EXERCISE_KEY);
  localStorage.removeItem(REST_TIMER_DONE_KEY);
  window.dispatchEvent(new Event(TIMER_UPDATE_EVENT));
}

export function dismissRestTimerDone() {
  localStorage.removeItem(REST_TIMER_DONE_KEY);
  localStorage.removeItem(REST_TIMER_EXERCISE_KEY);
  window.dispatchEvent(new Event(TIMER_UPDATE_EVENT));
}

export function suppressRestTimerBadge(suppress: boolean) {
  if (suppress) {
    localStorage.setItem(REST_TIMER_SUPPRESS_KEY, '1');
  } else {
    localStorage.removeItem(REST_TIMER_SUPPRESS_KEY);
  }
  window.dispatchEvent(new Event(TIMER_UPDATE_EVENT));
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(Math.max(0, totalSeconds) / 60);
  const s = Math.max(0, totalSeconds) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function useRestTimer(): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const raw = localStorage.getItem(REST_TIMER_KEY);
      if (!raw) { setRemaining(null); return; }
      const diff = Math.ceil((parseInt(raw) - Date.now()) / 1000);
      if (diff <= 0) {
        localStorage.removeItem(REST_TIMER_KEY);
        localStorage.setItem(REST_TIMER_DONE_KEY, '1');
        setRemaining(null);
      } else {
        setRemaining(diff);
      }
    };

    tick();
    const id = setInterval(tick, 500);
    window.addEventListener(TIMER_UPDATE_EVENT, tick);
    return () => {
      clearInterval(id);
      window.removeEventListener(TIMER_UPDATE_EVENT, tick);
    };
  }, []);

  return remaining;
}

export function useRestTimerExerciseId(): string | null {
  const [exerciseId, setExerciseId] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setExerciseId(localStorage.getItem(REST_TIMER_EXERCISE_KEY));
    update();
    window.addEventListener(TIMER_UPDATE_EVENT, update);
    return () => window.removeEventListener(TIMER_UPDATE_EVENT, update);
  }, []);

  return exerciseId;
}

export function useRestTimerDone(): boolean {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const check = () => setDone(!!localStorage.getItem(REST_TIMER_DONE_KEY));
    check();
    const id = setInterval(check, 500);
    window.addEventListener(TIMER_UPDATE_EVENT, check);
    return () => {
      clearInterval(id);
      window.removeEventListener(TIMER_UPDATE_EVENT, check);
    };
  }, []);

  return done;
}

export function RestTimerBadge() {
  const remaining = useRestTimer();
  const [suppressed, setSuppressed] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const check = () => {
      setSuppressed(!!localStorage.getItem(REST_TIMER_SUPPRESS_KEY));
      setDone(!!localStorage.getItem(REST_TIMER_DONE_KEY));
    };
    check();
    const id = setInterval(check, 500);
    window.addEventListener(TIMER_UPDATE_EVENT, check);
    return () => {
      clearInterval(id);
      window.removeEventListener(TIMER_UPDATE_EVENT, check);
    };
  }, []);

  if (suppressed) return null;

  if (done) {
    return (
      <div className="fixed top-3 right-3 z-50 flex items-center gap-1.5 bg-green-500 text-white rounded-full pl-3 pr-1.5 py-1.5 shadow-lg text-sm font-bold animate-in fade-in slide-in-from-right-2 duration-200">
        <CheckCircle size={13} />
        <span>Done</span>
        <button
          onClick={dismissRestTimerDone}
          className="ml-0.5 w-5 h-5 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
          aria-label="Dismiss"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  if (remaining === null) return null;

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-1.5 bg-primary text-white rounded-full pl-3 pr-1.5 py-1.5 shadow-lg text-sm font-bold animate-in fade-in slide-in-from-right-2 duration-200">
      <Timer size={13} />
      <span className="tabular-nums min-w-[34px] text-center">{formatTime(remaining)}</span>
      <button
        onClick={cancelRestTimer}
        className="ml-0.5 w-5 h-5 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
        aria-label="Cancel rest timer"
      >
        <X size={11} />
      </button>
    </div>
  );
}
