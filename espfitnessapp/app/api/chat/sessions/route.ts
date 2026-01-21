import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

export async function GET(_request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Delete empty chat sessions older than 1 hour (cleanup)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.chatSession.deleteMany({
      where: {
        userId,
        createdAt: { lt: oneHourAgo },
        messages: { none: {} },
      },
    });

    // Fetch all chat sessions with message count
    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    // Format sessions for response, filtering out empty conversations
    const formattedSessions = sessions
      .filter((session) => session._count.messages > 0)
      .map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        messageCount: session._count.messages,
      }));

    return NextResponse.json({
      success: true,
      data: { sessions: formattedSessions },
    });
  } catch (error) {
    console.error('Error fetching chat sessions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}
