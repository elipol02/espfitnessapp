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
          rotation: {
            include: {
              entries: {
                orderBy: { order: 'asc' },
                include: { workoutType: true },
              },
            },
          },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { order: 'asc' }],
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
          rotationId: true,
          workoutDate: true,
          status: true,
        },
        orderBy: { workoutDate: 'desc' },
      })
    : [];

  // Emit one entry per slot. Rotation slots carry their full ordered entry list so the
  // client can project the A/B/A… cycle across actual calendar dates.
  const slots = (activePlan?.dayAssignments ?? [])
    .map((da) => {
      if (da.rotation && da.rotation.entries.length > 0) {
        return {
          dayOfWeek: da.dayOfWeek,
          order: da.order,
          rotationId: da.rotationId,
          workoutType: null,
          rotation: {
            id: da.rotation.id,
            currentIndex: da.rotation.currentIndex,
            entries: da.rotation.entries.map((e) => ({
              id: e.workoutType.id,
              name: e.workoutType.name,
              color: e.workoutType.color,
            })),
          },
        };
      }
      if (da.workoutType) {
        return {
          dayOfWeek: da.dayOfWeek,
          order: da.order,
          rotationId: null,
          workoutType: { id: da.workoutType.id, name: da.workoutType.name, color: da.workoutType.color },
          rotation: null,
        };
      }
      return null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    planId: activePlan?.id || null,
    startDate: activePlan?.startDate?.toISOString() || null,
    endDate: activePlan?.endDate?.toISOString() || null,
    slots,
    sessions: sessions.map((s) => ({
      id: s.id,
      workoutTypeId: s.workoutTypeId,
      rotationId: s.rotationId,
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
