import { NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

// DELETE /api/schedule — clear the entire schedule (all day assignments + rotations).
// Workout types, exercises, and all logged session history are left untouched.
export async function DELETE() {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    await prisma.$transaction([
      prisma.dayAssignment.deleteMany({ where: { userId } }),
      prisma.workoutRotation.deleteMany({ where: { userId } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error clearing schedule:', err);
    return NextResponse.json({ success: false, error: 'Failed to clear schedule' }, { status: 500 });
  }
}
