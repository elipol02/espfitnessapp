import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { messageId, adjustmentId } = body;

    if (!messageId || !adjustmentId) {
      return NextResponse.json(
        { success: false, error: 'Message ID and Adjustment ID required' },
        { status: 400 }
      );
    }

    // Verify the message belongs to the user
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
    });

    if (!message || message.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Message not found or unauthorized' },
        { status: 404 }
      );
    }

    // Get the suggestions from this message's metadata
    const messageMetadata = message.metadata as { 
      adjustmentData?: { exercises: Array<unknown> };
      [key: string]: unknown;
    } | null;
    
    const messageSuggestions = messageMetadata?.adjustmentData?.exercises;

    // Update the pendingAdjustment with this message's suggestions
    if (messageSuggestions) {
      await prisma.pendingAdjustment.update({
        where: { id: adjustmentId },
        data: {
          suggestions: messageSuggestions,
        },
      });
    }

    // Update this message to approved
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        metadata: {
          ...(message.metadata as object || {}),
          approved: true,
        },
      },
    });

    // Find all other messages with the same adjustmentId and mark them as not approved
    const sessionMessages = await prisma.chatMessage.findMany({
      where: {
        sessionId: message.sessionId,
        userId: session.user.id,
        id: { not: messageId },
      },
    });

    for (const msg of sessionMessages) {
      const metadata = msg.metadata as { adjustmentId?: string; approved?: boolean } | null;
      if (metadata?.adjustmentId === adjustmentId) {
        await prisma.chatMessage.update({
          where: { id: msg.id },
          data: {
            metadata: {
              ...metadata,
              approved: false,
            },
          },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Approve message error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to approve message' },
      { status: 500 }
    );
  }
}
