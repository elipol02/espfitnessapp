import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { z } from 'zod';
import { findNextWorkout } from '@/app/lib/progressive';

const finishSchema = z.object({
  workoutLogId: z.string(),
  feedback: z
    .object({
      rating: z.number().min(1).max(5),
      notes: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const result = finishSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { workoutLogId, feedback } = result.data;

    // Verify ownership
    const workoutLog = await prisma.workoutLog.findUnique({
      where: { id: workoutLogId },
      include: {
        plan: {
          select: {
            id: true,
            startDate: true,
          },
        },
        day: {
          select: {
            workoutType: true,
          },
        },
        exerciseLogs: true,
      },
    });

    if (!workoutLog || workoutLog.userId !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Workout not found' }, { status: 404 });
    }

    // Check if the plan has started
    if (workoutLog.plan.startDate) {
      const startDate = new Date(workoutLog.plan.startDate);
      startDate.setHours(0, 0, 0, 0);
      const workoutDate = new Date(workoutLog.workoutDate);
      workoutDate.setHours(0, 0, 0, 0);
      
      if (workoutDate < startDate) {
        return NextResponse.json(
          { success: false, error: 'Cannot complete workout before plan start date' },
          { status: 400 }
        );
      }
    }

    // Update workout log to completed
    const completedDate = new Date();
    await prisma.workoutLog.update({
      where: { id: workoutLogId },
      data: {
        status: 'completed',
        completedAt: completedDate,
        workoutDate: workoutLog.workoutDate || completedDate,
        feedback: feedback || undefined,
      },
    });

    // Update user stats
    const userStats = await prisma.userStats.findUnique({
      where: { userId: session.user.id },
    });

    if (userStats) {
      // Calculate new streak
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const lastWorkout = userStats.lastWorkout
        ? new Date(userStats.lastWorkout)
        : null;
      
      let newStreak = userStats.currentStreak;

      if (lastWorkout) {
        lastWorkout.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor(
          (today.getTime() - lastWorkout.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysDiff <= 1) {
          newStreak += 1;
        } else {
          newStreak = 1; // Reset streak if more than 1 day gap
        }
      } else {
        newStreak = 1;
      }

      await prisma.userStats.update({
        where: { userId: session.user.id },
        data: {
          currentStreak: newStreak,
          longestStreak: Math.max(newStreak, userStats.longestStreak),
          lastWorkout: new Date(),
        },
      });
    }

    // Check if this workout type has exercise logs and a future occurrence
    // Only create pending adjustment if there's actual exercise data to analyze
    const hasExerciseLogs = workoutLog.exerciseLogs && workoutLog.exerciseLogs.length > 0;
    const isNotRestDay = workoutLog.day.workoutType !== 'Rest';
    
    if (hasExerciseLogs && isNotRestDay) {
      // Check if there's a future occurrence of this workout type
      const nextWorkout = await findNextWorkout(
        workoutLog.planId,
        workoutLog.day.workoutType,
        new Date()
      );

      if (nextWorkout) {
        // Create pending adjustment for AI to process
        const pendingAdjustment = await prisma.pendingAdjustment.create({
          data: {
            userId: session.user.id,
            planId: workoutLog.planId,
            workoutLogId: workoutLogId,
            suggestions: [],
            status: 'pending',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

        return NextResponse.json({
          success: true,
          redirectToChat: true,
          pendingAdjustmentId: pendingAdjustment.id,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Finish workout error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to finish workout' },
      { status: 500 }
    );
  }
}
