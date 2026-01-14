import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import {
  getOpenRouterClient,
  extractJSON,
  workoutPlanSchema,
  type ChatMessage,
  type SSEEvent,
  type WorkoutDayData,
} from '@/app/lib/openrouter';
import { buildExerciseData, findNextWorkout } from '@/app/lib/progressive';

// Set timeout to 5 minutes for streaming AI responses
export const maxDuration = 300;

// Helper to encode SSE events
function encodeSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Schema for plan structure (without exercises - those come day by day)
const planStructureSchema = workoutPlanSchema.pick({
  goal: true,
  weeksDuration: true,
  sessionsPerWeek: true,
}).extend({
  schedule: workoutPlanSchema.shape.schedule.element.pick({
    dayNumber: true,
    dayName: true,
    workoutType: true,
    workoutColor: true,
  }).array(),
});

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
      const { sessionId, message, mode, planId, context } = body;

      // Verify session belongs to user
      const chatSession = await prisma.chatSession.findUnique({
        where: { id: sessionId, userId },
      });

      if (!chatSession) {
        await sendEvent({ type: 'error', error: 'Session not found or unauthorized' });
        await writer.close();
        return;
      }

      // Save user message
      await prisma.chatMessage.create({
        data: {
          sessionId,
          userId,
          planId: planId || null,
          role: 'user',
          content: message,
          metadata: { mode },
        },
      });

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
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      // Get OpenRouter client
      const openRouter = getOpenRouterClient();
      let fullResponse = '';
      let metadata: Prisma.InputJsonValue | undefined = undefined;

      // Get current plan for context (for both create and edit modes)
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

      // Handle different modes
      switch (mode) {
        case 'create':
        case 'edit':
          // Stream the initial conversational response
          const planGenerator = openRouter.generatePlanStream(chatHistory, {
            bodyweight: context?.bodyweight,
            experienceLevel: context?.experienceLevel,
            currentPlan: currentPlan || undefined,
          });

          for await (const chunk of planGenerator) {
            fullResponse += chunk;
            await sendEvent({ type: 'text-chunk', content: chunk });
          }

          await sendEvent({ type: 'text-done' });

          // Try to extract plan structure from response
          const planData = extractJSON(fullResponse);
          
          if (planData) {
            const validated = workoutPlanSchema.safeParse(planData);
            
            if (validated.success) {
              // Set start date to today (start of day)
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              
              // Create draft plan in database
              const newPlan = await prisma.workoutPlan.create({
                data: {
                  userId,
                  goal: validated.data.goal,
                  status: 'draft',
                  weeksDuration: validated.data.weeksDuration,
                  startDate: today,
                  aiContext: {
                    sessionsPerWeek: validated.data.sessionsPerWeek,
                  },
                },
              });

              // Find the start of the current week (Sunday)
              const dayOfWeek = today.getDay();
              const startOfWeek = new Date(today);
              startOfWeek.setDate(today.getDate() - dayOfWeek);

              // Send each day progressively
              const totalDays = validated.data.schedule.length;
              const weeksDuration = validated.data.weeksDuration || 12;
              let dayCount = 0;
              const totalDaysToGenerate = weeksDuration * totalDays;

              // Generate all weeks of workout days
              for (let week = 1; week <= weeksDuration; week++) {
                for (const dayData of validated.data.schedule) {
                  dayCount++;
                  
                  // Calculate scheduled date
                  const scheduledDate = new Date(startOfWeek);
                  scheduledDate.setDate(startOfWeek.getDate() + (week - 1) * 7 + dayData.dayNumber);
                  
                  // Only generate exercises for first 2 weeks
                  const shouldGenerateExercises = week <= 2;
                  
                  const day = await prisma.workoutDay.create({
                    data: {
                      planId: newPlan.id,
                      dayNumber: dayData.dayNumber,
                      dayName: dayData.dayName,
                      scheduledDate: scheduledDate,
                      workoutType: dayData.workoutType,
                      workoutColor: dayData.workoutColor,
                      isGenerated: shouldGenerateExercises,
                    },
                  });

                  // Create exercises for first 2 weeks
                  if (shouldGenerateExercises && dayData.exercises) {
                    for (let i = 0; i < dayData.exercises.length; i++) {
                      const exerciseData = dayData.exercises[i];
                      await prisma.exercise.create({
                        data: {
                          dayId: day.id,
                          name: exerciseData.name,
                          sets: exerciseData.sets,
                          reps: exerciseData.reps,
                          weightType: exerciseData.weightType,
                          weightValue: exerciseData.weightValue,
                          restTime: exerciseData.restTime || 90,
                          exerciseType: exerciseData.exerciseType || 'strength',
                          progression: exerciseData.progression || undefined,
                          movementDetails: exerciseData.movementDetails || undefined,
                          order: i,
                          distance: exerciseData.distance || undefined,
                          distanceUnit: exerciseData.distanceUnit || undefined,
                          intervals: exerciseData.intervals || undefined,
                          tempo: exerciseData.tempo || undefined,
                          timeCap: exerciseData.timeCap || undefined,
                        },
                      });
                    }
                  }

                  // Send day-generated event for first week only (to show progress)
                  if (week === 1) {
                    const dayDataForEvent: WorkoutDayData = {
                      dayNumber: dayData.dayNumber,
                      dayName: dayData.dayName,
                      workoutType: dayData.workoutType,
                      workoutColor: dayData.workoutColor,
                      exercises: dayData.exercises || [],
                    };

                    await sendEvent({
                      type: 'day-generated',
                      day: dayDataForEvent,
                      progress: {
                        current: dayCount,
                        total: totalDaysToGenerate,
                        label: `${dayData.dayName} (Week ${week})`,
                      },
                    });
                  }
                }
              }

              metadata = {
                type: 'plan_preview',
                planId: newPlan.id,
                planData: validated.data as Prisma.InputJsonValue,
              };

              await sendEvent({
                type: 'done',
                planId: newPlan.id,
              });
            } else {
              // Validation failed - still send done but without planId
              console.error('Plan validation failed:', validated.error);
              await sendEvent({ type: 'done' });
            }
          } else {
            // No plan data extracted - just a conversation message
            await sendEvent({ type: 'done' });
          }
          break;

        case 'post_workout':
          // Handle post-workout analysis with streaming
          const { adjustmentId } = context || {};
          
          if (!adjustmentId) {
            fullResponse = "I couldn't find the workout data to analyze. Please try completing a workout first.";
            await sendEvent({ type: 'text-chunk', content: fullResponse });
            await sendEvent({ type: 'text-done' });
            await sendEvent({ type: 'done' });
            break;
          }

          // Fetch the pending adjustment with workout data
          const pendingAdjustment = await prisma.pendingAdjustment.findUnique({
            where: { id: adjustmentId },
          });

          if (!pendingAdjustment || pendingAdjustment.userId !== userId) {
            fullResponse = "I couldn't find your workout data. Please try again.";
            await sendEvent({ type: 'text-chunk', content: fullResponse });
            await sendEvent({ type: 'text-done' });
            await sendEvent({ type: 'done' });
            break;
          }

          // Get the workout log details
          const workoutLog = await prisma.workoutLog.findUnique({
            where: { id: pendingAdjustment.workoutLogId },
            include: {
              day: true,
            },
          });

          if (!workoutLog) {
            fullResponse = "Workout data not found. Please try again.";
            await sendEvent({ type: 'text-chunk', content: fullResponse });
            await sendEvent({ type: 'text-done' });
            await sendEvent({ type: 'done' });
            break;
          }

          // Build exercise data with performance history
          const exerciseData = await buildExerciseData(
            workoutLog.id,
            workoutLog.planId,
            workoutLog.day.workoutType,
            workoutLog.workoutDate
          );

          // Find the next workout of this type
          const nextWorkout = await findNextWorkout(
            workoutLog.planId,
            workoutLog.day.workoutType,
            new Date()
          );

          // Stream the post-workout analysis
          const analysisGenerator = openRouter.analyzePostWorkoutStream({
            workoutType: workoutLog.day.workoutType,
            completedDate: workoutLog.workoutDate,
            nextDate: nextWorkout?.scheduledDate || null,
            feedback: workoutLog.feedback as { rating: number; notes?: string } | undefined,
            exercises: exerciseData,
          });

          for await (const chunk of analysisGenerator) {
            fullResponse += chunk;
            await sendEvent({ type: 'text-chunk', content: chunk });
          }

          await sendEvent({ type: 'text-done' });

          // Try to extract JSON suggestions from AI response
          const suggestionData = extractJSON<{
            summary: string;
            exercises: Array<{
              name: string;
              nextSets: number;
              nextReps: number;
              nextWeight: number;
              reasoning: string;
            }>;
          }>(fullResponse);

          if (suggestionData && suggestionData.exercises) {
            // Store the suggestions in the pending adjustment
            const formattedSuggestions = suggestionData.exercises.map((ex) => {
              const original = exerciseData.find(
                (e) => e.name.toLowerCase() === ex.name.toLowerCase()
              );
              return {
                name: ex.name,
                currentWeight: original?.weightValue || 0,
                currentSets: original?.sets || 0,
                currentReps: original?.reps || 0,
                nextWeight: ex.nextWeight,
                nextSets: ex.nextSets,
                nextReps: ex.nextReps,
                reasoning: ex.reasoning,
              };
            });

            await prisma.pendingAdjustment.update({
              where: { id: adjustmentId },
              data: {
                suggestions: formattedSuggestions,
              },
            });

            // Send adjustment events for each exercise
            for (let i = 0; i < formattedSuggestions.length; i++) {
              await sendEvent({
                type: 'adjustment-generated',
                adjustment: formattedSuggestions[i],
                progress: {
                  current: i + 1,
                  total: formattedSuggestions.length,
                  label: formattedSuggestions[i].name,
                },
              });
            }

            metadata = {
              type: 'adjustment_preview',
              adjustmentId: adjustmentId,
              adjustmentData: {
                summary: suggestionData.summary,
                exercises: formattedSuggestions,
              },
            };
          }

          await sendEvent({ type: 'done' });
          break;

        default:
          // General chat - stream the response
          const generalGenerator = openRouter.generalChatStream(chatHistory);

          for await (const chunk of generalGenerator) {
            fullResponse += chunk;
            await sendEvent({ type: 'text-chunk', content: chunk });
          }

          await sendEvent({ type: 'text-done' });
          await sendEvent({ type: 'done' });
      }

      // Save assistant message
      const metadataObj = metadata as { planId?: string } | undefined;
      await prisma.chatMessage.create({
        data: {
          sessionId,
          userId,
          planId: planId || metadataObj?.planId || undefined,
          role: 'assistant',
          content: fullResponse,
          metadata: metadata,
        },
      });

      // Update session after assistant response
      const updatedSession = await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      // Set title based on mode if this is the first message and no title exists
      if (!updatedSession.title) {
        const messageCount = await prisma.chatMessage.count({
          where: { sessionId },
        });
        
        if (messageCount >= 2) {
          let title = 'General Chat';
          
          if (mode === 'create' || mode === 'edit') {
            title = 'Create Workout Plan';
          } else if (mode === 'general') {
            title = 'Fitness Question';
          } else if (mode === 'post_workout') {
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
