import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { PlansContent } from './PlansContent';
import { redirect } from 'next/navigation';

async function getPlans(userId: string) {
  const plans = await prisma.workoutPlan.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      createdAt: true,
      _count: {
        select: { dayAssignments: true },
      },
    },
  });

  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    status: plan.status,
    startDate: plan.startDate ? plan.startDate.toISOString().split('T')[0] : null,
    createdAt: plan.createdAt.toISOString(),
    dayCount: plan._count.dayAssignments,
  }));
}

export default async function PlansPage() {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const plans = await getPlans(session.user.id);
  return <PlansContent plans={plans} />;
}
