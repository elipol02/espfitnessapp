import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

export async function GET() {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const workoutTypes = await prisma.workoutType.findMany({
      where: { userId: session.user.id },
      include: {
        exercises: { orderBy: { order: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: workoutTypes });
  } catch (error) {
    console.error('Error fetching workout types:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch workout types' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const { name, color, category, exercises } = await request.json();

    if (!name) {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }

    const workoutType = await prisma.workoutType.create({
      data: {
        userId,
        name,
        color: color || '#404040',
        category: category || null,
        exercises: {
          create: (exercises || []).map((ex: Record<string, unknown>, idx: number) => ({
            name: ex.name as string,
            exerciseType: (ex.exerciseType as string) || 'strength',
            config: ex.config as object,
            progression: (ex.progression as object) || undefined,
            groupTag: (ex.groupTag as string) || null,
            order: (ex.order as number) ?? idx,
            notes: (ex.notes as string) || null,
          })),
        },
      },
      include: {
        exercises: { orderBy: { order: 'asc' } },
      },
    });

    return NextResponse.json({ success: true, data: workoutType });
  } catch (error) {
    console.error('Error creating workout type:', error);
    return NextResponse.json({ success: false, error: 'Failed to create workout type' }, { status: 500 });
  }
}
