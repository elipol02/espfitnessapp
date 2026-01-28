import { type ClassValue, clsx } from 'clsx';

// Simple classname utility without tailwind-merge (since we're using Tailwind 4)
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// Format date for display
export function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// Format time for display (12-hour format)
export function formatTime(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Format duration in minutes to readable string
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Convert weight based on type
export function calculateWeight(
  weightValue: number,
  weightType: 'BW' | '1RM' | 'ABSOLUTE',
  bodyweight?: number,
  oneRepMax?: number
): number {
  switch (weightType) {
    case 'BW':
      return bodyweight ? Math.round(weightValue * bodyweight) : 0;
    case '1RM':
      return oneRepMax ? Math.round(weightValue * oneRepMax) : 0;
    case 'ABSOLUTE':
    default:
      return weightValue;
  }
}

// Available workout colors (type-agnostic palette)
export const WORKOUT_COLORS = [
  '#06b6d4', // cyan
  '#ef4444', // red
  '#10b981', // emerald
  '#a855f7', // purple
  '#eab308', // yellow
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#8b5cf6', // violet
] as const;

export const REST_COLOR = '#404040'; // gray

// Generate a simple ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Debounce function
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Trigger haptic feedback (if available)
export function haptic(type: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    const duration = type === 'light' ? 10 : type === 'medium' ? 20 : 30;
    navigator.vibrate(duration);
  }
}

/**
 * Compare two dates by their UTC date components (year, month, day) only.
 * This avoids timezone issues when comparing dates across different timezones.
 * 
 * @param date1 First date to compare
 * @param date2 Second date to compare
 * @returns true if the dates represent the same day in UTC
 */
export function isSameUTCDate(date1: Date, date2: Date): boolean {
  return (
    date1.getUTCFullYear() === date2.getUTCFullYear() &&
    date1.getUTCMonth() === date2.getUTCMonth() &&
    date1.getUTCDate() === date2.getUTCDate()
  );
}

/**
 * Get a UTC date string in YYYY-MM-DD format from a Date object.
 * 
 * @param date The date to format
 * @returns Date string in YYYY-MM-DD format
 */
export function getUTCDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
