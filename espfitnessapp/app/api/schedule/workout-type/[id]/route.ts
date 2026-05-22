import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

// DELETE /api/schedule/workout-type/[id] — remove a workout type from the schedule
// everywhere it appears (its fixed-slot assignments and its rotation entries). The
// WorkoutType, its exercises, and all logged session history are KEPT — only the
// schedule references are removed. Rotations left empty are cleaned up.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    const workoutType = await prisma.workoutType.findFirst({ where: { id, userId }, select: { id: true } });
    if (!workoutType) {
      return NextResponse.json({ success: false, error: 'Workout type not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      // Remove fixed-slot assignments for this type.
      await tx.dayAssignment.deleteMany({ where: { userId, workoutTypeId: id } });

      // Remove this type from any rotations it belongs to.
      const affected = await tx.rotationEntry.findMany({
        where: { workoutTypeId: id, rotation: { userId } },
        select: { rotationId: true },
      });
      await tx.rotationEntry.deleteMany({ where: { workoutTypeId: id, rotation: { userId } } });

      // Delete rotations that no longer have any entries (cascades their day assignments).
      const rotationIds = [...new Set(affected.map((e) => e.rotationId))];
      for (const rotationId of rotationIds) {
        const remaining = await tx.rotationEntry.count({ where: { rotationId } });
        if (remaining === 0) {
          await tx.workoutRotation.delete({ where: { id: rotationId } });
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error removing workout type from schedule:', err);
    return NextResponse.json({ success: false, error: 'Failed to remove workout' }, { status: 500 });
  }
}
