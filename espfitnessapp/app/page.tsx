import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';

export default async function RootPage() {
  const session = await auth();
  
  // Redirect to login if no session, otherwise go to home
  if (!session?.user) {
    redirect('/login');
  }
  
  redirect('/home');
}
