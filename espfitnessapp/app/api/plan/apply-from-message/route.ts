import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const { messageId } = await request.json();

    if (!messageId) {
      return NextResponse.json({ success: false, error: 'messageId is required' }, { status: 400 });
    }

    const chatMessage = await prisma.chatMessage.findFirst({
      where: { id: messageId, userId },
    });

    if (!chatMessage) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 });
    }

    if (chatMessage.approved) {
      return NextResponse.json({ success: false, error: 'Plan already applied' }, { status: 400 });
    }

    const metadata = chatMessage.metadata as Record<string, unknown> | null;
    const planData = metadata?.planData as {
      name: string;
      schedule: Array<{
        dayOfWeek: number;
        dayName: string;
        workoutTypeName: string;
        workoutTypeColor: string;
        workoutTypeCategory?: string;
        exercises: Array<{
          name: string;
          exerciseType: string;
          config: Record<string, unknown>;
          progression?: Record<string, unknown>;
          groupTag?: string;
          order: number;
          notes?: string;
        }>;
      }>;
    } | null;

    if (!planData?.schedule) {
      return NextResponse.json({ success: false, error: 'No plan data in message' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Archive existing active plans
      await tx.workoutPlan.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'archived' },
      });

      // Create WorkoutTypes and Exercises
      const dayAssignments: Array<{ dayOfWeek: number; workoutTypeId: string }> = [];

      for (const day of planData.schedule) {
        const workoutType = await tx.workoutType.create({
          data: {
            userId,
            name: day.workoutTypeName,
            color: day.workoutTypeColor,
            category: day.workoutTypeCategory || null,
            exercises: {
              create: day.exercises.map((ex, idx) => ({
                name: ex.name,
                exerciseType: ex.exerciseType || 'strength',
                config: ex.config as Prisma.InputJsonValue,
                progression: (ex.progression ?? undefined) as Prisma.InputJsonValue | undefined,
                groupTag: ex.groupTag || null,
                order: ex.order ?? idx,
                notes: ex.notes || null,
              })),
            },
          },
        });

        dayAssignments.push({
          dayOfWeek: day.dayOfWeek,
          workoutTypeId: workoutType.id,
        });
      }

      // Create WorkoutPlan + PlanDayAssignments
      const plan = await tx.workoutPlan.create({
        data: {
          userId,
          name: planData.name,
          status: 'active',
          startDate: new Date(),
          endDate: new Date(new Date().setMonth(new Date().getMonth() + 3)),
          dayAssignments: {
            create: dayAssignments.map((da) => ({
              dayOfWeek: da.dayOfWeek,
              workoutTypeId: da.workoutTypeId,
            })),
          },
        },
        include: {
          dayAssignments: {
            include: { workoutType: { include: { exercises: true } } },
          },
        },
      });

      // Mark message as approved
      await tx.chatMessage.update({
        where: { id: messageId },
        data: { approved: true },
      });

      return plan;
    });

    return NextResponse.json({ success: true, data: { planId: result.id } });
  } catch (error) {
    console.error('Error applying plan from message:', error);
    return NextResponse.json({ success: false, error: 'Failed to apply plan' }, { status: 500 });
  }
}
