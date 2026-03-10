import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { computeSuggestions } from '@/app/lib/progression';
import { redirect } from 'next/navigation';
import { RedirectToLocalDate } from './RedirectToLocalDate';
import { LiveWorkoutContent } from '../live/LiveWorkoutContent';

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
  const dateStr = params.date;

  if (!dateStr) {
    return (
      <div className="px-5 pb-28">
        <RedirectToLocalDate />
      </div>
    );
  }

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

  const workoutDate = new Date(dateStr);
  const startOfDay = new Date(workoutDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(workoutDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  let workoutSessionId: string;

  const existingSession = await prisma.workoutSession.findFirst({
    where: {
      userId,
      workoutTypeId,
      workoutDate: { gte: startOfDay, lte: endOfDay },
    },
    select: { id: true },
  });

  if (existingSession) {
    workoutSessionId = existingSession.id;
  } else {
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

    workoutSessionId = newSession.id;
  }

  const workoutSession = await prisma.workoutSession.findFirst({
    where: { id: workoutSessionId, userId },
    include: {
      workoutType: {
        include: {
          exercises: { orderBy: { order: 'asc' } },
        },
      },
      entries: true,
    },
  });

  if (!workoutSession) {
    redirect('/home');
  }

  const [suggestions, user] = await Promise.all([
    computeSuggestions(workoutSession.workoutTypeId, userId, workoutSession.workoutDate),
    prisma.user.findUnique({ where: { id: userId }, select: { bodyweight: true } }),
  ]);

  const exercises = workoutSession.workoutType.exercises.map((ex) => ({
    ...ex,
    config: ex.config as Record<string, unknown>,
    progression: ex.progression as Record<string, unknown> | null,
  }));

  return (
    <LiveWorkoutContent
      sessionId={workoutSession.id}
      workoutType={workoutSession.workoutType}
      exercises={exercises}
      existingEntries={workoutSession.entries}
      suggestions={suggestions}
      sessionStatus={workoutSession.status}
      userBodyweight={user?.bodyweight || null}
      workoutDate={workoutSession.workoutDate}
    />
  );
}
