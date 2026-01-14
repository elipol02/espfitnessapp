import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { notFound, redirect } from 'next/navigation';
import { PlanViewerContent } from './PlanViewerContent';

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

  // Serialize the plan data for client component
  return {
    ...plan,
    startDate: plan.startDate ? plan.startDate.toISOString() : null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
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
