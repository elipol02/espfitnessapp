import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { computeSuggestions } from '@/app/lib/progression';
import { redirect } from 'next/navigation';
import { LiveWorkoutContent } from './LiveWorkoutContent';

export default async function LiveWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const params = await searchParams;
  const { sessionId } = params;

  if (!sessionId) {
    redirect('/home');
  }

  const workoutSession = await prisma.workoutSession.findFirst({
    where: { id: sessionId, userId: session.user.id },
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

  const suggestions = await computeSuggestions(
    workoutSession.workoutTypeId,
    session.user.id
  );

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { bodyweight: true },
  });

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
