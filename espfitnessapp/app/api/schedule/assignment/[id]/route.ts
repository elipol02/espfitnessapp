import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

// DELETE /api/schedule/assignment/[id] — remove a single slot from the schedule.
// If it was the last day using a rotation, the (now-unused) rotation is removed too.
// Workout types, exercises, and logged history are never touched.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    const assignment = await prisma.dayAssignment.findFirst({
      where: { id, userId },
      select: { id: true, rotationId: true },
    });
    if (!assignment) {
      return NextResponse.json({ success: false, error: 'Assignment not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.dayAssignment.delete({ where: { id: assignment.id } });
      if (assignment.rotationId) {
        const remaining = await tx.dayAssignment.count({ where: { rotationId: assignment.rotationId } });
        if (remaining === 0) {
          await tx.workoutRotation.delete({ where: { id: assignment.rotationId } });
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error removing assignment:', err);
    return NextResponse.json({ success: false, error: 'Failed to remove from schedule' }, { status: 500 });
  }
}
