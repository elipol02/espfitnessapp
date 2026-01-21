import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { ChatContent } from '../ChatContent';
import { redirect } from 'next/navigation';

interface PendingAdjustmentData {
  id: string;
  workoutLogId: string;
  workoutType: string;
  completedDate: Date;
  nextWorkoutDate: Date | null;
  suggestions: unknown[];
  status: string;
}

async function getChatData(userId: string, sessionId?: string, forceNew: boolean = false, adjustmentId?: string) {
  let session: { id: string; userId: string; title: string | null; createdAt: Date; updatedAt: Date } | null;
  let messages: any[];
  let pendingAdjustment: PendingAdjustmentData | null = null;
  
  // If there's an adjustment ID, fetch the pending adjustment data
  if (adjustmentId) {
    const adjustment = await prisma.pendingAdjustment.findUnique({
      where: { id: adjustmentId },
      include: {
        plan: {
          select: { id: true },
        },
      },
    });

    if (adjustment && adjustment.userId === userId) {
      // Get the workout log details
      const workoutLog = await prisma.workoutLog.findUnique({
        where: { id: adjustment.workoutLogId },
        include: {
          day: {
            select: { workoutType: true },
          },
        },
      });

      if (workoutLog) {
        // Find the next workout of the same type
        const nextWorkout = await prisma.workoutDay.findFirst({
          where: {
            planId: adjustment.planId,
            workoutType: workoutLog.day.workoutType,
            scheduledDate: { gt: new Date() },
          },
          orderBy: { scheduledDate: 'asc' },
        });

        pendingAdjustment = {
          id: adjustment.id,
          workoutLogId: adjustment.workoutLogId,
          workoutType: workoutLog.day.workoutType,
          completedDate: workoutLog.workoutDate,
          nextWorkoutDate: nextWorkout?.scheduledDate || null,
          suggestions: adjustment.suggestions as unknown[],
          status: adjustment.status,
        };
      }
    }
  }
  
  if (forceNew) {
    // Force create a brand new session
    session = await prisma.chatSession.create({
      data: {
        userId,
        title: null,
      },
    });
    messages = [];
  } else if (sessionId) {
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

  // Detect mode from message history if present
  let detectedMode: string | null = null;
  if (messages.length > 0) {
    const firstUserMessage = messages.find((m: any) => m.role === 'user');
    if (firstUserMessage?.metadata && typeof firstUserMessage.metadata === 'object') {
      const metadata = firstUserMessage.metadata as { mode?: string };
      detectedMode = metadata.mode || null;
    }
  }

  return {
    sessionId: session!.id,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      metadata: m.metadata as Record<string, unknown> | null,
      createdAt: m.createdAt.toISOString(),
    })),
    activePlan,
    user,
    approvedPlanIds,
    approvedAdjustmentIds,
    detectedMode,
    pendingAdjustment,
  };
}

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { session, error } = await validateSession();

  if (error || !session?.user?.id) {
    redirect('/login');
  }

  const routeParams = await params;
  const queryParams = await searchParams;
  
  // Extract mode from URL path (e.g., /chat/create → mode = 'create')
  const pathMode = routeParams.slug?.[0];
  
  const sessionId = queryParams.session as string | undefined;
  const isPostWorkout = queryParams.postWorkout === 'true';
  const adjustmentId = queryParams.adjustmentId as string | undefined;
  const isNew = queryParams.new === 'true';
  
  // Determine the mode
  let mode: string | undefined;
  if (isPostWorkout || pathMode === 'post_workout') {
    mode = 'post_workout';
  } else if (pathMode && ['create', 'edit', 'ask'].includes(pathMode)) {
    mode = pathMode;
  }
  
  // Force new session for post-workout mode when there's no existing session specified
  // This ensures "Generate Analysis" creates a fresh chat
  const forceNewSession = (isPostWorkout || pathMode === 'post_workout') && !sessionId;
  
  // If new=true and no sessionId, return empty data to show menu
  let data;
  if (isNew && !sessionId) {
    // Create a new empty session for the menu
    const newSession = await prisma.chatSession.create({
      data: {
        userId: session.user.id,
        title: null,
      },
    });
    
    // Get active plan and user info
    const activePlan = await prisma.workoutPlan.findFirst({
      where: {
        userId: session.user.id,
        status: 'active',
      },
      select: {
        id: true,
        goal: true,
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        bodyweight: true,
      },
    });
    
    data = {
      sessionId: newSession.id,
      messages: [],
      activePlan,
      user,
      approvedPlanIds: [],
      approvedAdjustmentIds: [],
      detectedMode: null,
      pendingAdjustment: null,
    };
  } else {
    data = await getChatData(session.user.id, sessionId, forceNewSession, adjustmentId);
  }

  return (
    <ChatContent 
      data={data} 
      userId={session.user.id} 
      isNewSession={forceNewSession} 
      urlMode={mode}
      adjustmentId={adjustmentId}
    />
  );
}
