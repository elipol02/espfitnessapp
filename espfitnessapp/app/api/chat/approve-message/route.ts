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
      // Find all other plan_preview messages to unapprove (bulk query)
      const otherPlanMessages = await prisma.chatMessage.findMany({
        where: {
          sessionId: message.sessionId,
          userId: session.user.id,
          id: { not: messageId },
        },
        select: {
          id: true,
          metadata: true,
        },
      });

      // Filter for plan_preview messages and bulk update them
      const planPreviewMessages = otherPlanMessages.filter((msg) => {
        const metadata = msg.metadata as { type?: string } | null;
        return metadata?.type === 'plan_preview';
      });

      // Update all plan_preview messages in a transaction for efficiency
      if (planPreviewMessages.length > 0) {
        await prisma.$transaction(
          planPreviewMessages.map((msg) =>
            prisma.chatMessage.update({
              where: { id: msg.id },
              data: {
                metadata: {
                  ...(msg.metadata as object || {}),
                  approved: false,
                },
              },
            })
          )
        );
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

      // Find all other messages with the same adjustmentId
      const otherAdjustmentMessages = await prisma.chatMessage.findMany({
        where: {
          sessionId: message.sessionId,
          userId: session.user.id,
          id: { not: messageId },
        },
        select: {
          id: true,
          metadata: true,
        },
      });

      // Filter for messages with the same adjustmentId and bulk update them
      const adjustmentMessages = otherAdjustmentMessages.filter((msg) => {
        const metadata = msg.metadata as { adjustmentId?: string } | null;
        return metadata?.adjustmentId === adjustmentId;
      });

      // Update all adjustment messages in a transaction for efficiency
      if (adjustmentMessages.length > 0) {
        await prisma.$transaction(
          adjustmentMessages.map((msg) =>
            prisma.chatMessage.update({
              where: { id: msg.id },
              data: {
                metadata: {
                  ...(msg.metadata as object || {}),
                  approved: false,
                },
              },
            })
          )
        );
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
