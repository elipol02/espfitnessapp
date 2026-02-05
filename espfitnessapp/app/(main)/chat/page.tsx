import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { ChatContent } from './ChatContent';
import { redirect } from 'next/navigation';

// Helper to migrate old progression object format to new string format
function migrateProgression(prog: unknown): string | undefined {
  if (!prog) return undefined;
  if (typeof prog === 'string') return prog;
  if (typeof prog === 'object' && prog !== null) {
    const p = prog as { type?: string; increment?: number | string; frequency?: string };
    if (p.type || p.increment || p.frequency) {
      const type = p.type || 'linear';
      let increment = '';
      if (p.increment !== undefined) {
        if (typeof p.increment === 'number') {
          increment = p.increment < 1 
            ? `+${(p.increment * 100).toFixed(0)}%`
            : `+${p.increment} lbs`;
        } else {
          increment = String(p.increment);
        }
      }
      const frequency = p.frequency || 'weekly';
      return `${type} ${increment} ${frequency}`.trim();
    }
  }
  return undefined;
}

// Helper to migrate metadata with progression fields
function migrateMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object') return metadata;
  
  const meta = metadata as any;
  
  // Migrate plan_preview metadata
  if (meta.type === 'plan_preview' && meta.planData?.schedule) {
    return {
      ...meta,
      planData: {
        ...meta.planData,
        schedule: meta.planData.schedule.map((day: any) => ({
          ...day,
          exercises: day.exercises?.map((ex: any) => ({
            ...ex,
            progression: migrateProgression(ex.progression),
          })) || []
        }))
      }
    };
  }
  
  // Migrate adjustment_preview metadata
  if (meta.type === 'adjustment_preview' && meta.adjustmentData?.exercises) {
    return {
      ...meta,
      adjustmentData: {
        ...meta.adjustmentData,
        exercises: meta.adjustmentData.exercises.map((ex: any) => ({
          ...ex,
          currentProgression: migrateProgression(ex.currentProgression),
          nextProgression: migrateProgression(ex.nextProgression),
        }))
      }
    };
  }
  
  return metadata;
}

async function getChatData(userId: string, sessionId?: string, adjustmentId?: string, forceNew?: boolean) {
  let session: { id: string; userId: string; title: string | null; createdAt: Date; updatedAt: Date } | null;
  let messages: any[];
  
  if (sessionId) {
    // Load specific session
    session = await prisma.chatSession.findUnique({
      where: { id: sessionId, userId },
    });
    
    if (session) {
      messages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
    } else {
      messages = [];
    }
  } else if (adjustmentId) {
    // If adjustmentId is provided, look for an existing session with that adjustment
    // Get all recent messages for this user and filter in JavaScript
    const allRecentMessages = await prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { session: true },
    });

    const messageWithAdjustment = allRecentMessages.find((msg) => {
      if (msg.metadata && typeof msg.metadata === 'object') {
        const meta = msg.metadata as { adjustmentId?: string };
        return meta.adjustmentId === adjustmentId;
      }
      return false;
    });

    if (messageWithAdjustment) {
      // Use existing session
      session = messageWithAdjustment.session;
      messages = await prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
    } else {
      // Create new session for this adjustment
      session = await prisma.chatSession.create({
        data: {
          userId,
          title: 'Workout Analysis',
        },
      });
      messages = [];
    }
  } else {
    // If forceNew is true, always create a new session
    if (forceNew) {
      session = await prisma.chatSession.create({
        data: {
          userId,
          title: null,
        },
      });
      messages = [];
    } else {
      // Get or create the most recent session (within last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      session = await prisma.chatSession.findFirst({
        where: {
          userId,
          updatedAt: { gte: oneHourAgo },
        },
        orderBy: { updatedAt: 'desc' },
      });
      
      if (session) {
        messages = await prisma.chatMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'asc' },
          take: 100,
        });
      } else {
        // Create new session
        session = await prisma.chatSession.create({
          data: {
            userId,
            title: null,
          },
        });
        messages = [];
      }
    }
  }

  // Get active plan info
  const activePlan = await prisma.workoutPlan.findFirst({
    where: {
      userId,
      status: 'active',
    },
    select: {
      id: true,
      goal: true,
    },
  });

  // Get user info
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      bodyweight: true,
    },
  });

  // Get all plan IDs mentioned in messages and check their status
  const planIds = messages
    .map((m: any) => m.metadata?.planId)
    .filter((id): id is string => typeof id === 'string');
  
  const plans = await prisma.workoutPlan.findMany({
    where: { id: { in: planIds } },
    select: { id: true, status: true },
  });
  
  const approvedPlanIds = plans
    .filter((p: { id: string; status: string }) => p.status === 'active')
    .map((p: { id: string; status: string }) => p.id);

  // Get all adjustment IDs mentioned in messages and check their status
  const adjustmentIds = messages
    .map((m: { metadata?: { adjustmentId?: unknown } }) => m.metadata?.adjustmentId)
    .filter((id): id is string => typeof id === 'string');
  
  const adjustments = await prisma.pendingAdjustment.findMany({
    where: { id: { in: adjustmentIds } },
    select: { id: true, status: true },
  });
  
  const approvedAdjustmentIds = adjustments
    .filter((a: { id: string; status: string }) => a.status === 'approved')
    .map((a: { id: string; status: string }) => a.id);

  // Check if this session has a pending adjustment
  let sessionAdjustmentId = adjustmentId || null;
  if (!sessionAdjustmentId && messages.length > 0) {
    // Look for adjustmentId in message metadata
    const msgWithAdj = messages.find((m: any) => m.metadata?.adjustmentId);
    if (msgWithAdj) {
      sessionAdjustmentId = msgWithAdj.metadata.adjustmentId;
    }
  }

  return {
    sessionId: session!.id,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      metadata: migrateMetadata(m.metadata) as Record<string, unknown> | null,
      createdAt: m.createdAt.toISOString(),
    })),
    activePlan,
    user,
    approvedPlanIds,
    approvedAdjustmentIds,
    adjustmentId: sessionAdjustmentId,
  };
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { session, error } = await validateSession();

  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const queryParams = await searchParams;
  const sessionId = queryParams.session as string | undefined;
  const adjustmentId = queryParams.adjustmentId as string | undefined;
  const forceNew = queryParams.new !== undefined; // If 'new' param exists, force new session
  
  const data = await getChatData(session.user.id, sessionId, adjustmentId, forceNew);

  return <ChatContent data={data} userId={session.user.id} />;
}
