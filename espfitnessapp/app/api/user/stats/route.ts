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

    // Calculate current streak
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recentLogs = await prisma.workoutLog.findMany({
      where: {
        userId: session.user.id,
        status: 'completed',
      },
      orderBy: { workoutDate: 'desc' },
      take: 30,
    });

    let streak = 0;
    const checkDate = new Date(today);

    for (const log of recentLogs) {
      const logDate = new Date(log.workoutDate);
      logDate.setHours(0, 0, 0, 0);

      const diffDays = Math.floor(
        (checkDate.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays <= 1) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // Update streak if changed
    if (streak !== stats.currentStreak) {
      stats = await prisma.userStats.update({
        where: { userId: session.user.id },
        data: {
          currentStreak: streak,
          longestStreak: Math.max(streak, stats.longestStreak),
          lastWorkout: recentLogs[0]?.workoutDate || stats.lastWorkout,
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
