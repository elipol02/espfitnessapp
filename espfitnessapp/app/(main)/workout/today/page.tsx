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
  searchParams: Promise<{ workoutTypeId?: string; date?: string; rotationId?: string }>;
}) {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const userId = session.user.id;
  const params = await searchParams;
  let workoutTypeId = params.workoutTypeId;
  const dateStr = params.date;
  const rotationId = params.rotationId;

  if (!dateStr) {
    return (
      <div className="px-5 pb-28">
        <RedirectToLocalDate />
      </div>
    );
  }

  const [y, m, d] = dateStr.split('-').map(Number);
  const localDate = new Date(y, m - 1, d);
  const todayDow = DAY_MAP[localDate.getDay()];

  // If workoutTypeId not provided, try to resolve it from the schedule/rotation
  if (!workoutTypeId && !rotationId) {
    const assignments = await prisma.dayAssignment.findMany({
      where: { userId, dayOfWeek: todayDow },
      orderBy: { order: 'asc' },
      include: {
        workoutType: { select: { id: true } },
        rotation: {
          include: {
            entries: { orderBy: { order: 'asc' } },
          },
        },
      },
    });

    if (assignments.length === 0) {
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

    if (assignments.length > 1) {
      // Multiple slots — redirect back to home so the user picks one from the cards
      redirect('/home');
    }

    const assignment = assignments[0];
    if (assignment.rotationId && assignment.rotation) {
      const rot = assignment.rotation;
      const idx = rot.currentIndex % rot.entries.length;
      workoutTypeId = rot.entries[idx]?.workoutTypeId;
      // rotationId will be passed forward via session create
    } else if (assignment.workoutType) {
      workoutTypeId = assignment.workoutType.id;
    }
  }

  // If we have a rotationId but no workoutTypeId, resolve it
  if (rotationId && !workoutTypeId) {
    const rotation = await prisma.workoutRotation.findFirst({
      where: { id: rotationId },
      include: { entries: { orderBy: { order: 'asc' } } },
    });
    if (rotation && rotation.entries.length > 0) {
      const idx = rotation.currentIndex % rotation.entries.length;
      workoutTypeId = rotation.entries[idx].workoutTypeId;
    }
  }

  if (!workoutTypeId) {
    redirect('/home');
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
    const newSession = await prisma.workoutSession.create({
      data: {
        userId,
        workoutTypeId,
        rotationId: rotationId || null,
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
