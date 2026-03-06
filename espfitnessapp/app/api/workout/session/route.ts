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
    const { workoutTypeId, date, planId } = await request.json();

    if (!workoutTypeId || !date) {
      return NextResponse.json(
        { success: false, error: 'workoutTypeId and date are required' },
        { status: 400 }
      );
    }

    const workoutType = await prisma.workoutType.findFirst({
      where: { id: workoutTypeId, userId },
    });

    if (!workoutType) {
      return NextResponse.json({ success: false, error: 'Workout type not found' }, { status: 404 });
    }

    // Parse date as UTC midnight — "YYYY-MM-DD" is always treated as UTC by Date constructor
    const workoutDate = new Date(date);
    const startOfDay = new Date(workoutDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(workoutDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    // Check for existing session on this date for this workout type
    const existing = await prisma.workoutSession.findFirst({
      where: {
        userId,
        workoutTypeId,
        workoutDate: { gte: startOfDay, lte: endOfDay },
      },
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        data: { sessionId: existing.id, status: existing.status },
      });
    }

    // Create new session
    const newSession = await prisma.workoutSession.create({
      data: {
        userId,
        workoutTypeId,
        planId: planId || null,
        workoutDate: startOfDay,
        status: 'in_progress',
        startedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      data: { sessionId: newSession.id, status: 'in_progress' },
    });
  } catch (error) {
    console.error('Error starting workout session:', error);
    return NextResponse.json({ success: false, error: 'Failed to start session' }, { status: 500 });
  }
}
