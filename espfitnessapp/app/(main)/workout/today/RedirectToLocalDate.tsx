'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/app/components/LoadingSpinner';

/** Get local date string YYYY-MM-DD in the user's timezone. */
function getLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * When the user hits /workout/today with no date param, we need their local "today"
 * (server time would be wrong for timezones). This redirects to add ?date=YYYY-MM-DD.
 */
export function RedirectToLocalDate() {
  const router = useRouter();

  useEffect(() => {
    const dateStr = getLocalDateString();
    router.replace(`/workout/today?date=${dateStr}`);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <LoadingSpinner />
      <p className="text-muted-foreground text-sm">Loading today&apos;s workout…</p>
    </div>
  );
}
