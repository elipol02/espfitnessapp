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

    if (!messageId) {
      return NextResponse.json(
        { success: false, error: 'Message ID required' },
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

    const messageMetadata = message.metadata as any;

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

    // Handle plan approval
    if (messageMetadata?.type === 'plan_preview') {
      // Find all other messages with plan_preview and mark them as not approved
      const sessionMessages = await prisma.chatMessage.findMany({
        where: {
          sessionId: message.sessionId,
          userId: session.user.id,
          id: { not: messageId },
        },
      });

      for (const msg of sessionMessages) {
        const metadata = msg.metadata as { type?: string; approved?: boolean } | null;
        if (metadata?.type === 'plan_preview') {
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
    }

    // Handle adjustment approval
    if (adjustmentId) {
      const adjustmentMetadata = messageMetadata?.adjustmentData;
      const messageSuggestions = adjustmentMetadata?.exercises;

      // Update the pendingAdjustment with this message's suggestions
      if (messageSuggestions) {
        await prisma.pendingAdjustment.update({
          where: { id: adjustmentId },
          data: {
            suggestions: messageSuggestions,
          },
        });
      }

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
