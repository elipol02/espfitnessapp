import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const { sessionId, content } = await request.json();

    if (!sessionId || !content) {
      return NextResponse.json({ success: false, error: 'Missing sessionId or content' }, { status: 400 });
    }

    // Verify the session belongs to this user
    const chatSession = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!chatSession) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    // Save the partial assistant message
    await prisma.chatMessage.create({
      data: {
        sessionId,
        userId,
        role: 'assistant',
        content,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Save partial error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save partial response' }, { status: 500 });
  }
}
