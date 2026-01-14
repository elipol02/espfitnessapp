import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { validateSession } from '@/app/lib/auth';
import { prisma } from '@/app/lib/db';
import { getOpenRouterClient, extractJSON, workoutPlanSchema, type ChatMessage } from '@/app/lib/openrouter';
import { buildExerciseData, findNextWorkout } from '@/app/lib/progressive';

// Set timeout to 5 minutes for AI responses
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { sessionId, message, mode, planId, context } = body;

    // Verify session belongs to user
    const chatSession = await prisma.chatSession.findUnique({
      where: { id: sessionId, userId },
    });

    if (!chatSession) {
      return NextResponse.json({ success: false, error: 'Session not found or unauthorized' }, { status: 404 });
    }

    // Save user message
    const userMessage = await prisma.chatMessage.create({
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
    let aiResponse: string;
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
        aiResponse = await openRouter.generatePlan(chatHistory, {
          bodyweight: context?.bodyweight,
          experienceLevel: context?.experienceLevel,
          currentPlan: currentPlan || undefined,
        });

        // Try to extract plan JSON from response
        console.log('=== AI Response ===');
        console.log(aiResponse);
        console.log('===================');
        
        const planData = extractJSON(aiResponse);
        console.log('Extracted Plan Data:', planData ? 'Found' : 'NULL');
        
        if (planData) {
          const validated = workoutPlanSchema.safeParse(planData);
          
          if (!validated.success) {
            console.error('Validation FAILED:');
            for (const err of validated.error.issues) {
              console.error(`  - ${err.path.join('.')}: ${err.message}`);
            }
          } else {
            console.log('✅ Validation SUCCESS - Creating plan...');
          }
          
          if (validated.success) {
            // Set start date to today (start of day)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Create draft plan in database with start date
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

            // Find the start of the current week (Sunday) for generating skeleton
            const dayOfWeek = today.getDay();
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - dayOfWeek);

            // Generate all 12 weeks of workout days
            const weeksDuration = validated.data.weeksDuration || 12;
            for (let week = 1; week <= weeksDuration; week++) {
              for (const dayData of validated.data.schedule) {
                // Calculate scheduled date based on week and day
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

                // Only create exercises for first 2 weeks
                if (shouldGenerateExercises) {
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
                        // Complex exercise type fields
                        distance: exerciseData.distance || undefined,
                        distanceUnit: exerciseData.distanceUnit || undefined,
                        intervals: exerciseData.intervals || undefined,
                        tempo: exerciseData.tempo || undefined,
                        timeCap: exerciseData.timeCap || undefined,
                      },
                    });
                  }
                } 
              }
            }

            metadata = {
              type: 'plan_preview',
              planId: newPlan.id,
              planData: validated.data as Prisma.InputJsonValue,
            };

            // Keep the full response including JSON so AI can reference it in future messages
            // The frontend will hide the JSON display using the metadata
          }
        }
        break;

      case 'post_workout':
        // Handle post-workout analysis
        const { adjustmentId } = context || {};
        
        if (!adjustmentId) {
          aiResponse = "I couldn't find the workout data to analyze. Please try completing a workout first.";
          break;
        }

        // Fetch the pending adjustment with workout data
        const pendingAdjustment = await prisma.pendingAdjustment.findUnique({
          where: { id: adjustmentId },
        });

        if (!pendingAdjustment || pendingAdjustment.userId !== userId) {
          aiResponse = "I couldn't find your workout data. Please try again.";
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
          aiResponse = "Workout data not found. Please try again.";
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

        // Call AI to analyze the workout
        aiResponse = await openRouter.analyzePostWorkout({
          workoutType: workoutLog.day.workoutType,
          completedDate: workoutLog.workoutDate,
          nextDate: nextWorkout?.scheduledDate || null,
          feedback: workoutLog.feedback as { rating: number; notes?: string } | undefined,
          exercises: exerciseData,
        });

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
        }>(aiResponse);

        if (suggestionData && suggestionData.exercises) {
          // Store the suggestions in the pending adjustment
          const formattedSuggestions = suggestionData.exercises.map((ex) => {
            // Find the original exercise data to get current values
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

          // Build metadata for the message
          metadata = {
            type: 'adjustment_preview',
            adjustmentId: adjustmentId,
            adjustmentData: {
              summary: suggestionData.summary,
              exercises: formattedSuggestions,
            },
          };

          // Keep the full response including JSON so AI can reference it in future messages
        }
        break;

      default:
        aiResponse = await openRouter.generalChat(chatHistory);
    }

    // Save assistant message
    const metadataObj = metadata as { planId?: string } | undefined;
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId,
        userId,
        planId: planId || metadataObj?.planId || undefined,
        role: 'assistant',
        content: aiResponse,
        metadata: metadata,
      },
    });

    // Update session again after assistant response
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

    return NextResponse.json({
      success: true,
      data: {
        messageId: assistantMessage.id,
        response: aiResponse,
        metadata,
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process message' },
      { status: 500 }
    );
  }
}
