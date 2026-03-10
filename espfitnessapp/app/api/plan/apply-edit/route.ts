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
      return NextResponse.json({ success: false, error: 'Edit already applied' }, { status: 400 });
    }

    const metadata = chatMessage.metadata as Record<string, unknown> | null;
    if (metadata?.type !== 'edit_preview') {
      return NextResponse.json({ success: false, error: 'No edit preview in message' }, { status: 400 });
    }

    type EditArgs = {
      workoutTypeId: string;
      name?: string;
      color?: string;
      exercises?: Array<{
        id?: string;
        name: string;
        exerciseType: string;
        config: Record<string, unknown>;
        progression?: Record<string, unknown>;
        groupTag?: string;
        order: number;
        notes?: string;
      }>;
      deleteExerciseIds?: string[];
    };

    // Support new format (editPreviews array) and legacy format (single editArgs)
    const editArgsList: EditArgs[] = metadata.editPreviews
      ? (metadata.editPreviews as Array<{ editArgs: EditArgs }>).map((ep) => ep.editArgs)
      : metadata.editArgs
        ? [metadata.editArgs as EditArgs]
        : [];

    if (editArgsList.length === 0) {
      return NextResponse.json({ success: false, error: 'No edit data in message' }, { status: 400 });
    }

    // Validate all workout types belong to this user before starting transaction
    for (const editArgs of editArgsList) {
      const workoutType = await prisma.workoutType.findFirst({
        where: { id: editArgs.workoutTypeId, userId },
      });
      if (!workoutType) {
        return NextResponse.json({ success: false, error: 'Workout type not found' }, { status: 404 });
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const editArgs of editArgsList) {
        if (editArgs.name || editArgs.color) {
          await tx.workoutType.update({
            where: { id: editArgs.workoutTypeId },
            data: {
              ...(editArgs.name && { name: editArgs.name }),
              ...(editArgs.color && { color: editArgs.color }),
            },
          });
        }

        if (editArgs.deleteExerciseIds?.length) {
          await tx.exercise.deleteMany({
            where: {
              id: { in: editArgs.deleteExerciseIds },
              workoutTypeId: editArgs.workoutTypeId,
            },
          });
        }

        if (editArgs.exercises) {
          for (const ex of editArgs.exercises) {
            if (ex.id) {
              await tx.exercise.update({
                where: { id: ex.id },
                data: {
                  name: ex.name,
                  exerciseType: ex.exerciseType,
                  config: ex.config as Prisma.InputJsonValue,
                  progression: (ex.progression ?? undefined) as Prisma.InputJsonValue | undefined,
                  groupTag: ex.groupTag || null,
                  order: ex.order,
                  notes: ex.notes || null,
                },
              });
            } else {
              await tx.exercise.create({
                data: {
                  workoutTypeId: editArgs.workoutTypeId,
                  name: ex.name,
                  exerciseType: ex.exerciseType,
                  config: ex.config as Prisma.InputJsonValue,
                  progression: (ex.progression ?? undefined) as Prisma.InputJsonValue | undefined,
                  groupTag: ex.groupTag || null,
                  order: ex.order,
                  notes: ex.notes || null,
                },
              });
            }
          }
        }
      }

      await tx.chatMessage.update({
        where: { id: messageId },
        data: { approved: true },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error applying edit from message:', error);
    return NextResponse.json({ success: false, error: 'Failed to apply edit' }, { status: 500 });
  }
}
