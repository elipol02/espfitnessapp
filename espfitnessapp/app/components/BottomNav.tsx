'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, MessageSquare, FileText, Play } from 'lucide-react';

function getLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function BottomNav() {
  const pathname = usePathname();
  const todayDate = getLocalDateString();

  const navItems = [
    { href: '/home', label: 'Home', icon: Home },
    { href: '/calendar', label: 'Calendar', icon: Calendar },
    { href: `/workout/today?date=${todayDate}`, label: 'Workout', icon: Play, activePrefix: '/workout' },
    { href: '/plans', label: 'Plans', icon: FileText },
    { href: '/chat', label: 'Chat', icon: MessageSquare },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border safe-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-4">
        {navItems.map(({ href, label, icon: Icon, activePrefix }) => {
          const isActive = activePrefix
            ? pathname.startsWith(activePrefix)
            : pathname === href || pathname.startsWith(`${href}/`);
          
          return (
            <Link
              key={label}
              href={href}
              className={`
                flex flex-col items-center justify-center gap-1
                w-full h-full touch-target
                transition-colors duration-150
                ${isActive 
                  ? 'text-primary' 
                  : 'text-muted hover:text-foreground'
                }
              `}
            >
              <Icon 
                size={24} 
                strokeWidth={isActive ? 2.5 : 2}
                className="transition-all"
              />
              <span className={`text-xs ${isActive ? 'font-medium' : ''}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
