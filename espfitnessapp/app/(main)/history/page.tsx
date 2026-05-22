import { validateSession } from '@/app/lib/auth';
import { getHistory } from '@/app/lib/history';
import { HistoryContent } from './HistoryContent';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const data = await getHistory(session.user.id);
  return <HistoryContent data={data} />;
}
