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

      // Save user message (only if message is not empty)
      if (message && message.trim()) {
        await prisma.chatMessage.create({
          data: {
            sessionId,
            userId,
            planId: planId || null,
            role: 'user',
            content: message,
            metadata: { mode, adjustmentId: context?.adjustmentId },
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
          // Step 1: Stream the plan STRUCTURE (no exercises)
          const structureGenerator = openRouter.generatePlanStructureStream(chatHistory, {
            bodyweight: context?.bodyweight,
            experienceLevel: context?.experienceLevel,
            currentPlan: currentPlan || undefined,
          });

          // Stream text but filter out JSON - only send conversational text
          let inJsonBlock = false;
          let jsonDepth = 0;
          let textBuffer = '';
          
          for await (const chunk of structureGenerator) {
            fullResponse += chunk;
            
            // Process chunk character by character to detect JSON
            for (const char of chunk) {
              if (char === '`' && textBuffer.endsWith('``')) {
                // Detected start of code block
                inJsonBlock = true;
                textBuffer = textBuffer.slice(0, -2); // Remove the backticks from buffer
                // Send any buffered text before the JSON
                if (textBuffer.trim()) {
                  await sendEvent({ type: 'text-chunk', content: textBuffer });
                }
                textBuffer = '';
                continue;
              }
              
              if (inJsonBlock) {
                // Look for end of code block
                if (char === '`' && textBuffer.endsWith('``')) {
                  inJsonBlock = false;
                  textBuffer = '';
                }
                continue;
              }
              
              // Also detect raw JSON objects (starting with {)
              if (char === '{' && !inJsonBlock) {
                jsonDepth++;
                if (jsonDepth === 1 && textBuffer.trim()) {
                  // Send buffered text before JSON starts
                  await sendEvent({ type: 'text-chunk', content: textBuffer });
                  textBuffer = '';
                }
                continue;
              }
              
              if (jsonDepth > 0) {
                if (char === '{') jsonDepth++;
                if (char === '}') jsonDepth--;
                continue;
              }
              
              textBuffer += char;
            }
            
            // Send buffered text if we have enough
            if (textBuffer.length > 50 && !inJsonBlock && jsonDepth === 0) {
              await sendEvent({ type: 'text-chunk', content: textBuffer });
              textBuffer = '';
            }
          }
          
          // Send any remaining text
          if (textBuffer.trim() && !inJsonBlock && jsonDepth === 0) {
            await sendEvent({ type: 'text-chunk', content: textBuffer });
          }

          await sendEvent({ type: 'text-done' });

          // Step 2: Extract plan structure (without exercises)
          const structureData = extractJSON<{
            goal: string;
            weeksDuration?: number;
            sessionsPerWeek?: number;
            schedule: Array<{
              dayNumber: number;
              dayName: string;
              workoutType: string;
              workoutColor: string;
            }>;
          }>(fullResponse);
          
          if (structureData && structureData.schedule) {
            // Set start date to today (as local date, no timezone issues)
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            const weeksDuration = structureData.weeksDuration || 12;
            const sessionsPerWeek = structureData.sessionsPerWeek || structureData.schedule.filter(d => d.workoutType !== 'Rest').length;
            
            // Don't create plan in database yet - just generate the structure
            const planData = {
              goal: structureData.goal,
              weeksDuration: weeksDuration,
              sessionsPerWeek: sessionsPerWeek,
              startDate: today.toISOString(),
            };

            // Find the start of the current week (Sunday)
            const dayOfWeek = today.getDay();
            const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek);

            // Helper to parse reps/sets - handles "6-8" range format
            // Returns { value: max, min: min or null }
            const parseRange = (val: number | string): { value: number; min: number | null } => {
              if (typeof val === 'number') return { value: Math.round(val), min: null };
              const str = String(val);
              // Handle range like "6-8"
              if (str.includes('-')) {
                const parts = str.split('-').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
                if (parts.length >= 2) {
                  return { value: Math.max(...parts), min: Math.min(...parts) };
                }
              }
              const parsed = parseInt(str, 10);
              return { value: isNaN(parsed) ? 8 : parsed, min: null };
            };

            // Step 3: Generate exercises for each day one by one (first week only shown)
            // Filter out any rest days the AI might have included (we don't store them)
            // Keep "(no changes)" and "(copy from draft)" entries - they indicate days to preserve
            const workoutDays = structureData.schedule.filter(d => d.workoutType !== 'Rest');
            const totalWorkoutDays = workoutDays.length;
            const generatedDays: WorkoutDayData[] = [];
            const previousDaysSummary: Array<{ dayName: string; workoutType: string; exerciseNames: string[] }> = [];

            // If editing existing plan, map existing exercises to days (from database)
            const existingDaysMap = new Map<number, WorkoutDayData>();
            if (currentPlan && mode === 'edit') {
              for (const workoutDay of currentPlan.workoutDays) {
                const exercises = workoutDay.exercises.map((ex: any) => ({
                  name: ex.name,
                  sets: ex.sets,
                  setsMin: ex.setsMin,
                  reps: ex.reps,
                  repsMin: ex.repsMin,
                  weightType: ex.weightType,
                  weightValue: ex.weightValue,
                  restTime: ex.restTime,
                  exerciseType: ex.exerciseType,
                  progression: ex.progression,
                  movementDetails: ex.movementDetails,
                  duration: ex.duration,
                  distance: ex.distance,
                  distanceUnit: ex.distanceUnit,
                  intervals: ex.intervals,
                  tempo: ex.tempo,
                  timeCap: ex.timeCap,
                  movements: ex.movements,
                }));
                
                existingDaysMap.set(workoutDay.dayNumber, {
                  dayNumber: workoutDay.dayNumber,
                  dayName: workoutDay.dayName,
                  workoutType: workoutDay.workoutType,
                  workoutColor: workoutDay.workoutColor,
                  exercises: exercises,
                });
              }
            }

            // Get last generated plan from chat history (for "(copy from draft)")
            const lastDraftDaysMap = new Map<number, WorkoutDayData>();
            let lastDraftPlan = null;
            const lastAssistantMessage = recentMessages
              .filter(m => m.role === 'assistant' && m.metadata && typeof m.metadata === 'object')
              .reverse()
              .find(m => {
                const meta = m.metadata as any;
                return meta?.type === 'plan_preview' && meta?.planData?.schedule;
              });
            
            if (lastAssistantMessage?.metadata) {
              const lastPlanData = (lastAssistantMessage.metadata as any).planData;
              if (lastPlanData?.schedule) {
                lastDraftPlan = lastPlanData; // Store entire plan for context
                for (const day of lastPlanData.schedule) {
                  lastDraftDaysMap.set(day.dayNumber, day);
                }
              }
            }

            // Generate first week's exercises day by day
            for (let i = 0; i < workoutDays.length; i++) {
              const dayStructure = workoutDays[i];

              // Check if this day should use existing data
              let dayWithExercises: WorkoutDayData | null = null;
              let sourceDescription = '';
              
              if (dayStructure.workoutType === '(no changes)') {
                // Copy from database plan
                const existingDay = existingDaysMap.get(dayStructure.dayNumber);
                if (existingDay) {
                  dayWithExercises = existingDay;
                  sourceDescription = 'database plan';
                } else {
                  console.warn(`Day marked as "(no changes)" but no existing data found for day ${dayStructure.dayNumber}`);
                }
              } else if (dayStructure.workoutType === '(copy from draft)') {
                // Copy from last generated plan in this chat
                const lastDraftDay = lastDraftDaysMap.get(dayStructure.dayNumber);
                if (lastDraftDay) {
                  dayWithExercises = lastDraftDay;
                  sourceDescription = 'last draft';
                } else {
                  console.warn(`Day marked as "(copy from draft)" but no previous draft found for day ${dayStructure.dayNumber}`);
                }
              } else if (currentPlan && mode === 'edit' && existingDaysMap.has(dayStructure.dayNumber)) {
                // Implicit preservation - day exists in current plan and wasn't explicitly marked
                const existingDay = existingDaysMap.get(dayStructure.dayNumber);
                if (existingDay) {
                  // Update type/color if specified, keep exercises
                  dayWithExercises = {
                    ...existingDay,
                    workoutType: dayStructure.workoutType,
                    workoutColor: dayStructure.workoutColor,
                  };
                  sourceDescription = 'implicit preservation (updated type/color)';
                }
              }
              
              if (!dayWithExercises) {
                // Generate exercises for this day using AI (new day or create mode)
                dayWithExercises = await openRouter.generateDay(
                  {
                    goal: structureData.goal,
                    weeksDuration: weeksDuration,
                    sessionsPerWeek: sessionsPerWeek,
                    bodyweight: context?.bodyweight,
                    experienceLevel: context?.experienceLevel,
                  },
                  {
                    dayNumber: dayStructure.dayNumber,
                    dayName: dayStructure.dayName,
                    workoutType: dayStructure.workoutType,
                    workoutColor: dayStructure.workoutColor,
                  },
                  previousDaysSummary,
                  {
                    chatHistory: chatHistory,
                    fullGeneratedDays: generatedDays,
                    currentPlan: currentPlan, // Pass active plan for "(no changes)"
                    lastDraftPlan: lastDraftPlan, // Pass last draft for "(copy from draft)"
                  }
                );
                sourceDescription = 'generated';
              }
              
              if (sourceDescription) {
                console.log(`Day ${dayStructure.dayNumber} (${dayStructure.dayName}): ${sourceDescription}`);
              }

              if (dayWithExercises) {
                // Track for next day's context
                previousDaysSummary.push({
                  dayName: dayStructure.dayName,
                  workoutType: dayStructure.workoutType,
                  exerciseNames: dayWithExercises.exercises.map(e => e.name),
                });

                // Sanitize exercises for display (parse ranges properly)
                const sanitizedDay: WorkoutDayData = {
                  ...dayWithExercises,
                  exercises: dayWithExercises.exercises.map(ex => {
                    const setsRange = parseRange(ex.sets);
                    const repsRange = parseRange(ex.reps);
                    return {
                      ...ex,
                      sets: setsRange.value,
                      setsMin: setsRange.min || undefined,
                      reps: repsRange.value,
                      repsMin: repsRange.min || undefined,
                      weightValue: typeof ex.weightValue === 'number' ? ex.weightValue : parseFloat(String(ex.weightValue)) || 0,
                    };
                  }),
                };

                generatedDays.push(sanitizedDay);

                // Determine next day for progress indicator
                const nextDayIndex = i + 1;
                const nextDay = nextDayIndex < workoutDays.length 
                  ? workoutDays[nextDayIndex] 
                  : null;

                // Send day-generated event
                await sendEvent({
                  type: 'day-generated',
                  day: sanitizedDay,
                  progress: nextDay ? {
                    current: i + 1,
                    total: totalWorkoutDays,
                    label: nextDay.dayName,
                  } : undefined, // No progress indicator on last day
                });
              }
            }

            // Build final plan data with exercises (full JSON saved in message)
            const finalPlanData = {
              ...planData,
              schedule: generatedDays,
            };

            metadata = {
              type: 'plan_preview',
              planData: finalPlanData as unknown as Prisma.InputJsonValue,
            };

            await sendEvent({
              type: 'done',
            });
          } else {
            // No plan structure extracted - just a conversation message (maybe asking questions)
            await sendEvent({ type: 'done' });
          }
          break;

        case 'post_workout':
          // Handle post-workout analysis with streaming
          let { adjustmentId } = context || {};
          
          // If adjustmentId not in context, try to retrieve it from previous messages in this session
          if (!adjustmentId) {
            const previousMessage = await prisma.chatMessage.findFirst({
              where: { 
                sessionId,
                metadata: {
                  path: ['adjustmentId'],
                  not: null,
                },
              },
              orderBy: { createdAt: 'desc' },
            });
            
            if (previousMessage?.metadata && typeof previousMessage.metadata === 'object') {
              const metadata = previousMessage.metadata as { adjustmentId?: string };
              adjustmentId = metadata.adjustmentId;
            }
          }
          
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

          // Get user's bodyweight for weight calculations
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { bodyweight: true },
          });

          // Build exercise data with performance history (converts percentages to absolute pounds)
          const exerciseData = await buildExerciseData(
            workoutLog.id,
            workoutLog.planId,
            workoutLog.day.workoutType,
            workoutLog.workoutDate,
            user?.bodyweight || undefined
          );

          // Find the next workout of this type (after the completed workout's date)
          const nextWorkout = await findNextWorkout(
            workoutLog.planId,
            workoutLog.day.workoutType,
            workoutLog.workoutDate
          );

          // Stream the post-workout analysis with chat history for conversational context
          const analysisGenerator = openRouter.analyzePostWorkoutStream({
            workoutType: workoutLog.day.workoutType,
            completedDate: workoutLog.workoutDate,
            nextDate: nextWorkout?.scheduledDate || null,
            feedback: workoutLog.feedback as { rating: number; notes?: string } | undefined,
            exercises: exerciseData,
          }, chatHistory);

          // Stream the analysis text to show the AI's reasoning to the user
          // This allows for conversational back-and-forth
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
              nextDuration?: number;  // For time-based exercises (in minutes)
              nextDistance?: number;  // For distance exercises
              nextTimeCap?: number;   // For EMOM/AMRAP/Tabata (in seconds)
              nextIntervals?: {       // For interval exercises
                type: string;
                rounds: number;
                phases: Array<{
                  name: string;
                  duration: number;
                  intensity?: string;
                }>;
              };
              reasoning: string;
            }>;
          }>(fullResponse);

          if (suggestionData && suggestionData.exercises) {
            // Format suggestions in the same order as the original exercises
            const formattedSuggestions = exerciseData.map((original) => {
              // Find the matching suggestion from AI with flexible matching
              // Try exact match first, then fuzzy match (handles names with/without parenthetical notes)
              const suggestion = suggestionData.exercises.find(
                (ex) => {
                  const aiName = ex.name.toLowerCase().trim();
                  const dbName = original.name.toLowerCase().trim();
                  
                  // Exact match
                  if (aiName === dbName) return true;
                  
                  // Remove parenthetical notes and compare base names
                  const aiBaseName = aiName.split('(')[0].trim();
                  const dbBaseName = dbName.split('(')[0].trim();
                  
                  // Base name match
                  if (aiBaseName === dbBaseName) return true;
                  
                  // Check if one name contains the other
                  return aiName.includes(dbBaseName) || dbName.includes(aiBaseName);
                }
              );
              
              // Calculate average reps performed
              const avgRepsPerformed = original.performed.repsPerSet.length > 0
                ? Math.round(original.performed.repsPerSet.reduce((a, b) => a + b, 0) / original.performed.repsPerSet.length)
                : original.reps;
              
              // Get the detailed reps per set for display
              const repsDetail = original.performed.repsPerSet;
              
              if (!suggestion) {
                // If AI didn't provide a suggestion for this exercise, use current values
                console.warn(`No AI suggestion found for exercise: "${original.name}". Available AI suggestions:`, suggestionData.exercises.map(e => e.name));
                return {
                  name: original.name,
                  exerciseType: original.exerciseType,
                  currentWeight: original.weightValue,
                  currentWeightType: original.weightType,
                  currentSets: original.sets,
                  currentReps: original.reps,
                  currentDuration: original.duration,
                  currentDistance: original.distance,
                  currentDistanceUnit: original.distanceUnit,
                  currentTimeCap: original.timeCap,
                  currentIntervals: original.intervals,
                  performedSets: original.performed.setsCompleted,
                  performedReps: avgRepsPerformed,
                  performedRepsDetail: repsDetail,
                  performedWeightsDetail: original.performed.weightsPerSet,
                  performedWeight: Math.max(...original.performed.weightsPerSet), // Show max weight
                  performedDuration: original.performed.duration,
                  performedDistance: original.performed.distance,
                  nextWeight: original.weightValue,
                  nextWeightType: original.weightType,
                  nextSets: original.sets,
                  nextReps: original.reps,
                  nextDuration: original.duration,
                  nextDistance: original.distance,
                  nextTimeCap: original.timeCap,
                  nextIntervals: original.intervals,
                  reasoning: 'Maintain current prescription',
                };
              }
              
              // Log successful match and weight change
              console.log(`Matched AI suggestion for "${original.name}": ${original.weightValue} lbs → ${suggestion.nextWeight} lbs`);
              
              return {
                name: original.name, // Use original name for consistency
                exerciseType: original.exerciseType,
                currentWeight: original.weightValue,
                currentWeightType: original.weightType,
                currentSets: original.sets,
                currentReps: original.reps,
                currentDuration: original.duration,
                currentDistance: original.distance,
                currentDistanceUnit: original.distanceUnit,
                currentTimeCap: original.timeCap,
                currentIntervals: original.intervals,
                performedSets: original.performed.setsCompleted,
                performedReps: avgRepsPerformed,
                performedRepsDetail: repsDetail,
                performedWeightsDetail: original.performed.weightsPerSet,
                performedWeight: Math.max(...original.performed.weightsPerSet), // Show max weight
                performedDuration: original.performed.duration,
                performedDistance: original.performed.distance,
                nextWeight: suggestion.nextWeight,
                nextWeightType: 'ABSOLUTE', // AI suggestions are always in absolute pounds
                nextSets: suggestion.nextSets,
                nextReps: suggestion.nextReps,
                nextDuration: suggestion.nextDuration,
                nextDistance: suggestion.nextDistance,
                nextTimeCap: suggestion.nextTimeCap,
                nextIntervals: suggestion.nextIntervals,
                reasoning: suggestion.reasoning,
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
