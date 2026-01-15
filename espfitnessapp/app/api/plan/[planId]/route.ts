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
    const { status, goal, weeksDuration, startDate } = body;

    // Verify ownership
    const existingPlan = await prisma.workoutPlan.findUnique({
      where: { id: planId },
    });

    if (!existingPlan || existingPlan.userId !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    // If activating a new plan, deactivate other active plans
    if (status === 'active' && existingPlan.status !== 'active') {
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
