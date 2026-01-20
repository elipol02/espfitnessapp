import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

// GET - Get plan details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const { planId } = await params;

    const plan = await prisma.workoutPlan.findUnique({
      where: { id: planId, userId: session.user.id },
      include: {
        workoutDays: {
          include: {
            exercises: {
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { dayNumber: 'asc' },
        },
      },
    });

    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: plan });
  } catch (error) {
    console.error('Get plan error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch plan' },
      { status: 500 }
    );
  }
}

// PATCH - Update plan (approve, edit status, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const { planId } = await params;
    const body = await request.json();
    const { status, goal, weeksDuration, startDate, action } = body;

    console.log(`PATCH /api/plan/${planId}`, { status, action, body });

    // Verify ownership
    const existingPlan = await prisma.workoutPlan.findUnique({
      where: { id: planId },
    });

    if (!existingPlan || existingPlan.userId !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }
    
    console.log(`Existing plan found: ${existingPlan.id}, status: ${existingPlan.status}`);

    // Handle "replace" action - replace current active plan with this one
    if (action === 'replace' && status === 'active') {
      // Find the current active plan
      const currentActivePlan = await prisma.workoutPlan.findFirst({
        where: {
          userId: session.user.id,
          status: 'active',
          id: { not: planId },
        },
        include: {
          workoutDays: {
            include: {
              exercises: true,
            },
            orderBy: { dayNumber: 'asc' },
          },
        },
      });

      if (!currentActivePlan) {
        // No active plan to replace - just activate this one normally
        console.log('No active plan found to replace, activating new plan normally');
        // Fall through to normal activation logic below
      } else {
        console.log(`Replacing active plan ${currentActivePlan.id} with new plan ${planId}`);
        console.log(`Current active plan has ${currentActivePlan.workoutDays.length} workout days`);
        
        // Get the new plan structure
        console.log(`Fetching new plan structure for plan ${planId}`);
        const newPlan = await prisma.workoutPlan.findUnique({
          where: { id: planId },
          include: {
            workoutDays: {
              include: {
                exercises: true,
              },
              orderBy: { dayNumber: 'asc' },
            },
          },
        });

        if (!newPlan) {
          console.error(`ERROR: New plan ${planId} not found when trying to replace!`);
          return NextResponse.json({ success: false, error: 'New plan not found' }, { status: 404 });
        }
        
        console.log(`New plan found with ${newPlan.workoutDays.length} workout days`);

        // Delete all future workouts from the current active plan
        const now = new Date();
        const deletedCount = await prisma.workoutDay.deleteMany({
          where: {
            planId: currentActivePlan.id,
            scheduledDate: { gt: now },
          },
        });
        
        console.log(`Deleted ${deletedCount.count} future workout days`);

        // Update the current active plan with new structure
        await prisma.workoutPlan.update({
          where: { id: currentActivePlan.id },
          data: {
            goal: newPlan.goal,
            weeksDuration: newPlan.weeksDuration,
            aiContext: newPlan.aiContext,
          },
        });

        // Copy workout day structure from new plan to active plan
        // Calculate start date based on current week
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek);

        // Create workout days for remaining weeks
        const weeksRemaining = currentActivePlan.weeksDuration;
        let createdCount = 0;
        
        for (let week = 0; week < weeksRemaining; week++) {
          for (const newDay of newPlan.workoutDays) {
            // Calculate scheduled date for this week
            let scheduledDate = new Date(startOfWeek);
            scheduledDate.setDate(startOfWeek.getDate() + (week * 7) + newDay.dayNumber);
            
            // Skip if this date is in the past
            if (scheduledDate.getTime() < now.getTime()) {
              continue;
            }

            // Create the workout day
            const createdDay = await prisma.workoutDay.create({
              data: {
                planId: currentActivePlan.id,
                dayNumber: newDay.dayNumber,
                dayName: newDay.dayName,
                scheduledDate: scheduledDate,
                workoutType: newDay.workoutType,
                workoutColor: newDay.workoutColor,
                isGenerated: true,
              },
            });
            
            createdCount++;

            // Copy exercises from the new plan
            for (const exercise of newDay.exercises) {
              await prisma.exercise.create({
                data: {
                  dayId: createdDay.id,
                  name: exercise.name,
                  sets: exercise.sets,
                  setsMin: exercise.setsMin,
                  reps: exercise.reps,
                  repsMin: exercise.repsMin,
                  weightType: exercise.weightType,
                  weightValue: exercise.weightValue,
                  restTime: exercise.restTime,
                  exerciseType: exercise.exerciseType,
                  progression: exercise.progression,
                  movementDetails: exercise.movementDetails,
                  order: exercise.order,
                  duration: exercise.duration,
                  distance: exercise.distance,
                  distanceUnit: exercise.distanceUnit,
                  intervals: exercise.intervals,
                  tempo: exercise.tempo,
                  timeCap: exercise.timeCap,
                  movements: exercise.movements,
                },
              });
            }
          }
        }
        
        console.log(`Created ${createdCount} new workout days`);

        // Mark the draft plan as 'applied' instead of deleting it
        // This allows the user to go back and reactivate it later
        await prisma.workoutPlan.update({
          where: { id: planId },
          data: { status: 'archived' }, // Archive instead of delete
        });

        console.log(`Successfully replaced plan ${currentActivePlan.id} with new structure, archived draft ${planId}`);

        return NextResponse.json({ 
          success: true, 
          data: currentActivePlan,
          message: 'Plan replaced successfully',
          details: {
            deletedWorkouts: deletedCount.count,
            createdWorkouts: createdCount,
          }
        });
      }
    }

    // If activating a new plan (not replace), deactivate other active plans
    if (status === 'active' && existingPlan.status !== 'active' && action !== 'replace') {
      await prisma.workoutPlan.updateMany({
        where: {
          userId: session.user.id,
          status: 'active',
          id: { not: planId },
        },
        data: { status: 'archived' },
      });
    }

    // If start date is changing, reschedule all workout days
    if (startDate !== undefined && startDate) {
      // Parse date string as local date to avoid timezone issues
      const dateStr = startDate.split('T')[0]; // Get YYYY-MM-DD part
      const [year, month, day] = dateStr.split('-').map(Number);
      const newStartDate = new Date(year, month - 1, day); // month is 0-indexed
      
      // Get all workout days for this plan, sorted by current schedule
      const workoutDays = await prisma.workoutDay.findMany({
        where: { planId },
        select: { id: true, dayNumber: true, scheduledDate: true },
        orderBy: { scheduledDate: 'asc' },
      });

      // Calculate start of the week (Sunday) for the new start date
      const dayOfWeek = newStartDate.getDay();
      const startOfWeek = new Date(year, month - 1, day - dayOfWeek);

      // Group workout days by dayNumber to handle multiple weeks
      const daysByDayNumber = new Map<number, typeof workoutDays>();
      for (const day of workoutDays) {
        if (!daysByDayNumber.has(day.dayNumber)) {
          daysByDayNumber.set(day.dayNumber, []);
        }
        daysByDayNumber.get(day.dayNumber)!.push(day);
      }

      // Reschedule each workout day across all weeks
      for (const [dayNumber, days] of daysByDayNumber.entries()) {
        // Calculate the first occurrence of this day
        const firstDate = new Date(startOfWeek);
        firstDate.setDate(startOfWeek.getDate() + dayNumber);
        
        // If first occurrence is before start date, move to next week
        // Compare using getTime() to compare actual dates
        if (firstDate.getTime() < newStartDate.getTime()) {
          firstDate.setDate(firstDate.getDate() + 7);
        }
        
        // Schedule each instance at weekly intervals
        for (let i = 0; i < days.length; i++) {
          const scheduledDate = new Date(firstDate);
          scheduledDate.setDate(firstDate.getDate() + (i * 7));
          
          await prisma.workoutDay.update({
            where: { id: days[i].id },
            data: { scheduledDate },
          });
        }
      }
    }

    const updatedPlan = await prisma.workoutPlan.update({
      where: { id: planId },
      data: {
        ...(status && { status }),
        ...(goal && { goal }),
        ...(weeksDuration && { weeksDuration }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
      },
    });

    return NextResponse.json({ success: true, data: updatedPlan });
  } catch (error) {
    console.error('Update plan error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update plan' },
      { status: 500 }
    );
  }
}

// DELETE - Delete plan
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const { planId } = await params;

    // Verify ownership
    const existingPlan = await prisma.workoutPlan.findUnique({
      where: { id: planId },
    });

    if (!existingPlan || existingPlan.userId !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    await prisma.workoutPlan.delete({
      where: { id: planId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete plan error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete plan' },
      { status: 500 }
    );
  }
}
