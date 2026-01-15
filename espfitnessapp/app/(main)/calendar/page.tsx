import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { CalendarContent } from './CalendarContent';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function getCalendarData(userId: string) {
  // Get user's active plan with all workout days (full 12-week skeleton)
  const activePlan = await prisma.workoutPlan.findFirst({
    where: {
      userId,
      status: 'active',
    },
    include: {
      workoutDays: {
        orderBy: { scheduledDate: 'asc' },
      },
    },
  });

  // Get ALL workout logs for this plan (not just current month)
  const workoutLogs = activePlan ? await prisma.workoutLog.findMany({
    where: {
      userId,
      planId: activePlan.id,
    },
    select: {
      id: true,
      dayId: true,
      workoutDate: true,
      status: true,
    },
  }) : [];

  return {
    workoutDays: activePlan?.workoutDays.map((day) => ({
      id: day.id,
      dayNumber: day.dayNumber,
      dayName: day.dayName,
      scheduledDate: day.scheduledDate?.toISOString() || null,
      workoutType: day.workoutType,
      workoutColor: day.workoutColor,
      isGenerated: day.isGenerated,
    })) || [],
    workoutLogs: workoutLogs.map((log) => ({
      id: log.id,
      dayId: log.dayId,
      workoutDate: log.workoutDate.toISOString(),
      status: log.status,
    })),
    planId: activePlan?.id || null,
    startDate: activePlan?.startDate?.toISOString() || null,
    weeksDuration: activePlan?.weeksDuration || 12,
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
