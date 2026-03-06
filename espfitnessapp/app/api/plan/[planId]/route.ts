import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const { planId } = await params;

    const plan = await prisma.workoutPlan.findFirst({
      where: { id: planId, userId: session.user.id },
      include: {
        dayAssignments: {
          include: {
            workoutType: {
              include: {
                exercises: { orderBy: { order: 'asc' } },
              },
            },
          },
          orderBy: { dayOfWeek: 'asc' },
        },
      },
    });

    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error fetching plan:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch plan' }, { status: 500 });
  }
}

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
    const { status, startDate, endDate } = body;

    const plan = await prisma.workoutPlan.findFirst({
      where: { id: planId, userId: session.user.id },
    });

    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (status && (status === 'active' || status === 'archived')) {
      if (status === 'active') {
        await prisma.workoutPlan.updateMany({
          where: { userId: session.user.id, status: 'active', id: { not: planId } },
          data: { status: 'archived' },
        });
      }
      updateData.status = status;
    }
    if (startDate !== undefined) {
      updateData.startDate = startDate ? new Date(startDate) : null;
    }
    if (endDate !== undefined) {
      updateData.endDate = endDate ? new Date(endDate) : null;
    }

    const updated = await prisma.workoutPlan.update({
      where: { id: planId },
      data: updateData,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating plan:', error);
    return NextResponse.json({ success: false, error: 'Failed to update plan' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const { planId } = await params;

    const plan = await prisma.workoutPlan.findFirst({
      where: { id: planId, userId: session.user.id },
    });

    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    await prisma.workoutPlan.delete({ where: { id: planId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting plan:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete plan' }, { status: 500 });
  }
}
