import { redirect } from 'next/navigation';
import { validateSession } from '@/app/lib/auth';
import { BottomNav } from '@/app/components/BottomNav';
import { RestTimerBadge } from '@/app/components/RestTimerBadge';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, error } = await validateSession();

  if (error || !session?.user) {
    redirect('/login');
  }

  return (
    <div className="bg-background pb-20">
      <RestTimerBadge />
      {children}
      <BottomNav />
    </div>
  );
}
