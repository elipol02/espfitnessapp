import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { z } from 'zod';

const addSetSchema = z.object({
  workoutLogId: z.string(),
  exerciseId: z.string(),
  sets: z.array(
    z.object({
      reps: z.number(),
      weight: z.number(),
    })
  ),
});

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const result = addSetSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { workoutLogId, exerciseId, sets } = result.data;

    // Verify ownership
    const workoutLog = await prisma.workoutLog.findUnique({
      where: { id: workoutLogId },
    });

    if (!workoutLog || workoutLog.userId !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Workout not found' }, { status: 404 });
    }

    // Check if exercise log already exists
    const existingLog = await prisma.exerciseLog.findFirst({
      where: {
        logId: workoutLogId,
        exerciseId,
      },
    });

    const repsPerSet = sets.map((s) => s.reps);
    const avgWeight = sets.length > 0 ? sets.reduce((sum, s) => sum + s.weight, 0) / sets.length : 0;

    // Check if this is a PR (simplified - would need more logic for real PR detection)
    const previousBest = await prisma.exerciseLog.findFirst({
      where: {
        exerciseId,
        log: { userId: session.user.id },
      },
      orderBy: { weightUsed: 'desc' },
    });

    const isPR = !previousBest || avgWeight > previousBest.weightUsed;

    if (existingLog) {
      // Update existing log
      await prisma.exerciseLog.update({
        where: { id: existingLog.id },
        data: {
          setsCompleted: sets.length,
          repsPerSet,
          weightUsed: avgWeight,
          isPR,
        },
      });
    } else {
      // Create new log
      await prisma.exerciseLog.create({
        data: {
          logId: workoutLogId,
          exerciseId,
          setsCompleted: sets.length,
          repsPerSet,
          weightUsed: avgWeight,
          isPR,
        },
      });
    }

    return NextResponse.json({ success: true, data: { isPR } });
  } catch (error) {
    console.error('Add set error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to log set' },
      { status: 500 }
    );
  }
}
