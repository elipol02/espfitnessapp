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
    const { workoutTypeId: rawWorkoutTypeId, date, planId, rotationId } = await request.json();

    if (!date) {
      return NextResponse.json(
        { success: false, error: 'date is required' },
        { status: 400 }
      );
    }

    let workoutTypeId: string = rawWorkoutTypeId;

    // If a rotationId is provided, resolve the effective workoutTypeId from the rotation's current slot
    if (rotationId) {
      const rotation = await prisma.workoutRotation.findFirst({
        where: { id: rotationId },
        include: {
          entries: { orderBy: { order: 'asc' } },
        },
      });

      if (!rotation || rotation.entries.length === 0) {
        return NextResponse.json({ success: false, error: 'Rotation not found or empty' }, { status: 404 });
      }

      const idx = rotation.currentIndex % rotation.entries.length;
      workoutTypeId = rotation.entries[idx].workoutTypeId;
    }

    if (!workoutTypeId) {
      return NextResponse.json(
        { success: false, error: 'workoutTypeId or rotationId is required' },
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

    // Create new session, storing rotationId so finish API can advance the rotation
    const newSession = await prisma.workoutSession.create({
      data: {
        userId,
        workoutTypeId,
        planId: planId || null,
        rotationId: rotationId || null,
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
