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
  // Optional fields for different exercise types
  duration: z.number().optional(), // Duration in seconds for cardio_time, mobility_time
  distance: z.number().optional(), // Distance for distance exercises
  roundsCompleted: z.number().optional(), // For AMRAP, intervals
  timeElapsed: z.number().optional(), // Time taken for AMRAP, EMOM
  performanceData: z.any().optional(), // Flexible field for complex data
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

    const { workoutLogId, exerciseId, sets, duration, distance, roundsCompleted, timeElapsed, performanceData } = result.data;

    // Verify ownership and validate workout has a date
    const workoutLog = await prisma.workoutLog.findUnique({
      where: { id: workoutLogId },
    });

    if (!workoutLog || workoutLog.userId !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Workout not found' }, { status: 404 });
    }

    // CRITICAL: Workout must have a valid date before any data can be saved
    if (!workoutLog.workoutDate) {
      console.error('Cannot save set - workout log has no date:', workoutLogId);
      return NextResponse.json({ success: false, error: 'Workout has no date' }, { status: 400 });
    }

    // Check if exercise log already exists
    const existingLog = await prisma.exerciseLog.findFirst({
      where: {
        logId: workoutLogId,
        exerciseId,
      },
    });

    const repsPerSet = sets.map((s) => s.reps);
    const weightsPerSet = sets.map((s) => s.weight);
    const maxWeight = sets.length > 0 ? Math.max(...weightsPerSet) : 0;

    // Check if this is a PR (simplified - check if max weight is higher than previous best)
    const previousBest = await prisma.exerciseLog.findFirst({
      where: {
        exerciseId,
        log: { userId: session.user.id },
      },
      orderBy: { id: 'desc' },
    });

    let isPR = false;
    if (previousBest) {
      const prevWeights = previousBest.weightUsed as number[];
      const prevMax = Array.isArray(prevWeights) ? Math.max(...prevWeights) : (prevWeights as unknown as number);
      isPR = maxWeight > prevMax;
    } else {
      isPR = true; // First time doing this exercise
    }

    if (existingLog) {
      // Update existing log
      await prisma.exerciseLog.update({
        where: { id: existingLog.id },
        data: {
          setsCompleted: sets.length,
          repsPerSet,
          weightUsed: weightsPerSet,
          isPR,
          duration,
          distance,
          roundsCompleted,
          timeElapsed,
          performanceData,
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
          weightUsed: weightsPerSet,
          isPR,
          duration,
          distance,
          roundsCompleted,
          timeElapsed,
          performanceData,
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
