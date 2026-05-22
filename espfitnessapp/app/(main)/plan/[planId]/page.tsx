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
          rotation: {
            include: {
              entries: {
                orderBy: { order: 'asc' },
                include: {
                  workoutType: {
                    include: {
                      exercises: { orderBy: { order: 'asc' } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { order: 'asc' }],
      },
    },
  });

  if (!plan) {
    notFound();
  }

  // Collect exercise IDs from both direct assignments and rotation entries
  const allExerciseIds = plan.dayAssignments.flatMap((da) => {
    if (da.workoutType) return da.workoutType.exercises.map((ex) => ex.id);
    if (da.rotation) return da.rotation.entries.flatMap((e) => e.workoutType.exercises.map((ex) => ex.id));
    return [];
  });

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

  const SLOT_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const serialized = {
    id: plan.id,
    name: plan.name,
    status: plan.status,
    startDate: plan.startDate ? plan.startDate.toISOString() : null,
    endDate: plan.endDate ? plan.endDate.toISOString() : null,
    dayAssignments: plan.dayAssignments.map((da) => ({
      id: da.id,
      dayOfWeek: da.dayOfWeek,
      order: da.order,
      rotationId: da.rotationId,
      rotationName: da.rotation?.name ?? null,
      rotationCurrentIndex: da.rotation?.currentIndex ?? null,
      rotationSize: da.rotation?.entries.length ?? 0,
      workoutType: da.workoutType
        ? {
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
          }
        : null,
      rotationEntries: da.rotation?.entries.map((re, idx) => ({
        id: re.id,
        label: SLOT_LABELS[idx] ?? String(idx + 1),
        isNext: da.rotation ? idx === da.rotation.currentIndex % da.rotation.entries.length : false,
        workoutType: {
          id: re.workoutType.id,
          name: re.workoutType.name,
          color: re.workoutType.color,
          category: re.workoutType.category,
          exercises: re.workoutType.exercises.map((ex) => ({
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
      })) ?? [],
    })),
  };

  return <PlanViewerContent plan={serialized} lastLiftedWeights={lastLiftedWeights} />;
}
