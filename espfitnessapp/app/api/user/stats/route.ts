import { NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

// GET - Get user stats
export async function GET() {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    let stats = await prisma.userStats.findUnique({
      where: { userId: session.user.id },
    });

    // Create stats if they don't exist
    if (!stats) {
      stats = await prisma.userStats.create({
        data: {
          userId: session.user.id,
          currentStreak: 0,
          longestStreak: 0,
          personalRecords: {},
          progressPercentage: 0,
        },
      });
    }

    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
