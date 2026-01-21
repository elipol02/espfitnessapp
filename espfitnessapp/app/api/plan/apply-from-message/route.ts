import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

type JsonValue = object | string | number | boolean | null | undefined;

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

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

    if (!message || message.userId !== userId) {
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
          userId,
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

      const now = new Date();
      const newScheduleDayNumbers = planData.schedule.map((d: any) => d.dayNumber);
      console.log(`New schedule day numbers: [${newScheduleDayNumbers.join(', ')}]`);

      // Use a transaction for all operations (tx typed as any: Prisma's ITXClientDenyList can omit delegates in some versions)
      await prisma.$transaction(async (tx: any) => {
        // 1. Delete all future workouts
        const deletedFuture = await tx.workoutDay.deleteMany({
          where: {
            planId: currentActivePlan.id,
            scheduledDate: { gt: now },
          },
        });
        console.log(`Deleted ${deletedFuture.count} future workout days`);

        // 2. Delete past incomplete workouts not in new schedule
        const pastIncompleteWorkouts = await tx.workoutDay.findMany({
          where: {
            planId: currentActivePlan.id,
            scheduledDate: { lte: now },
            workoutLogs: {
              none: {
                completedAt: { not: null },
              },
            },
          },
          select: {
            id: true,
            dayNumber: true,
          },
        });

        const toDeleteIds = pastIncompleteWorkouts
          .filter((w: { id: string; dayNumber: number }) => !newScheduleDayNumbers.includes(w.dayNumber))
          .map((w: { id: string; dayNumber: number }) => w.id);

        if (toDeleteIds.length > 0) {
          const deletedPast = await tx.workoutDay.deleteMany({
            where: { id: { in: toDeleteIds } },
          });
          console.log(`Deleted ${deletedPast.count} past incomplete workouts not in new schedule`);
        }

        // 3. Update plan metadata
        await tx.workoutPlan.update({
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

        // 4. Prepare all workout days and exercises for bulk insert
        const workoutDaysToCreate: any[] = [];
        const exercisesMap = new Map<string, any[]>(); // tempId -> exercises array

        for (let week = 0; week < planData.weeksDuration; week++) {
          for (const dayData of planData.schedule) {
            const scheduledDate = new Date(startOfWeek);
            scheduledDate.setDate(startOfWeek.getDate() + (week * 7) + dayData.dayNumber);

            if (scheduledDate.getTime() < now.getTime()) {
              continue;
            }

            const tempId = `${week}-${dayData.dayNumber}`;
            workoutDaysToCreate.push({
              tempId, // For mapping exercises
              planId: currentActivePlan.id,
              dayNumber: dayData.dayNumber,
              dayName: dayData.dayName,
              scheduledDate: scheduledDate,
              workoutType: dayData.workoutType,
              workoutColor: dayData.workoutColor,
              isGenerated: true,
            });

            // Store exercises for this day
            exercisesMap.set(tempId, dayData.exercises);
          }
        }

        console.log(`Creating ${workoutDaysToCreate.length} workout days in bulk`);

        // 5. Create all workout days and collect their IDs
        const createdDays = [];
        for (const dayToCreate of workoutDaysToCreate) {
          const { tempId, ...dayData } = dayToCreate;
          const createdDay = await tx.workoutDay.create({ data: dayData });
          createdDays.push({ id: createdDay.id, tempId });
        }

        // 6. Prepare all exercises for bulk insert
        const allExercises: any[] = [];
        for (const { id: dayId, tempId } of createdDays) {
          const exercises = exercisesMap.get(tempId) || [];
          exercises.forEach((ex: any, j: number) => {
            allExercises.push({
              dayId,
              name: ex.name,
              sets: ex.sets,
              setsMin: ex.setsMin,
              reps: ex.reps,
              repsMin: ex.repsMin,
              weightType: ex.weightType || 'ABSOLUTE',
              weightValue: ex.weightValue,
              restTime: ex.restTime || 90,
              exerciseType: ex.exerciseType || 'strength',
              progression: ex.progression as JsonValue,
              movementDetails: ex.movementDetails as JsonValue,
              order: j,
              duration: ex.duration,
              distance: ex.distance,
              distanceUnit: ex.distanceUnit,
              intervals: ex.intervals as JsonValue,
              tempo: ex.tempo,
              timeCap: ex.timeCap,
              movements: ex.movements as JsonValue,
            });
          });
        }

        // 7. Bulk insert all exercises
        if (allExercises.length > 0) {
          await tx.exercise.createMany({ data: allExercises });
          console.log(`Created ${allExercises.length} exercises in bulk`);
        }

        console.log(`Transaction complete: ${createdDays.length} days, ${allExercises.length} exercises`);
      });

      return NextResponse.json({
        success: true,
        message: 'Plan replaced successfully',
      });
    } else {
      // Create new plan (activate or save as new)
      await prisma.$transaction(async (tx: any) => {
        // 1. Deactivate other active plans
        await tx.workoutPlan.updateMany({
          where: {
            userId,
            status: 'active',
          },
          data: { status: 'archived' },
        });

        // 2. Create the new plan
        const newPlan = await tx.workoutPlan.create({
          data: {
            userId,
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

        // 3. Prepare all workout days and exercises
        const workoutDaysToCreate: any[] = [];
        const exercisesMap = new Map<string, any[]>();

        for (let week = 0; week < planData.weeksDuration; week++) {
          for (const dayData of planData.schedule) {
            const scheduledDate = new Date(startOfWeek);
            scheduledDate.setDate(startOfWeek.getDate() + (week * 7) + dayData.dayNumber);

            const tempId = `${week}-${dayData.dayNumber}`;
            workoutDaysToCreate.push({
              tempId,
              planId: newPlan.id,
              dayNumber: dayData.dayNumber,
              dayName: dayData.dayName,
              scheduledDate: scheduledDate,
              workoutType: dayData.workoutType,
              workoutColor: dayData.workoutColor,
              isGenerated: true,
            });

            exercisesMap.set(tempId, dayData.exercises);
          }
        }

        // 4. Create all workout days
        const createdDays = [];
        for (const dayToCreate of workoutDaysToCreate) {
          const { tempId, ...dayData } = dayToCreate;
          const createdDay = await tx.workoutDay.create({ data: dayData });
          createdDays.push({ id: createdDay.id, tempId });
        }

        // 5. Prepare all exercises for bulk insert
        const allExercises: any[] = [];
        for (const { id: dayId, tempId } of createdDays) {
          const exercises = exercisesMap.get(tempId) || [];
          exercises.forEach((ex: any, j: number) => {
            allExercises.push({
              dayId,
              name: ex.name,
              sets: ex.sets,
              setsMin: ex.setsMin,
              reps: ex.reps,
              repsMin: ex.repsMin,
              weightType: ex.weightType || 'ABSOLUTE',
              weightValue: ex.weightValue,
              restTime: ex.restTime || 90,
              exerciseType: ex.exerciseType || 'strength',
              progression: ex.progression as JsonValue,
              movementDetails: ex.movementDetails as JsonValue,
              order: j,
              duration: ex.duration,
              distance: ex.distance,
              distanceUnit: ex.distanceUnit,
              intervals: ex.intervals as JsonValue,
              tempo: ex.tempo,
              timeCap: ex.timeCap,
              movements: ex.movements as JsonValue,
            });
          });
        }

        // 6. Bulk insert all exercises
        if (allExercises.length > 0) {
          await tx.exercise.createMany({ data: allExercises });
        }

        console.log(`Created ${createdDays.length} workout days and ${allExercises.length} exercises`);
      });

      return NextResponse.json({
        success: true,
        message: 'Plan activated successfully',
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
