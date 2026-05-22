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

    // Collect the unique workout-type definitions referenced anywhere in the plan
    // (fixed slots + rotation entries), keyed by name. First definition wins.
    type TypeDef = {
      name: string;
      color: string;
      category?: string;
      exercises: ExerciseInput[];
    };
    const incomingTypeDefs = new Map<string, TypeDef>();
    const addTypeDef = (d: TypeDef) => {
      const key = d.name.trim().toLowerCase();
      if (!incomingTypeDefs.has(key)) incomingTypeDefs.set(key, d);
    };
    for (const day of planData.schedule) {
      for (const slot of day.slots) {
        if (slot.type === 'fixed') {
          addTypeDef({ name: slot.workoutTypeName, color: slot.workoutTypeColor, category: slot.workoutTypeCategory, exercises: slot.exercises });
        } else {
          for (const entry of slot.rotationEntries) {
            addTypeDef({ name: entry.workoutTypeName, color: entry.workoutTypeColor, category: entry.workoutTypeCategory, exercises: entry.exercises });
          }
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // Whether the user already has a schedule (vs. creating one from scratch).
      const hadSchedule = (await tx.dayAssignment.count({ where: { userId } })) > 0;

      // ── Smart merge: reuse existing workout types / rotations by NAME so unchanged
      // workouts (and their session/progression history) are never recreated. Only
      // the pieces that actually differ are updated; new ones are added; rotations
      // dropped from the plan are removed. We never delete a WorkoutType — past
      // WorkoutSessions reference it via a cascading FK and that would erase history.

      // Index existing types by name (newest wins for any legacy duplicates).
      const existingTypes = await tx.workoutType.findMany({
        where: { userId },
        include: { exercises: true },
        orderBy: { createdAt: 'asc' },
      });
      const typeByName = new Map<string, (typeof existingTypes)[number]>();
      for (const t of existingTypes) typeByName.set(t.name.trim().toLowerCase(), t);

      // Reconcile a workout type's exercises in place (match by name → keep ids/history).
      const reconcileExercises = async (
        workoutTypeId: string,
        existing: { id: string; name: string }[],
        incoming: ExerciseInput[],
      ) => {
        const existingByName = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e]));
        const keptIds = new Set<string>();
        for (let idx = 0; idx < incoming.length; idx++) {
          const ex = incoming[idx];
          const data = {
            name: ex.name,
            exerciseType: ex.exerciseType || 'strength',
            config: ex.config as Prisma.InputJsonValue,
            progression: (ex.progression ?? undefined) as Prisma.InputJsonValue | undefined,
            groupTag: ex.groupTag || null,
            order: ex.order ?? idx,
            notes: ex.notes || null,
          };
          const match = existingByName.get(ex.name.trim().toLowerCase());
          if (match) {
            await tx.exercise.update({ where: { id: match.id }, data });
            keptIds.add(match.id);
          } else {
            await tx.exercise.create({ data: { workoutTypeId, ...data } });
          }
        }
        // Remove exercises the plan no longer includes.
        const toDelete = existing.filter((e) => !keptIds.has(e.id)).map((e) => e.id);
        if (toDelete.length) await tx.exercise.deleteMany({ where: { id: { in: toDelete } } });
      };

      // Resolve every referenced type to an id (reuse or create), reconciling exercises.
      const resolvedTypeId = new Map<string, string>();
      for (const [key, def] of incomingTypeDefs) {
        const existing = typeByName.get(key);
        if (existing) {
          await tx.workoutType.update({
            where: { id: existing.id },
            data: { color: def.color, category: def.category || null },
          });
          await reconcileExercises(existing.id, existing.exercises, def.exercises);
          resolvedTypeId.set(key, existing.id);
        } else {
          const created = await tx.workoutType.create({
            data: {
              userId,
              name: def.name,
              color: def.color,
              category: def.category || null,
              exercises: {
                create: def.exercises.map((ex, idx) => ({
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
          resolvedTypeId.set(key, created.id);
        }
      }

      // Reconcile rotations by name — reuse existing (keep id + currentIndex so the
      // A/B position isn't reset), rebuilding their entries against the resolved types.
      const existingRotations = await tx.workoutRotation.findMany({ where: { userId } });
      const rotationByName = new Map(existingRotations.map((r) => [r.name.trim().toLowerCase(), r]));
      const resolvedRotationId = new Map<string, string>();
      const incomingRotationKeys = new Set<string>();

      for (const day of planData.schedule) {
        for (const slot of day.slots) {
          if (slot.type !== 'rotation') continue;
          const key = slot.rotationName.trim().toLowerCase();
          if (incomingRotationKeys.has(key)) continue;
          incomingRotationKeys.add(key);

          const entryTypeIds = slot.rotationEntries
            .map((e) => resolvedTypeId.get(e.workoutTypeName.trim().toLowerCase()))
            .filter((id): id is string => !!id);

          const existing = rotationByName.get(key);
          if (existing) {
            await tx.rotationEntry.deleteMany({ where: { rotationId: existing.id } });
            await tx.rotationEntry.createMany({
              data: entryTypeIds.map((wtId, idx) => ({ rotationId: existing.id, workoutTypeId: wtId, order: idx })),
            });
            resolvedRotationId.set(key, existing.id);
          } else {
            const created = await tx.workoutRotation.create({
              data: {
                userId,
                name: slot.rotationName,
                currentIndex: 0,
                entries: { create: entryTypeIds.map((wtId, idx) => ({ workoutTypeId: wtId, order: idx })) },
              },
            });
            resolvedRotationId.set(key, created.id);
          }
        }
      }

      // Remove rotations no longer in the plan (cascades entries; session.rotationId SET NULL).
      const staleRotationIds = existingRotations
        .filter((r) => !incomingRotationKeys.has(r.name.trim().toLowerCase()))
        .map((r) => r.id);
      if (staleRotationIds.length) await tx.workoutRotation.deleteMany({ where: { id: { in: staleRotationIds } } });

      // Rebuild the day → slot mapping (no history attached to assignments) using the
      // resolved type/rotation ids. This is what adds/moves/removes days.
      await tx.dayAssignment.deleteMany({ where: { userId } });
      for (const day of planData.schedule) {
        let slotOrder = 0;
        for (const slot of day.slots) {
          if (slot.type === 'fixed') {
            const workoutTypeId = resolvedTypeId.get(slot.workoutTypeName.trim().toLowerCase());
            if (workoutTypeId) {
              await tx.dayAssignment.create({
                data: { userId, dayOfWeek: day.dayOfWeek, order: slotOrder, workoutTypeId, rotationId: null },
              });
            }
          } else {
            const rotationId = resolvedRotationId.get(slot.rotationName.trim().toLowerCase());
            if (rotationId) {
              await tx.dayAssignment.create({
                data: { userId, dayOfWeek: day.dayOfWeek, order: slotOrder, workoutTypeId: null, rotationId },
              });
            }
          }
          slotOrder++;
        }
      }

      // On first creation, stamp the schedule start date as today so days before
      // now don't show as scheduled/missed on home + calendar.
      if (!hadSchedule) {
        await tx.user.update({ where: { id: userId }, data: { scheduleStartedAt: new Date() } });
      }

      // Mark message as approved
      await tx.chatMessage.update({
        where: { id: messageId },
        data: { approved: true },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error applying plan from message:', error);
    return NextResponse.json({ success: false, error: 'Failed to apply plan' }, { status: 500 });
  }
}
