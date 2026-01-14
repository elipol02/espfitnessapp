'use client';

import { Flame } from 'lucide-react';

interface StreakCounterProps {
  streak: number;
  size?: 'sm' | 'md' | 'lg';
}

export function StreakCounter({ streak, size = 'md' }: StreakCounterProps) {
  if (streak <= 0) return null;

  const sizes = {
    sm: {
      container: 'px-2 py-1',
      icon: 14,
      text: 'text-xs',
    },
    md: {
      container: 'px-3 py-1.5',
      icon: 16,
      text: 'text-sm',
    },
    lg: {
      container: 'px-4 py-2',
      icon: 20,
      text: 'text-base',
    },
  };

  const { container, icon, text } = sizes[size];

  return (
    <div className={`flex items-center gap-1.5 bg-surface rounded-full ${container}`}>
      <Flame className="text-warning" size={icon} />
      <span className={`font-medium text-foreground ${text}`}>{streak}</span>
    </div>
  );
}
