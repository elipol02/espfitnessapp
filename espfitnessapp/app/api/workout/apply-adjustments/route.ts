import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { z } from 'zod';
import { applyAdjustments, type AdjustmentSuggestion } from '@/app/lib/progressive';

const applySchema = z.object({
  adjustmentId: z.string(),
  modifications: z.record(
    z.string(),
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

    // Allow re-applying if status is pending or approved (user might change their mind)
    // Only reject if status is explicitly rejected
    if (pendingAdjustment.status === 'rejected') {
      return NextResponse.json(
        { success: false, error: 'Adjustment has been rejected' },
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
    const suggestions = pendingAdjustment.suggestions as unknown as AdjustmentSuggestion[];

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

    console.log('Applying adjustments for workout type:', workoutLog.day.workoutType);
    console.log('Suggestions to apply:', finalSuggestions);

    // Apply the adjustments to ALL future workouts of this type
    // Use the completed workout's date to find all future occurrences after it
    const applyResult = await applyAdjustments(
      pendingAdjustment.planId,
      workoutLog.day.workoutType,
      workoutLog.workoutDate,
      finalSuggestions
    );

    if (!applyResult.success) {
      console.error('Failed to apply adjustments:', applyResult.error);
      return NextResponse.json(
        { success: false, error: applyResult.error },
        { status: 400 }
      );
    }

    console.log('Adjustments applied to workouts:', applyResult.updatedWorkoutIds?.length || 0);

    // Mark the pending adjustment as approved
    await prisma.pendingAdjustment.update({
      where: { id: adjustmentId },
      data: {
        status: 'approved',
        suggestions: finalSuggestions as unknown as any,
      },
    });

    console.log('Adjustment marked as approved:', adjustmentId);

    return NextResponse.json({
      success: true,
      data: {
        updatedWorkoutIds: applyResult.updatedWorkoutIds || [],
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
