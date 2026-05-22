import { NextRequest } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import {
  getOpenRouterClient,
  buildSystemMessage,
  WORKOUT_TOOLS,
  type ChatMessage,
  type SSEEvent,
  type AskUserQuestion,
} from '@/app/lib/openrouter';

export const maxDuration = 300;

function encodeSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Fetch memories for the user. If query is provided, prefer memories whose content matches (simple word overlap). */
async function searchMemories(
  userId: string,
  limit: number = 20,
  query?: string,
): Promise<string[]> {
  const words =
    query
      ?.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2) || [];
  const memories = await prisma.chatMemory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit * 2,
  });
  if (words.length === 0) {
    return memories.slice(0, limit).map((m) => m.content);
  }
  const scored = memories.map((m) => {
    const lower = m.content.toLowerCase();
    const score = words.filter((w) => lower.includes(w)).length;
    return { content: m.content, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, limit)
    .map((s) => s.content)
    .concat(scored.filter((s) => s.score === 0).map((s) => s.content))
    .slice(0, limit);
}

async function executeTool(
  toolCall: { id: string; name: string; arguments: Record<string, unknown> },
  userId: string,
  sessionId: string,
): Promise<{ result: Record<string, unknown>; metadata?: Record<string, unknown> }> {
  if (toolCall.name === 'create_workout_plan') {
    const args = toolCall.arguments as {
      name: string;
      schedule: Array<{
        dayOfWeek: number;
        dayName: string;
        slots: Array<
          | {
              type: 'fixed';
              workoutTypeName: string;
              workoutTypeColor: string;
              workoutTypeCategory?: string;
              exercises: Array<{
                name: string;
                exerciseType: string;
                config: Record<string, unknown>;
                progression?: Record<string, unknown>;
                groupTag?: string;
                order: number;
                notes?: string;
              }>;
            }
          | {
              type: 'rotation';
              rotationName: string;
              rotationEntries: Array<{
                workoutTypeName: string;
                workoutTypeColor: string;
                workoutTypeCategory?: string;
                exercises: Array<{
                  name: string;
                  exerciseType: string;
                  config: Record<string, unknown>;
                  progression?: Record<string, unknown>;
                  groupTag?: string;
                  order: number;
                  notes?: string;
                }>;
              }>;
            }
        >;
      }>;
    };

    const planData = { name: args.name, schedule: args.schedule };
    return {
      result: { success: true, planData },
      metadata: { type: 'plan_preview', planData },
    };
  }

  if (toolCall.name === 'edit_workout_plan') {
    const args = toolCall.arguments as {
      workoutTypeId: string;
      name?: string;
      color?: string;
      exercises?: Array<{
        id?: string;
        name: string;
        exerciseType: string;
        config: Record<string, unknown>;
        progression?: Record<string, unknown>;
        groupTag?: string;
        order: number;
        notes?: string;
      }>;
      deleteExerciseIds?: string[];
    };

    const workoutType = await prisma.workoutType.findFirst({
      where: { id: args.workoutTypeId, userId },
      include: { exercises: { orderBy: { order: 'asc' } } },
    });

    if (!workoutType) {
      throw new Error('Workout type not found');
    }

    // Build proposed state without saving to DB — user must confirm first
    const deleteIds = new Set(args.deleteExerciseIds || []);
    const remainingExercises = workoutType.exercises.filter((e) => !deleteIds.has(e.id));

    const proposedExercises = remainingExercises.map((e) => {
      const update = (args.exercises || []).find((u) => u.id === e.id);
      if (update) {
        return {
          id: e.id,
          name: update.name,
          exerciseType: update.exerciseType,
          config: update.config,
          progression: update.progression ?? null,
          groupTag: update.groupTag ?? null,
          order: update.order,
          notes: update.notes ?? null,
        };
      }
      return {
        id: e.id,
        name: e.name,
        exerciseType: e.exerciseType,
        config: e.config as Record<string, unknown>,
        progression: e.progression as Record<string, unknown> | null,
        groupTag: e.groupTag,
        order: e.order,
        notes: e.notes,
      };
    });

    const newExercises = (args.exercises || [])
      .filter((e) => !e.id)
      .map((e) => ({
        id: null,
        name: e.name,
        exerciseType: e.exerciseType,
        config: e.config,
        progression: e.progression ?? null,
        groupTag: e.groupTag ?? null,
        order: e.order,
        notes: e.notes ?? null,
      }));

    const allProposed = [...proposedExercises, ...newExercises].sort(
      (a, b) => a.order - b.order,
    );

    const currentState = {
      id: workoutType.id,
      name: workoutType.name,
      color: workoutType.color,
      exercises: workoutType.exercises.map((e) => ({
        id: e.id,
        name: e.name,
        exerciseType: e.exerciseType,
        config: e.config as Record<string, unknown>,
        progression: e.progression as Record<string, unknown> | null,
        groupTag: e.groupTag,
        order: e.order,
        notes: e.notes,
      })),
    };

    const proposedState = {
      id: workoutType.id,
      name: args.name || workoutType.name,
      color: args.color || workoutType.color,
      exercises: allProposed,
    };

    const editPreview = {
      workoutTypeId: args.workoutTypeId,
      editArgs: args,
      currentState,
      proposedState,
    };

    return {
      result: { success: true, preview: true, editPreview },
      metadata: { type: 'edit_preview', ...editPreview },
    };
  }

  if (toolCall.name === 'write_memory') {
    const args = toolCall.arguments as { content: string };
    const content = (args.content || '').trim();
    if (!content) {
      return { result: { success: false, error: 'content is required' } };
    }
    await prisma.chatMemory.create({
      data: {
        userId,
        sessionId,
        content: content.slice(0, 2000),
      },
    });
    return { result: { success: true } };
  }

  if (toolCall.name === 'get_workout_history') {
    const args = toolCall.arguments as {
      workoutTypeId: string;
      limit?: number;
    };

    const sessions = await prisma.workoutSession.findMany({
      where: {
        workoutTypeId: args.workoutTypeId,
        userId,
        status: 'completed',
      },
      orderBy: { workoutDate: 'desc' },
      take: args.limit || 10,
      include: {
        entries: {
          include: { exercise: true },
        },
      },
    });

    const formatted = sessions.map((s) => ({
      date: s.workoutDate,
      rating: s.rating,
      notes: s.notes,
      exercises: s.entries.map((e) => ({
        name: e.exercise.name,
        exerciseType: e.exercise.exerciseType,
        data: e.data,
      })),
    }));

    return { result: { success: true, sessions: formatted } };
  }

  throw new Error(`Unknown tool: ${toolCall.name}`);
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const { signal } = request;

  const sendEvent = async (event: SSEEvent) => {
    try {
      await writer.write(encoder.encode(encodeSSE(event)));
    } catch {
      // Client may have disconnected; ignore write errors
    }
  };

  (async () => {
    // Hoisted so the catch block can access them for partial saves
    let fullResponse = '';
    let sessionId: string | undefined;
    let userId: string | undefined;

    // Bubble tracking: each "round" of text after tool calls becomes its own chat bubble
    const bubbles: Array<{ text: string; metadata?: Record<string, unknown> }> = [];
    let currentBubbleText = '';
    let currentBubbleEditPreviews: Array<Record<string, unknown>> = [];
    let currentBubblePlanData: unknown = undefined;

    const finalizeBubble = () => {
      let bubbleMeta: Record<string, unknown> | undefined;
      if (currentBubbleEditPreviews.length > 0) {
        bubbleMeta = { type: 'edit_preview', editPreviews: [...currentBubbleEditPreviews] };
      } else if (currentBubblePlanData !== undefined) {
        bubbleMeta = { type: 'plan_preview', planData: currentBubblePlanData };
      }
      if (currentBubbleText.trim() || bubbleMeta) {
        bubbles.push({ text: currentBubbleText, metadata: bubbleMeta });
      }
      currentBubbleText = '';
      currentBubbleEditPreviews = [];
      currentBubblePlanData = undefined;
    };

    const saveBubbles = async (): Promise<string[]> => {
      const ids: string[] = [];
      for (const bubble of bubbles) {
        const msg = await prisma.chatMessage.create({
          data: {
            sessionId: sessionId!,
            userId: userId!,
            role: 'assistant',
            content: bubble.text,
            metadata: (bubble.metadata as object) || undefined,
          },
        });
        ids.push(msg.id);
      }
      return ids;
    };

    try {
      const { session, error } = await validateSession();
      if (error || !session?.user?.id) {
        await sendEvent({ type: 'error', error: error || 'Unauthorized' });
        await writer.close();
        return;
      }

      userId = session.user.id;
      const body = await request.json();
      const { sessionId: sid, message, displayMessage, planId, context } = body;
      sessionId = sid;

      const chatSession = await prisma.chatSession.findUnique({
        where: { id: sessionId, userId },
      });

      if (!chatSession) {
        await sendEvent({ type: 'error', error: 'Session not found or unauthorized' });
        await writer.close();
        return;
      }

      if (!sessionId) {
        await sendEvent({ type: 'error', error: 'Session ID required' });
        await writer.close();
        return;
      }

      if (message && message.trim()) {
        await prisma.chatMessage.create({
          data: {
            sessionId,
            userId,
            role: 'user',
            content: displayMessage?.trim() || message.trim(),
            metadata: {},
          },
        });
      }

      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      const recentMessages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const lastUserMessage = recentMessages.find((m) => m.role === 'user')?.content ?? '';
      const memorySummaries = await searchMemories(
        userId,
        20,
        lastUserMessage || undefined,
      );

      const chatHistory: ChatMessage[] = recentMessages
        .reverse()
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      if (displayMessage && message && chatHistory.length > 0) {
        const lastIdx = chatHistory.length - 1;
        if (chatHistory[lastIdx].role === 'user') {
          chatHistory[lastIdx] = { ...chatHistory[lastIdx], content: message.trim() };
        }
      }

      let currentPlan = null;
      if (planId) {
        currentPlan = await prisma.workoutPlan.findUnique({
          where: { id: planId },
          include: {
            dayAssignments: {
              include: {
                workoutType: {
                  include: {
                    exercises: { orderBy: { order: 'asc' } },
                  },
                },
                rotation: {
                  include: {
                    entries: {
                      orderBy: { order: 'asc' },
                      include: {
                        workoutType: {
                          include: { exercises: { orderBy: { order: 'asc' } } },
                        },
                      },
                    },
                  },
                },
              },
              orderBy: [{ dayOfWeek: 'asc' }, { order: 'asc' }],
            },
          },
        });
      }

      const systemMessage = buildSystemMessage({
        currentPlan: currentPlan
          ? {
              id: currentPlan.id,
              name: currentPlan.name,
              dayAssignments: currentPlan.dayAssignments.flatMap((da) => {
                // For rotation-based slots, expand each rotation entry as a separate "virtual" assignment
                if (!da.workoutType && da.rotation) {
                  return da.rotation.entries.map((entry) => ({
                    dayOfWeek: da.dayOfWeek,
                    workoutType: {
                      id: entry.workoutType.id,
                      name: `${entry.workoutType.name} (rotation: ${da.rotation!.name})`,
                      color: entry.workoutType.color,
                      exercises: entry.workoutType.exercises.map((ex) => ({
                        id: ex.id,
                        name: ex.name,
                        exerciseType: ex.exerciseType,
                        config: ex.config as Record<string, unknown>,
                        progression: ex.progression as Record<string, unknown> | null,
                        order: ex.order,
                      })),
                    },
                  }));
                }
                if (!da.workoutType) return [];
                return [{
                  dayOfWeek: da.dayOfWeek,
                  workoutType: {
                    id: da.workoutType.id,
                    name: da.workoutType.name,
                    color: da.workoutType.color,
                    exercises: da.workoutType.exercises.map((ex) => ({
                      id: ex.id,
                      name: ex.name,
                      exerciseType: ex.exerciseType,
                      config: ex.config as Record<string, unknown>,
                      progression: ex.progression as Record<string, unknown> | null,
                      order: ex.order,
                    })),
                  },
                }];
              }),
            }
          : null,
        userName: context?.userName,
        bodyweight: context?.bodyweight,
        memorySummaries,
      });

      const llmMessages: ChatMessage[] = [systemMessage, ...chatHistory];
      const openRouter = getOpenRouterClient();
      const allToolCallNames: string[] = [];
      let previousRoundHadTools = false;
      const usedToolCallIds = new Set<string>();

      const MAX_TOOL_ROUNDS = 5;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (signal.aborted) break;

        // When resuming after tool calls, finalize the current bubble and start a fresh one
        if (round > 0 && previousRoundHadTools) {
          finalizeBubble();
          await sendEvent({ type: 'new-bubble' });
        }

        let roundText = '';
        const roundToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

        const generator = openRouter.chatStream(
          llmMessages,
          { temperature: 0.7, tools: WORKOUT_TOOLS },
          signal,
        );

        for await (const chunk of generator) {
          if (chunk.type === 'text') {
            roundText += chunk.content;
            currentBubbleText += chunk.content;
            fullResponse += chunk.content;
            await sendEvent({ type: 'text-chunk', content: chunk.content });
          } else if (chunk.type === 'tool_call_start') {
            await sendEvent({
              type: 'tool-call',
              toolCall: { id: '', name: chunk.name, arguments: {} },
            });
          } else if (chunk.type === 'tool_call') {
            try {
              const args = JSON.parse(chunk.toolCall.arguments);
              roundToolCalls.push({
                id: chunk.toolCall.id,
                name: chunk.toolCall.name,
                arguments: args,
              });
            } catch (e) {
              console.error('Failed to parse tool call arguments:', e);
            }
          }
        }

        // Don't execute tools if the client cancelled mid-stream
        if (signal.aborted) break;

        if (roundToolCalls.length === 0) {
          previousRoundHadTools = false;
          break;
        }

        previousRoundHadTools = true;

        // Deduplicate tool calls by ID and ensure uniqueness across rounds
        const deduped = new Map<string, (typeof roundToolCalls)[0]>();
        for (const tc of roundToolCalls) {
          if (!deduped.has(tc.id)) deduped.set(tc.id, tc);
        }
        const uniqueToolCalls = [...deduped.values()];
        for (const tc of uniqueToolCalls) {
          if (usedToolCallIds.has(tc.id)) {
            tc.id = `toolu_${crypto.randomUUID().replace(/-/g, '')}`;
          }
          usedToolCallIds.add(tc.id);
        }

        llmMessages.push({
          role: 'assistant',
          content: roundText || null,
          tool_calls: uniqueToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });

        let breakAfterTools = false;

        for (const toolCall of uniqueToolCalls) {
          if (signal.aborted) break;

          allToolCallNames.push(toolCall.name);

          if (toolCall.name === 'ask_user') {
            const args = toolCall.arguments as { questions: AskUserQuestion[] };
            await sendEvent({ type: 'ask-user', questions: args.questions });

            llmMessages.push({
              role: 'tool',
              content: JSON.stringify({ status: 'questions_sent' }),
              tool_call_id: toolCall.id,
            });

            breakAfterTools = true;
            break;
          }

          try {
            const { result, metadata: toolMeta } = await executeTool(toolCall, userId, sessionId);

            if (toolMeta) {
              const metaType = toolMeta.type as string;
              if (metaType === 'edit_preview') {
                currentBubbleEditPreviews.push({
                  workoutTypeId: toolMeta.workoutTypeId as string,
                  editArgs: toolMeta.editArgs as Record<string, unknown>,
                  currentState: toolMeta.currentState as Record<string, unknown>,
                  proposedState: toolMeta.proposedState as Record<string, unknown>,
                });
              } else if (metaType === 'plan_preview') {
                currentBubblePlanData = toolMeta.planData;
              }
            }

            await sendEvent({
              type: 'tool-result',
              toolResult: { toolCallId: toolCall.id, result },
            });

            llmMessages.push({
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: toolCall.id,
            });

            if (toolCall.name === 'create_workout_plan') {
              breakAfterTools = true;
            }
          } catch (error) {
            console.error(`Tool execution error (${toolCall.name}):`, error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';

            await sendEvent({
              type: 'error',
              error: `Failed to execute ${toolCall.name}: ${errorMsg}`,
            });

            llmMessages.push({
              role: 'tool',
              content: JSON.stringify({ success: false, error: errorMsg }),
              tool_call_id: toolCall.id,
            });
          }
        }

        if (breakAfterTools) {
          finalizeBubble();
          break;
        }
      }

      // Finalize any remaining bubble not yet pushed
      finalizeBubble();

      if (signal.aborted) {
        if (bubbles.length > 0) {
          await saveBubbles();
        }
        return;
      }

      const savedIds = await saveBubbles();
      await sendEvent({ type: 'done', savedMessageIds: savedIds });

      const updatedSession = await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      if (!updatedSession.title) {
        const messageCount = await prisma.chatMessage.count({
          where: { sessionId },
        });

        if (messageCount >= 2) {
          let title = 'General Chat';
          if (allToolCallNames.some((n) => n === 'create_workout_plan')) {
            title = 'Create Workout Plan';
          } else if (allToolCallNames.some((n) => n === 'edit_workout_plan')) {
            title = 'Edit Workout Plan';
          }

          await prisma.chatSession.update({
            where: { id: sessionId },
            data: { title },
          });
        }
      }
    } catch (error) {
      const isAbort = signal.aborted || (error as Error).name === 'AbortError';
      if (isAbort) {
        // Save any completed bubbles before the client aborted
        if (bubbles.length > 0 && sessionId && userId) {
          try {
            await saveBubbles();
          } catch (saveError) {
            console.error('Failed to save partial messages on abort:', saveError);
          }
        }
        return;
      }
      console.error('Streaming chat error:', error);
      await sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Failed to process message',
      });
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
