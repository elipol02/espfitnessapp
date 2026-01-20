import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { Prisma } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { messageId, action } = body;

    if (!messageId || !action) {
      return NextResponse.json(
        { success: false, error: 'Message ID and action required' },
        { status: 400 }
      );
    }

    // Get the message with the plan JSON
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
    });

    if (!message || message.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Message not found or unauthorized' },
        { status: 404 }
      );
    }

    const metadata = message.metadata as { planData?: any };
    const planData = metadata?.planData;

    if (!planData || !planData.schedule) {
      return NextResponse.json(
        { success: false, error: 'No plan data found in message' },
        { status: 400 }
      );
    }

    console.log(`Processing plan from message ${messageId}, action: ${action}`);
    console.log(`Plan has ${planData.schedule.length} days`);

    // Parse date string as local date
    const startDate = new Date(planData.startDate);
    const today = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek);

    if (action === 'replace') {
      // Find the current active plan
      const currentActivePlan = await prisma.workoutPlan.findFirst({
        where: {
          userId: session.user.id,
          status: 'active',
        },
      });

      if (!currentActivePlan) {
        return NextResponse.json(
          { success: false, error: 'No active plan found to replace' },
          { status: 404 }
        );
      }

      console.log(`Replacing active plan ${currentActivePlan.id}`);
      console.log(`Current plan structure:`, JSON.stringify(currentActivePlan.aiContext, null, 2));
      console.log(`New plan structure:`, JSON.stringify({
        sessionsPerWeek: planData.sessionsPerWeek,
        schedule: planData.schedule.map((d: any) => ({ dayNumber: d.dayNumber, dayName: d.dayName, workoutType: d.workoutType }))
      }, null, 2));

      // Delete all future workouts
      const now = new Date();
      console.log(`Current time: ${now.toISOString()}`);
      
      const deletedCount = await prisma.workoutDay.deleteMany({
        where: {
          planId: currentActivePlan.id,
          scheduledDate: { gt: now },
        },
      });

      console.log(`Deleted ${deletedCount.count} future workout days`);

      // Update the plan metadata with new structure
      const updatedPlan = await prisma.workoutPlan.update({
        where: { id: currentActivePlan.id },
        data: {
          goal: planData.goal,
          weeksDuration: planData.weeksDuration,
          aiContext: {
            sessionsPerWeek: planData.sessionsPerWeek,
            schedule: planData.schedule.map((day: any) => ({
              dayNumber: day.dayNumber,
              dayName: day.dayName,
              workoutType: day.workoutType,
              workoutColor: day.workoutColor,
            })),
          },
        },
      });
      
      console.log(`Updated plan metadata. New weeksDuration: ${updatedPlan.weeksDuration}`);
      console.log(`Updated plan aiContext:`, JSON.stringify(updatedPlan.aiContext, null, 2));

      // Create new workout days from the plan JSON (use NEW plan duration)
      let createdCount = 0;
      console.log(`Creating workouts for ${planData.weeksDuration} weeks with ${planData.schedule.length} days per week`);
      
      for (let week = 0; week < planData.weeksDuration; week++) {
        for (const dayData of planData.schedule) {
          const scheduledDate = new Date(startOfWeek);
          scheduledDate.setDate(startOfWeek.getDate() + (week * 7) + dayData.dayNumber);

          // Skip if this date is in the past
          if (scheduledDate.getTime() < now.getTime()) {
            console.log(`Skipping past date: ${scheduledDate.toISOString()} for ${dayData.dayName}`);
            continue;
          }

          console.log(`Creating workout: Week ${week + 1}, ${dayData.dayName} (${dayData.workoutType}) on ${scheduledDate.toISOString().split('T')[0]}`);

          // Create the workout day
          const createdDay = await prisma.workoutDay.create({
            data: {
              planId: currentActivePlan.id,
              dayNumber: dayData.dayNumber,
              dayName: dayData.dayName,
              scheduledDate: scheduledDate,
              workoutType: dayData.workoutType,
              workoutColor: dayData.workoutColor,
              isGenerated: true,
            },
          });

          createdCount++;

          // Create exercises
          for (let j = 0; j < dayData.exercises.length; j++) {
            const ex = dayData.exercises[j];
            await prisma.exercise.create({
              data: {
                dayId: createdDay.id,
                name: ex.name,
                sets: ex.sets,
                setsMin: ex.setsMin,
                reps: ex.reps,
                repsMin: ex.repsMin,
                weightType: ex.weightType || 'ABSOLUTE',
                weightValue: ex.weightValue,
                restTime: ex.restTime || 90,
                exerciseType: ex.exerciseType || 'strength',
                progression: ex.progression,
                movementDetails: ex.movementDetails,
                order: j,
                duration: ex.duration,
                distance: ex.distance,
                distanceUnit: ex.distanceUnit,
                intervals: ex.intervals as Prisma.InputJsonValue,
                tempo: ex.tempo,
                timeCap: ex.timeCap,
                movements: ex.movements as Prisma.InputJsonValue,
              },
            });
          }
        }
      }

      console.log(`Created ${createdCount} new workout days`);

      return NextResponse.json({
        success: true,
        message: 'Plan replaced successfully',
        details: {
          deletedWorkouts: deletedCount.count,
          createdWorkouts: createdCount,
        },
      });
    } else {
      // Create new plan (activate or save as new)
      // Deactivate other active plans
      await prisma.workoutPlan.updateMany({
        where: {
          userId: session.user.id,
          status: 'active',
        },
        data: { status: 'archived' },
      });

      // Create the new plan
      const newPlan = await prisma.workoutPlan.create({
        data: {
          userId: session.user.id,
          goal: planData.goal,
          status: 'active',
          weeksDuration: planData.weeksDuration,
          startDate: today,
          aiContext: {
            sessionsPerWeek: planData.sessionsPerWeek,
          },
        },
      });

      console.log(`Created new plan ${newPlan.id}`);

      // Create workout days from the plan JSON
      let createdCount = 0;
      for (let week = 0; week < planData.weeksDuration; week++) {
        for (const dayData of planData.schedule) {
          const scheduledDate = new Date(startOfWeek);
          scheduledDate.setDate(startOfWeek.getDate() + (week * 7) + dayData.dayNumber);

          // Create the workout day
          const createdDay = await prisma.workoutDay.create({
            data: {
              planId: newPlan.id,
              dayNumber: dayData.dayNumber,
              dayName: dayData.dayName,
              scheduledDate: scheduledDate,
              workoutType: dayData.workoutType,
              workoutColor: dayData.workoutColor,
              isGenerated: true,
            },
          });

          createdCount++;

          // Create exercises
          for (let j = 0; j < dayData.exercises.length; j++) {
            const ex = dayData.exercises[j];
            await prisma.exercise.create({
              data: {
                dayId: createdDay.id,
                name: ex.name,
                sets: ex.sets,
                setsMin: ex.setsMin,
                reps: ex.reps,
                repsMin: ex.repsMin,
                weightType: ex.weightType || 'ABSOLUTE',
                weightValue: ex.weightValue,
                restTime: ex.restTime || 90,
                exerciseType: ex.exerciseType || 'strength',
                progression: ex.progression,
                movementDetails: ex.movementDetails,
                order: j,
                duration: ex.duration,
                distance: ex.distance,
                distanceUnit: ex.distanceUnit,
                intervals: ex.intervals as Prisma.InputJsonValue,
                tempo: ex.tempo,
                timeCap: ex.timeCap,
                movements: ex.movements as Prisma.InputJsonValue,
              },
            });
          }
        }
      }

      console.log(`Created ${createdCount} new workout days`);

      return NextResponse.json({
        success: true,
        message: 'Plan activated successfully',
        data: newPlan,
        details: {
          createdWorkouts: createdCount,
        },
      });
    }
  } catch (error) {
    console.error('Apply plan from message error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to apply plan' },
      { status: 500 }
    );
  }
}
