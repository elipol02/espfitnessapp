import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { z } from 'zod';
import { applyAdjustments, ensureWorkoutsGenerated, type AdjustmentSuggestion } from '@/app/lib/progressive';

const applySchema = z.object({
  adjustmentId: z.string(),
  modifications: z.record(
    z.object({
      weight: z.number().optional(),
      sets: z.number().optional(),
      reps: z.number().optional(),
    })
  ).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const result = applySchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { adjustmentId, modifications } = result.data;

    // Fetch the pending adjustment
    const pendingAdjustment = await prisma.pendingAdjustment.findUnique({
      where: { id: adjustmentId },
    });

    if (!pendingAdjustment || pendingAdjustment.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Adjustment not found' },
        { status: 404 }
      );
    }

    if (pendingAdjustment.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: 'Adjustment has already been processed' },
        { status: 400 }
      );
    }

    // Get the workout log to find the workout type
    const workoutLog = await prisma.workoutLog.findUnique({
      where: { id: pendingAdjustment.workoutLogId },
      include: {
        day: true,
      },
    });

    if (!workoutLog) {
      return NextResponse.json(
        { success: false, error: 'Workout not found' },
        { status: 404 }
      );
    }

    // Get the suggestions from the pending adjustment
    const suggestions = pendingAdjustment.suggestions as AdjustmentSuggestion[];

    // Apply any user modifications to the suggestions
    const finalSuggestions = suggestions.map((suggestion) => {
      const mod = modifications?.[suggestion.name];
      if (mod) {
        return {
          ...suggestion,
          nextWeight: mod.weight ?? suggestion.nextWeight,
          nextSets: mod.sets ?? suggestion.nextSets,
          nextReps: mod.reps ?? suggestion.nextReps,
        };
      }
      return suggestion;
    });

    // Apply the adjustments to the next workout
    const applyResult = await applyAdjustments(
      pendingAdjustment.planId,
      workoutLog.day.workoutType,
      new Date(),
      finalSuggestions
    );

    if (!applyResult.success) {
      return NextResponse.json(
        { success: false, error: applyResult.error },
        { status: 400 }
      );
    }

    // Ensure we have enough workouts generated ahead
    await ensureWorkoutsGenerated(pendingAdjustment.planId, new Date());

    // Mark the pending adjustment as approved
    await prisma.pendingAdjustment.update({
      where: { id: adjustmentId },
      data: {
        status: 'approved',
        suggestions: finalSuggestions,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        nextWorkoutId: applyResult.nextWorkoutId,
      },
    });
  } catch (error) {
    console.error('Apply adjustments error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to apply adjustments' },
      { status: 500 }
    );
  }
}
