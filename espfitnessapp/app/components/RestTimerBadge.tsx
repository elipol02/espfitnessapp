'use client';

import { useState, useEffect } from 'react';
import { Timer, X } from 'lucide-react';

export const REST_TIMER_KEY = 'esp_rest_timer_end';

export function startRestTimer(seconds: number) {
  if (seconds <= 0) return;
  const endTime = Date.now() + seconds * 1000;
  localStorage.setItem(REST_TIMER_KEY, String(endTime));
  window.dispatchEvent(new Event('esp_rest_timer_update'));
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
        setRemaining(null);
      } else {
        setRemaining(diff);
      }
    };

    tick();
    const id = setInterval(tick, 500);
    window.addEventListener('esp_rest_timer_update', tick);
    return () => {
      clearInterval(id);
      window.removeEventListener('esp_rest_timer_update', tick);
    };
  }, []);

  return remaining;
}

export function RestTimerBadge() {
  const remaining = useRestTimer();

  const cancel = () => {
    localStorage.removeItem(REST_TIMER_KEY);
    window.dispatchEvent(new Event('esp_rest_timer_update'));
  };

  if (remaining === null) return null;

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-1.5 bg-primary text-white rounded-full pl-3 pr-1.5 py-1.5 shadow-lg text-sm font-bold animate-in fade-in slide-in-from-right-2 duration-200">
      <Timer size={13} />
      <span className="tabular-nums min-w-[34px] text-center">{formatTime(remaining)}</span>
      <button
        onClick={cancel}
        className="ml-0.5 w-5 h-5 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
        aria-label="Cancel rest timer"
      >
        <X size={11} />
      </button>
    </div>
  );
}
