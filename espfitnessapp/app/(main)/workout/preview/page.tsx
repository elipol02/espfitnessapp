import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { computeSuggestions } from '@/app/lib/progression';
import { redirect } from 'next/navigation';
import { LiveWorkoutContent } from '../live/LiveWorkoutContent';

export default async function WorkoutPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ workoutTypeId?: string; date?: string }>;
}) {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const params = await searchParams;
  const { workoutTypeId, date } = params;

  if (!workoutTypeId || !date) {
    redirect('/home');
  }

  const workoutType = await prisma.workoutType.findFirst({
    where: { id: workoutTypeId, userId: session.user.id },
    include: {
      exercises: { orderBy: { order: 'asc' } },
    },
  });

  if (!workoutType) {
    redirect('/home');
  }

  const suggestions = await computeSuggestions(workoutTypeId, session.user.id);

  const workoutDate = new Date(date);

  const exercises = workoutType.exercises.map((ex) => ({
    ...ex,
    config: ex.config as Record<string, unknown>,
    progression: ex.progression as Record<string, unknown> | null,
  }));

  return (
    <LiveWorkoutContent
      sessionId=""
      workoutType={workoutType}
      exercises={exercises}
      existingEntries={[]}
      suggestions={suggestions}
      sessionStatus="future"
      userBodyweight={null}
      workoutDate={workoutDate}
      readOnly={true}
    />
  );
}
