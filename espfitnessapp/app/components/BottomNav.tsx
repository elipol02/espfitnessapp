'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Calendar, MessageSquare, FileText, Play } from 'lucide-react';

function getLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLastWorkoutHref(): string {
  const todayDate = getLocalDateString();
  try {
    const raw = localStorage.getItem('esp_last_workout_session');
    if (raw) {
      const { sessionId, openedDate } = JSON.parse(raw);
      if (openedDate === todayDate && sessionId) {
        return `/workout/live?sessionId=${sessionId}`;
      }
    }
  } catch {
    // ignore malformed localStorage
  }
  return `/workout/today?date=${todayDate}`;
}

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const staticNavItems = [
    { href: '/home', label: 'Home', icon: Home },
    { href: '/calendar', label: 'Calendar', icon: Calendar },
    { href: '/plans', label: 'Plans', icon: FileText },
    { href: '/chat', label: 'Chat', icon: MessageSquare },
  ];

  const isWorkoutActive = pathname.startsWith('/workout');

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border safe-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-4">
        {staticNavItems.slice(0, 2).map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={label}
              href={href}
              className={`
                flex flex-col items-center justify-center gap-1
                w-full h-full touch-target
                transition-colors duration-150
                ${isActive ? 'text-primary' : 'text-muted hover:text-foreground'}
              `}
            >
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} className="transition-all" />
              <span className={`text-xs ${isActive ? 'font-medium' : ''}`}>{label}</span>
            </Link>
          );
        })}

        {/* Workout tab — reads localStorage at click time */}
        <button
          onClick={() => router.push(getLastWorkoutHref())}
          className={`
            flex flex-col items-center justify-center gap-1
            w-full h-full touch-target
            transition-colors duration-150
            ${isWorkoutActive ? 'text-primary' : 'text-muted hover:text-foreground'}
          `}
        >
          <Play size={24} strokeWidth={isWorkoutActive ? 2.5 : 2} className="transition-all" />
          <span className={`text-xs ${isWorkoutActive ? 'font-medium' : ''}`}>Workout</span>
        </button>

        {staticNavItems.slice(2).map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={label}
              href={href}
              className={`
                flex flex-col items-center justify-center gap-1
                w-full h-full touch-target
                transition-colors duration-150
                ${isActive ? 'text-primary' : 'text-muted hover:text-foreground'}
              `}
            >
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} className="transition-all" />
              <span className={`text-xs ${isActive ? 'font-medium' : ''}`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
