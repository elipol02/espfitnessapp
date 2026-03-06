import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { CalendarContent } from './CalendarContent';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function getCalendarData(userId: string) {
  const activePlan = await prisma.workoutPlan.findFirst({
    where: { userId, status: 'active' },
    include: {
      dayAssignments: {
        include: {
          workoutType: true,
        },
        orderBy: { dayOfWeek: 'asc' },
      },
    },
  });

  // Get all workout sessions
  const sessions = activePlan
    ? await prisma.workoutSession.findMany({
        where: { userId, planId: activePlan.id },
        select: {
          id: true,
          workoutTypeId: true,
          workoutDate: true,
          status: true,
        },
        orderBy: { workoutDate: 'desc' },
      })
    : [];

  return {
    planId: activePlan?.id || null,
    startDate: activePlan?.startDate?.toISOString() || null,
    endDate: activePlan?.endDate?.toISOString() || null,
    dayAssignments: activePlan?.dayAssignments.map((da) => ({
      dayOfWeek: da.dayOfWeek,
      workoutType: {
        id: da.workoutType.id,
        name: da.workoutType.name,
        color: da.workoutType.color,
      },
    })) || [],
    sessions: sessions.map((s) => ({
      id: s.id,
      workoutTypeId: s.workoutTypeId,
      workoutDate: s.workoutDate.toISOString(),
      status: s.status,
    })),
  };
}

export default async function CalendarPage() {
  const { session, error } = await validateSession();
  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const data = await getCalendarData(session.user.id);
  return <CalendarContent data={data} />;
}
