import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

type ExerciseInput = {
  name: string;
  exerciseType: string;
  config: Record<string, unknown>;
  progression?: Record<string, unknown>;
  groupTag?: string;
  order: number;
  notes?: string;
};

type FixedSlot = {
  type: 'fixed';
  workoutTypeName: string;
  workoutTypeColor: string;
  workoutTypeCategory?: string;
  exercises: ExerciseInput[];
};

type RotationSlot = {
  type: 'rotation';
  rotationName: string;
  rotationEntries: Array<{
    workoutTypeName: string;
    workoutTypeColor: string;
    workoutTypeCategory?: string;
    exercises: ExerciseInput[];
  }>;
};

type PlanDaySlot = FixedSlot | RotationSlot;

type PlanData = {
  name: string;
  schedule: Array<{
    dayOfWeek: number;
    dayName: string;
    slots: PlanDaySlot[];
  }>;
};

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
    const planData = metadata?.planData as PlanData | null;

    if (!planData?.schedule) {
      return NextResponse.json({ success: false, error: 'No plan data in message' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Archive existing active plans
      await tx.workoutPlan.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'archived' },
      });

      // Create the WorkoutPlan shell first so we have its ID for rotation FK
      const plan = await tx.workoutPlan.create({
        data: {
          userId,
          name: planData.name,
          status: 'active',
          startDate: new Date(),
          endDate: new Date(new Date().setMonth(new Date().getMonth() + 3)),
        },
      });

      // Build rotation groups: rotationName → rotationId (shared across days)
      // We create one WorkoutRotation per unique rotationName
      const rotationMap = new Map<string, { rotationId: string; workoutTypeIds: string[] }>();

      // First pass: collect all unique rotation names and create their records + workout types
      for (const day of planData.schedule) {
        for (const slot of day.slots) {
          if (slot.type !== 'rotation') continue;
          if (rotationMap.has(slot.rotationName)) continue; // already processed

          // Create workout types for each rotation entry
          const workoutTypeIds: string[] = [];
          for (const entry of slot.rotationEntries) {
            const wt = await tx.workoutType.create({
              data: {
                userId,
                name: entry.workoutTypeName,
                color: entry.workoutTypeColor,
                category: entry.workoutTypeCategory || null,
                exercises: {
                  create: entry.exercises.map((ex, idx) => ({
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
            workoutTypeIds.push(wt.id);
          }

          // Create the rotation with its entries
          const rotation = await tx.workoutRotation.create({
            data: {
              planId: plan.id,
              name: slot.rotationName,
              currentIndex: 0,
              entries: {
                create: workoutTypeIds.map((wtId, idx) => ({
                  workoutTypeId: wtId,
                  order: idx,
                })),
              },
            },
          });

          rotationMap.set(slot.rotationName, { rotationId: rotation.id, workoutTypeIds });
        }
      }

      // Second pass: create all day assignments
      let slotOrder = 0;
      for (const day of planData.schedule) {
        slotOrder = 0;
        for (const slot of day.slots) {
          if (slot.type === 'fixed') {
            // Create the workout type
            const wt = await tx.workoutType.create({
              data: {
                userId,
                name: slot.workoutTypeName,
                color: slot.workoutTypeColor,
                category: slot.workoutTypeCategory || null,
                exercises: {
                  create: slot.exercises.map((ex, idx) => ({
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

            await tx.planDayAssignment.create({
              data: {
                planId: plan.id,
                dayOfWeek: day.dayOfWeek,
                order: slotOrder,
                workoutTypeId: wt.id,
                rotationId: null,
              },
            });
          } else if (slot.type === 'rotation') {
            const rotEntry = rotationMap.get(slot.rotationName);
            if (!rotEntry) continue;

            await tx.planDayAssignment.create({
              data: {
                planId: plan.id,
                dayOfWeek: day.dayOfWeek,
                order: slotOrder,
                workoutTypeId: null,
                rotationId: rotEntry.rotationId,
              },
            });
          }

          slotOrder++;
        }
      }

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
