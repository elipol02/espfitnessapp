import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const { sessionId } = await params;

    const workoutSession = await prisma.workoutSession.findFirst({
      where: { id: sessionId, userId: session.user.id },
      include: {
        workoutType: {
          include: {
            exercises: { orderBy: { order: 'asc' } },
          },
        },
        entries: {
          include: { exercise: true },
        },
      },
    });

    if (!workoutSession) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: workoutSession });
  } catch (error) {
    console.error('Error fetching workout session:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch session' }, { status: 500 });
  }
}
