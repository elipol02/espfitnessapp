import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { notFound, redirect } from 'next/navigation';
import { PlanViewerContent } from './PlanViewerContent';

// Helper to migrate old progression object format to new string format
function migrateProgression(prog: unknown): string | null {
  if (!prog) return null;
  if (typeof prog === 'string') return prog;
  if (typeof prog === 'object' && prog !== null) {
    const p = prog as { type?: string; increment?: number | string; frequency?: string };
    if (p.type || p.increment || p.frequency) {
      // Convert old object format to string
      const type = p.type || 'linear';
      let increment = '';
      if (p.increment !== undefined) {
        if (typeof p.increment === 'number') {
          increment = p.increment < 1 
            ? `+${(p.increment * 100).toFixed(0)}%`
            : `+${p.increment} lbs`;
        } else {
          increment = String(p.increment);
        }
      }
      const frequency = p.frequency || 'weekly';
      return `${type} ${increment} ${frequency}`.trim();
    }
  }
  return null;
}

async function getPlanData(planId: string, userId: string) {
  const plan = await prisma.workoutPlan.findUnique({
    where: { id: planId, userId },
    include: {
      workoutDays: {
        include: {
          exercises: {
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { dayNumber: 'asc' },
      },
    },
  });

  if (!plan) return null;

  // Serialize the plan data for client component and migrate progression fields
  return {
    ...plan,
    startDate: plan.startDate ? plan.startDate.toISOString() : null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    workoutDays: plan.workoutDays.map((day: any) => ({
      ...day,
      exercises: day.exercises.map((ex: any) => ({
        ...ex,
        progression: migrateProgression(ex.progression),
      })),
    })),
  };
}

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
  const plan = await getPlanData(planId, session.user.id);

  if (!plan) {
    notFound();
  }

  return <PlanViewerContent plan={plan as any} />;
}
