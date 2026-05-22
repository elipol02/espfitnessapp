import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { ChatContent } from './ChatContent';
import { redirect } from 'next/navigation';

async function getChatData(userId: string, sessionId?: string, forceNew?: boolean) {
  let session: { id: string; userId: string; title: string | null; createdAt: Date; updatedAt: Date } | null;
  let messages: Array<{
    id: string;
    role: string;
    content: string;
    metadata: unknown;
    approved: boolean;
    createdAt: Date;
  }>;

  if (sessionId) {
    session = await prisma.chatSession.findUnique({
      where: { id: sessionId, userId },
    });
    messages = session
      ? await prisma.chatMessage.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'asc' },
          take: 100,
        })
      : [];
  } else if (forceNew) {
    session = await prisma.chatSession.create({
      data: { userId, title: null },
    });
    messages = [];
  } else {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    session = await prisma.chatSession.findFirst({
      where: { userId, updatedAt: { gte: oneHourAgo } },
      orderBy: { updatedAt: 'desc' },
    });

    if (session) {
      messages = await prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
    } else {
      session = await prisma.chatSession.create({
        data: { userId, title: null },
      });
      messages = [];
    }
  }

  const scheduleCount = await prisma.dayAssignment.count({ where: { userId } });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, bodyweight: true },
  });

  return {
    sessionId: session!.id,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      metadata: m.metadata as Record<string, unknown> | null,
      approved: m.approved,
      createdAt: m.createdAt.toISOString(),
    })),
    hasSchedule: scheduleCount > 0,
    user,
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
  const forceNew = queryParams.new !== undefined;

  const data = await getChatData(session.user.id, sessionId, forceNew);
  return <ChatContent data={data} userId={session.user.id} />;
}
