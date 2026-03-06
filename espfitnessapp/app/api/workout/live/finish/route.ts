import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const { sessionId, notes, rating } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'sessionId is required' }, { status: 400 });
    }

    const workoutSession = await prisma.workoutSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!workoutSession) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    if (workoutSession.status === 'completed') {
      return NextResponse.json({ success: true, data: { alreadyCompleted: true } });
    }

    await prisma.workoutSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        notes: notes || null,
        rating: rating || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error finishing workout:', error);
    return NextResponse.json({ success: false, error: 'Failed to finish workout' }, { status: 500 });
  }
}
