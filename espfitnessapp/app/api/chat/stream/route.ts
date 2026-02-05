import { NextRequest } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import {
  getOpenRouterClient,
  type ChatMessage,
  type SSEEvent,
  type WorkoutDayData,
} from '@/app/lib/openrouter';

// Set timeout to 5 minutes for streaming AI responses
export const maxDuration = 300;

// Helper to encode SSE events
function encodeSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  // Create a TransformStream for SSE
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  
  // Helper to send SSE events
  const sendEvent = async (event: SSEEvent) => {
    await writer.write(encoder.encode(encodeSSE(event)));
  };

  // Process the request in the background
  (async () => {
    try {
      const { session, error } = await validateSession();
      if (error || !session?.user?.id) {
        await sendEvent({ type: 'error', error: error || 'Unauthorized' });
        await writer.close();
        return;
      }

      const userId = session.user.id;
      const body = await request.json();
      const { sessionId, message, planId, context } = body;

      // Verify session belongs to user
      const chatSession = await prisma.chatSession.findUnique({
        where: { id: sessionId, userId },
      });

      if (!chatSession) {
        await sendEvent({ type: 'error', error: 'Session not found or unauthorized' });
        await writer.close();
        return;
      }

      // Save user message (only if message is not empty)
      if (message && message.trim()) {
        await prisma.chatMessage.create({
          data: {
            sessionId,
            userId,
            planId: planId || null,
            role: 'user',
            content: message,
            metadata: {},
          },
        });
      }

      // Update session updatedAt
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      // Get recent conversation history for context
      const recentMessages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const chatHistory: ChatMessage[] = recentMessages
        .reverse()
        .filter((m: { role: string; content: string }) => m.role !== 'system')
        .map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      // Get OpenRouter client
      const openRouter = getOpenRouterClient();
      let fullResponse = '';
      let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

      // Get current plan for context
      let currentPlan = null;
      if (planId) {
        currentPlan = await prisma.workoutPlan.findUnique({
          where: { id: planId },
          include: {
            workoutDays: {
              include: { exercises: true },
              orderBy: { dayNumber: 'asc' },
            },
          },
        });
      }

      // Check if this chat session has an associated pending adjustment
      // First check if adjustmentId was passed in context, otherwise look for one in previous messages
      let adjustmentId = context?.adjustmentId || null;
      
      if (!adjustmentId) {
        // Look for adjustment metadata in previous messages
        // Get recent messages and check their metadata in JavaScript (Prisma JSON queries can be tricky)
        const recentMsgs = await prisma.chatMessage.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { metadata: true },
        });

        for (const msg of recentMsgs) {
          if (msg.metadata && typeof msg.metadata === 'object') {
            const metadata = msg.metadata as { adjustmentId?: string };
            if (metadata.adjustmentId) {
              adjustmentId = metadata.adjustmentId;
              break;
            }
          }
        }
      }

      // If still no adjustmentId but we have a planId, check for any pending adjustments for this plan
      if (!adjustmentId && planId) {
        const pendingAdj = await prisma.pendingAdjustment.findFirst({
          where: {
            userId,
            planId,
            status: 'pending',
          },
          orderBy: { createdAt: 'desc' },
        });

        if (pendingAdj) {
          adjustmentId = pendingAdj.id;
        }
      }

      // Log adjustmentId for debugging
      if (adjustmentId) {
        console.log('Passing adjustmentId to AI context:', adjustmentId);
      }

      // Fetch workout log data if adjustmentId is present
      let workoutLogData = null;
      if (adjustmentId) {
        const pendingAdj = await prisma.pendingAdjustment.findUnique({
          where: { id: adjustmentId },
          select: { workoutLogId: true },
        });

        if (pendingAdj?.workoutLogId) {
          const workoutLog = await prisma.workoutLog.findUnique({
            where: { id: pendingAdj.workoutLogId },
            include: {
              day: true,
              exerciseLogs: {
                include: {
                  exercise: true,
                },
              },
            },
          });

          if (workoutLog) {
            workoutLogData = {
              workoutDate: workoutLog.workoutDate,
              dayName: workoutLog.day.dayName,
              workoutType: workoutLog.day.workoutType,
              exercises: workoutLog.exerciseLogs.map((exLog) => ({
                name: exLog.exercise.name,
                exerciseType: exLog.exercise.exerciseType,
                prescribedSets: exLog.exercise.sets,
                prescribedReps: exLog.exercise.reps,
                prescribedWeight: exLog.exercise.weightValue,
                weightType: exLog.exercise.weightType,
                prescribedRestTime: exLog.exercise.restTime,
                progression: exLog.exercise.progression,
                // Time-based fields
                duration: exLog.exercise.duration,
                // Distance fields
                distance: exLog.exercise.distance,
                distanceUnit: exLog.exercise.distanceUnit,
                // AMRAP/EMOM/Tabata fields
                timeCap: exLog.exercise.timeCap,
                intervals: exLog.exercise.intervals,
                tempo: exLog.exercise.tempo,
                // Completed data
                completedSets: exLog.setsCompleted,
                repsPerSet: exLog.repsPerSet,
                weightUsed: exLog.weightUsed,
                completedDuration: exLog.duration,
                completedDistance: exLog.distance,
                completedRounds: exLog.roundsCompleted,
                timeElapsed: exLog.timeElapsed,
                performanceData: exLog.performanceData,
                notes: exLog.notes,
              })),
            };
          }
        }
      }

      // Stream the unified chat with tool support
      const chatGenerator = openRouter.unifiedChatStream(
        chatHistory,
        {
          currentPlan: currentPlan || undefined,
          userName: context?.userName,
          bodyweight: context?.bodyweight,
          adjustmentId: adjustmentId || undefined,
          workoutLogData: workoutLogData || undefined,
        }
      );

      for await (const chunk of chatGenerator) {
        if (chunk.type === 'text') {
          fullResponse += chunk.content;
          await sendEvent({ type: 'text-chunk', content: chunk.content });
        } else if (chunk.type === 'tool_call') {
          // Parse tool call arguments
          try {
            const args = JSON.parse(chunk.toolCall.arguments);
            toolCalls.push({
              id: chunk.toolCall.id,
              name: chunk.toolCall.name,
              arguments: args,
            });
            
            // Send tool-call event
            await sendEvent({
              type: 'tool-call',
              toolCall: {
                id: chunk.toolCall.id,
                name: chunk.toolCall.name,
                arguments: args,
              },
            });
          } catch (e) {
            console.error('Failed to parse tool call arguments:', e);
          }
        }
      }

      await sendEvent({ type: 'text-done' });

      // Execute tool calls and send results
      let metadata: Record<string, unknown> | undefined = undefined;

      for (const toolCall of toolCalls) {
        try {
          if (toolCall.name === 'create_workout_plan') {
            // Handle plan creation/editing
            const args = toolCall.arguments as {
              goal: string;
              weeksDuration?: number;
              sessionsPerWeek?: number;
              schedule: Array<{
                dayNumber: number;
                dayName: string;
                workoutType: string;
                workoutColor: string;
                exercises: WorkoutDayData['exercises'];
              }>;
              isEdit?: boolean;
            };

            // Create plan data structure
            const planData = {
              goal: args.goal,
              weeksDuration: args.weeksDuration || 12,
              sessionsPerWeek: args.sessionsPerWeek || args.schedule.length,
              schedule: args.schedule,
            };

            metadata = {
              type: 'plan_preview',
              planData,
            };

            // Send tool result
            await sendEvent({
              type: 'tool-result',
              toolResult: {
                toolCallId: toolCall.id,
                result: { success: true, planData },
              },
            });
          } else if (toolCall.name === 'analyze_workout') {
            // Handle workout analysis
            const args = toolCall.arguments as {
              adjustmentId: string;
              summary: string;
              exercises: Array<{
                name: string;
                exerciseType?: string;
                currentWeight: number;
                currentSets: number;
                currentReps: number;
                currentRepsPerSet?: number[];
                currentWeightsUsed?: number[];
                currentDistanceUnit?: string;
                currentRestTime?: number;
                currentIntervalStructure?: string;
                nextWeight: number;
                nextSets: number;
                nextReps: number;
                nextDistanceUnit?: string;
                nextRestTime?: number;
                nextIntervalStructure?: string;
                nextProgression?: string;
                reasoning: string;
              }>;
            };

            // Log the raw arguments for debugging
            console.log('analyze_workout tool call arguments:', JSON.stringify(args, null, 2));

            // Validate adjustmentId format (should be a CUID, not a long string with text)
            const adjId = args.adjustmentId?.trim();
            if (!adjId || adjId.length > 30 || adjId.includes(' ')) {
              console.error('Invalid adjustmentId format:', adjId);
              throw new Error(`Invalid adjustmentId format. Expected a short ID string, got: "${adjId?.substring(0, 50)}...". Please use the exact adjustmentId from the system context.`);
            }

            // Verify pending adjustment exists
            const pendingAdj = await prisma.pendingAdjustment.findUnique({
              where: { id: adjId },
            });

            if (!pendingAdj) {
              throw new Error(`Pending adjustment ${adjId} not found. Cannot analyze workout without an adjustment record.`);
            }

            // Update pending adjustment with suggestions
            await prisma.pendingAdjustment.update({
              where: { id: adjId },
              data: {
                suggestions: args.exercises,
              },
            });

            metadata = {
              type: 'adjustment_preview',
              adjustmentId: adjId,
              adjustmentData: {
                summary: args.summary,
                exercises: args.exercises,
              },
            };
            
            // Store adjustmentId for future messages in this session
            adjustmentId = adjId;

            // Send tool result with adjustmentId
            await sendEvent({
              type: 'tool-result',
              toolResult: {
                toolCallId: toolCall.id,
                result: { 
                  success: true, 
                  adjustmentData: metadata.adjustmentData,
                  adjustmentId: adjId,
                },
              },
            });
          }
        } catch (error) {
          console.error(`Tool execution error (${toolCall.name}):`, error);
          await sendEvent({
            type: 'error',
            error: `Failed to execute ${toolCall.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
        }
      }

      await sendEvent({ type: 'done' });

      // Save assistant message
      // If we have an adjustmentId and no specific metadata, include it
      const messageMetadata = metadata || (adjustmentId ? { adjustmentId } : undefined);
      
      await prisma.chatMessage.create({
        data: {
          sessionId,
          userId,
          planId: planId || undefined,
          role: 'assistant',
          content: fullResponse,
          metadata: messageMetadata as any,
        },
      });

      // Update session after assistant response
      const updatedSession = await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      // Set title based on first message if no title exists
      if (!updatedSession.title) {
        const messageCount = await prisma.chatMessage.count({
          where: { sessionId },
        });

        if (messageCount >= 2) {
          let title = 'General Chat';

          // Determine title based on tool calls or content
          if (toolCalls.some(tc => tc.name === 'create_workout_plan')) {
            title = 'Create Workout Plan';
          } else if (toolCalls.some(tc => tc.name === 'analyze_workout')) {
            title = 'Workout Analysis';
          }

          await prisma.chatSession.update({
            where: { id: sessionId },
            data: { title },
          });
        }
      }
    } catch (error) {
      console.error('Streaming chat error:', error);
      await sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Failed to process message',
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
