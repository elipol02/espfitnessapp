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
    const { sessionId, exerciseId, data } = await request.json();

    if (!sessionId || !exerciseId || !data) {
      return NextResponse.json(
        { success: false, error: 'sessionId, exerciseId, and data are required' },
        { status: 400 }
      );
    }

    const workoutSession = await prisma.workoutSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!workoutSession) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    // Upsert: update if entry exists for this session+exercise, create if not
    const entry = await prisma.exerciseEntry.upsert({
      where: {
        sessionId_exerciseId: { sessionId, exerciseId },
      },
      update: { data },
      create: {
        sessionId,
        exerciseId,
        data,
      },
    });

    return NextResponse.json({ success: true, data: { entryId: entry.id } });
  } catch (error) {
    console.error('Error saving exercise entry:', error);
    return NextResponse.json({ success: false, error: 'Failed to save entry' }, { status: 500 });
  }
}
