import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { redirect } from 'next/navigation';
import { RedirectToLocalDate } from './RedirectToLocalDate';

export const dynamic = 'force-dynamic';

const DAY_MAP: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

export default async function TodayWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ workoutTypeId?: string; date?: string }>;
}) {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const userId = session.user.id;
  const params = await searchParams;
  let workoutTypeId = params.workoutTypeId;
  let dateStr = params.date;

  // No date param: we need the user's local "today" (server timezone would be wrong).
  // Client redirect will add ?date=YYYY-MM-DD and reload.
  if (!dateStr) {
    return (
      <div className="px-5 pb-28">
        <RedirectToLocalDate />
      </div>
    );
  }

  // Look up assignment for this date (by day-of-week). Parse date in local terms for correct DOW.
  if (!workoutTypeId) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const localDate = new Date(y, m - 1, d);
    const todayDow = DAY_MAP[localDate.getDay()];

    const activePlan = await prisma.workoutPlan.findFirst({
      where: { userId, status: 'active' },
      include: {
        dayAssignments: {
          where: { dayOfWeek: todayDow },
          include: { workoutType: { select: { id: true } } },
        },
      },
    });

    const assignment = activePlan?.dayAssignments[0];
    if (!assignment) {
      return (
        <div className="px-5 pb-28 flex items-center justify-center min-h-[80vh]">
          <div className="max-w-lg w-full text-center space-y-4">
            <div className="text-6xl">😴</div>
            <h1 className="text-2xl font-bold text-foreground">Rest Day</h1>
            <p className="text-muted-foreground">Today is a rest day. Recovery is part of the process!</p>
          </div>
        </div>
      );
    }

    workoutTypeId = assignment.workoutType.id;
  }

  // Find existing session for this workout type on this date
  const workoutDate = new Date(dateStr);
  const startOfDay = new Date(workoutDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(workoutDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const existingSession = await prisma.workoutSession.findFirst({
    where: {
      userId,
      workoutTypeId,
      workoutDate: { gte: startOfDay, lte: endOfDay },
    },
    select: { id: true },
  });

  if (existingSession) {
    redirect(`/workout/live?sessionId=${existingSession.id}`);
  }

  // No session yet — create one and redirect
  const activePlan = await prisma.workoutPlan.findFirst({
    where: { userId, status: 'active' },
    select: { id: true },
  });

  const newSession = await prisma.workoutSession.create({
    data: {
      userId,
      workoutTypeId,
      planId: activePlan?.id ?? null,
      workoutDate: startOfDay,
      status: 'in_progress',
      startedAt: new Date(),
    },
  });

  redirect(`/workout/live?sessionId=${newSession.id}`);
}
