import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { notFound, redirect } from 'next/navigation';
import { PlanViewerContent } from './PlanViewerContent';

export default async function PlanViewerPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const { planId } = await params;

  const plan = await prisma.workoutPlan.findFirst({
    where: { id: planId, userId: session.user.id },
    include: {
      dayAssignments: {
        include: {
          workoutType: {
            include: {
              exercises: { orderBy: { order: 'asc' } },
            },
          },
        },
        orderBy: { dayOfWeek: 'asc' },
      },
    },
  });

  if (!plan) {
    notFound();
  }

  const allExerciseIds = plan.dayAssignments.flatMap((da) =>
    da.workoutType.exercises.map((ex) => ex.id)
  );

  const recentEntries = await prisma.exerciseEntry.findMany({
    where: { exerciseId: { in: allExerciseIds } },
    orderBy: { createdAt: 'desc' },
    select: { exerciseId: true, data: true },
  });

  const lastLiftedWeights: Record<string, { weight: number; weightUnit: string }> = {};
  for (const entry of recentEntries) {
    if (lastLiftedWeights[entry.exerciseId]) continue;
    const data = entry.data as {
      sets?: Array<{ weight?: number; weightUnit?: string; completed?: boolean }>;
    };
    if (data.sets && Array.isArray(data.sets)) {
      const completedSets = data.sets.filter((s) => s.completed && s.weight != null);
      if (completedSets.length > 0) {
        const lastSet = completedSets[completedSets.length - 1];
        lastLiftedWeights[entry.exerciseId] = {
          weight: lastSet.weight!,
          weightUnit: lastSet.weightUnit ?? 'lbs',
        };
      }
    }
  }

  const serialized = {
    id: plan.id,
    name: plan.name,
    status: plan.status,
    startDate: plan.startDate ? plan.startDate.toISOString() : null,
    endDate: plan.endDate ? plan.endDate.toISOString() : null,
    dayAssignments: plan.dayAssignments.map((da) => ({
      id: da.id,
      dayOfWeek: da.dayOfWeek,
      workoutType: {
        id: da.workoutType.id,
        name: da.workoutType.name,
        color: da.workoutType.color,
        category: da.workoutType.category,
        exercises: da.workoutType.exercises.map((ex) => ({
          id: ex.id,
          name: ex.name,
          exerciseType: ex.exerciseType,
          config: ex.config as Record<string, unknown>,
          progression: ex.progression as Record<string, unknown> | null,
          groupTag: ex.groupTag,
          order: ex.order,
          notes: ex.notes,
        })),
      },
    })),
  };

  return <PlanViewerContent plan={serialized} lastLiftedWeights={lastLiftedWeights} />;
}
