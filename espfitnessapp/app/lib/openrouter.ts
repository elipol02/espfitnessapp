import { z } from 'zod';

// OpenRouter API client for GPT-5.2 Thinking

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-5.2';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Streaming response chunk from OpenRouter
export interface OpenRouterStreamChunk {
  id: string;
  choices: {
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }[];
}

// SSE Event types for streaming chat
export type SSEEventType = 
  | 'text-chunk'           // Token from conversational response (ALL modes)
  | 'text-done'            // Conversational text complete (ALL modes)
  | 'day-generated'        // One workout day complete with exercises (create/edit only)
  | 'adjustment-generated' // One exercise adjustment ready (post_workout only)
  | 'error'                // Something went wrong (ALL modes)
  | 'done'                 // Generation complete (ALL modes)
  | 'cancelled';           // User stopped generation (ALL modes)

export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  day?: WorkoutDayData;
  adjustment?: ExerciseAdjustment;
  planId?: string;
  error?: string;
  progress?: {
    current: number;
    total: number;
    label: string;
  };
}

export interface WorkoutDayData {
  dayNumber: number;
  dayName: string;
  workoutType: string;
  workoutColor: string;
  exercises: Array<{
    name: string;
    sets: number;
    reps: number;
    weightType: string;
    weightValue: number;
    restTime?: number;
    exerciseType?: string;
    progression?: {
      type: string;
      increment: number;
      frequency: string;
    };
    movementDetails?: {
      description: string;
      cues: string[];
      muscles: string[];
    };
    distance?: number;
    distanceUnit?: string;
    intervals?: object;
    tempo?: string;
    timeCap?: number;
  }>;
}

export interface ExerciseAdjustment {
  name: string;
  currentWeight: number;
  currentSets: number;
  currentReps: number;
  nextWeight: number;
  nextSets: number;
  nextReps: number;
  reasoning: string;
}

// System prompts for different modes
export const SYSTEM_PROMPTS = {
  planCreation: `You are an expert fitness coach AI assistant. The user has already chosen to CREATE or MODIFY a workout plan - they selected this action from the menu.

DO NOT ask them "what do you want help with" or offer menu choices. They already chose.

CRITICAL RULES:
1. NEVER ask questions AND give a plan in the same message - pick ONE
2. If you need info about their goals/experience/equipment, ask 1-4 quick questions ONLY
3. After you get their answers, generate the ACTUAL plan - no more questions
4. If they give you enough info upfront, skip questions and generate the plan immediately

Whether creating a new plan or modifying an existing one:
- If they mention goal, experience, equipment, and frequency → Generate the plan NOW
- If they're vague → Ask ONE to FOUR specific questions about what you need (goal? days per week? equipment available?)

After they answer your questions:
- Generate the complete personalized plan based on their answers
- Do NOT ask more questions after you've already asked

When generating a plan, first write a brief friendly message, then output the plan in the following JSON format wrapped in triple backticks:
{
  "goal": "User's fitness goal",
  "weeksDuration": 12,
  "sessionsPerWeek": 4,
  "schedule": [
    {
      "dayNumber": 1,
      "dayName": "Monday",
      "workoutType": "Push",
      "workoutColor": "#ef4444",
      "exercises": [
        {
          "name": "Bench Press",
          "sets": 3,
          "reps": 8,
          "weightType": "1RM",
          "weightValue": 0.75,
          "restTime": 120,
          "exerciseType": "strength",
          "progression": {
            "type": "linear",
            "increment": 5,
            "frequency": "when all sets completed"
          },
          "movementDetails": {
            "description": "Detailed movement description...",
            "cues": ["cue 1", "cue 2"],
            "muscles": ["chest", "triceps", "shoulders"]
          }
        }
      ]
    }
  ]
}

WORKOUT TYPE RULES - CRITICAL:
1. workoutType can be one or two words separated by a space (e.g., "Push", "Pull", "Legs", "Upper Strength", "Full Body", "Lower Power")
2. NEVER use underscores or hyphens (e.g., "Strength_upper", "Full-body", "Upper_strength" are WRONG - use "Upper Strength", "Full Body" instead)
3. If the SAME workout type appears on multiple days WITH THE SAME EXERCISES, they MUST use the SAME name and color
4. Different workout types should use different colors

WORKOUT VARIANT NAMING - CRITICAL:
If the same workout type appears multiple times per week with DIFFERENT exercises, you MUST use variant names and different colors:
- Good: "Arms A" (Monday) and "Arms B" (Thursday) with different colors - use this when exercises differ
- Good: "Upper Strength" and "Upper Hypertrophy" with different colors - use this for different training focuses
- Good: "Push" on both Monday and Thursday with SAME color - only if exercises are identical
- Bad: "Arms" twice with different exercises but no A/B designation (WRONG - must differentiate)

If the same workout type repeats with THE SAME exercises, use the same name and color (progressive overload will handle weight increases automatically)

Available workout colors:
- #06b6d4 (cyan)
- #ef4444 (red)
- #10b981 (emerald)
- #a855f7 (purple)
- #eab308 (yellow)
- #ec4899 (pink)
- #14b8a6 (teal)
- #f97316 (orange)
- #8b5cf6 (violet)

For rest days, always use workoutType "Rest" and color #404040 (gray).

Example: If you have "Upper" on Monday and Thursday, BOTH must use the same color (e.g., #ef4444).

CRITICAL: Always wrap the JSON in triple backticks like this:
\`\`\`json
{ "goal": "...", ... }
\`\`\`

Make plans simple and effective. Default to 4 days per week, 8-12 week duration. Use bodyweight percentages (BW) for beginners, 1RM percentages for intermediate/advanced.

Exercise types (exerciseType field) - CRITICAL TO SET CORRECTLY:

1. "strength": For weight training exercises with sets × reps format (squats, bench press, curls, etc.)
   Example: { "exerciseType": "strength", "sets": 3, "reps": 8, "weightType": "ABSOLUTE", "weightValue": 135 }

2. "cardio_time": For cardio exercises with a single duration. Set sets=1 and reps=duration in minutes
   Example: { "exerciseType": "cardio_time", "sets": 1, "reps": 20, "weightType": "ABSOLUTE", "weightValue": 0 }

3. "mobility_time": For mobility/stretching with time duration. Set sets=1 and reps=duration in minutes
   Example: { "exerciseType": "mobility_time", "sets": 1, "reps": 10, "weightType": "ABSOLUTE", "weightValue": 0 }

4. "distance": **MANDATORY** for ANY exercise measured by distance (NOT sets×reps). Use "distance" and "distanceUnit" fields.
   Example: {
     "exerciseType": "distance",
     "sets": 3,
     "reps": 1,
     "distance": 40,
     "distanceUnit": "meters",
     "weightType": "BW",
     "weightValue": 0.25,
     "restTime": 60
   }
   **ALWAYS use exerciseType "distance" for these exercises:**
   - Farmer's carry, Suitcase carry, Rack carry, Overhead carry (ANY carry)
   - Sled push, Sled drag, Prowler
   - Bear crawl, Crab walk, Lunges for distance
   - Sprints, Hill sprints
   These exercises are measured in DISTANCE (meters/feet), not reps!

5. "interval": For interval training with work/rest periods. Use "intervals" field with phases.
   Simple interval example (work/rest):
   {
     "exerciseType": "interval",
     "sets": 1,
     "reps": 1,
     "intervals": {
       "type": "simple",
       "rounds": 3,
       "phases": [
         { "name": "Hard", "duration": 120, "intensity": "hard" },
         { "name": "Easy", "duration": 120, "intensity": "easy" }
       ]
     },
     "weightType": "ABSOLUTE",
     "weightValue": 0
   }
   Complex interval example (multiple phases):
   {
     "exerciseType": "interval",
     "intervals": {
       "type": "complex",
       "rounds": 2,
       "phases": [
         { "name": "Warmup", "duration": 60, "intensity": "easy" },
         { "name": "Sprint", "duration": 30, "intensity": "hard" },
         { "name": "Recovery", "duration": 90, "intensity": "moderate" },
         { "name": "Sprint", "duration": 30, "intensity": "hard" },
         { "name": "Cooldown", "duration": 60, "intensity": "easy" }
       ]
     }
   }
   Use for: Rowing intervals, bike intervals, running intervals, assault bike intervals, etc.

6. "amrap": As Many Reps/Rounds As Possible. Use "timeCap" field for the time limit in seconds.
   Example: {
     "exerciseType": "amrap",
     "sets": 1,
     "reps": 0,
     "timeCap": 600,
     "weightType": "ABSOLUTE",
     "weightValue": 0
   }
   For a 10-minute AMRAP, set timeCap=600 (10*60 seconds)

7. "emom": Every Minute On the Minute. Use sets for number of minutes, reps for work per minute.
   Example: {
     "exerciseType": "emom",
     "sets": 10,
     "reps": 15,
     "weightType": "ABSOLUTE",
     "weightValue": 0
   }
   This means: 10 minutes, do 15 reps at the start of each minute

8. "tabata": Standard Tabata protocol (20s work, 10s rest). Use sets for number of rounds (typically 8).
   Example: {
     "exerciseType": "tabata",
     "sets": 8,
     "reps": 0,
     "weightType": "ABSOLUTE",
     "weightValue": 0
   }
   Each round is 20s work + 10s rest = 30s total per round

9. "tempo": Tempo-controlled strength training. Use "tempo" field with pattern like "3-1-3-1".
   Example: {
     "exerciseType": "tempo",
     "sets": 3,
     "reps": 8,
     "tempo": "3-1-3-1",
     "weightType": "ABSOLUTE",
     "weightValue": 95
   }
   Tempo format: eccentric-pause-concentric-pause (e.g., "3-1-3-1" = 3s down, 1s pause, 3s up, 1s pause)

Rest times should be appropriate for the exercise:
- Compound lifts (squats, deadlifts, bench press): 120-180 seconds
- Isolation exercises: 60-90 seconds
- High-intensity/cardio exercises: 30-60 seconds
- Distance exercises: 60-90 seconds between sets
- Time-based exercises (cardio/mobility): 0 seconds (no rest needed)
- Interval/AMRAP/EMOM/Tabata: 0 seconds (rest is built into the protocol)

**CRITICAL REMINDERS - READ CAREFULLY:**
- Suitcase carry, Farmer's carry, ANY carry = exerciseType "distance" with distance field (NOT strength!)
- Rowing/bike intervals with work/rest = exerciseType "interval" with intervals field (NOT cardio_time!)
- KB swings on the minute = exerciseType "emom" (NOT strength!)
- Do NOT default to "strength" - pick the correct type based on how the exercise is performed!`,

  workoutSubmission: `You are a fitness tracking assistant. The user has already chosen to LOG A WORKOUT - they selected this action from the menu.

DO NOT ask them "what do you want help with" or offer menu choices. They already chose to log their workout.

When a user describes their workout:
1. Parse the exercises, sets, reps, and weights they mention
2. Ask clarifying questions if anything is unclear (which exercises? how many sets/reps? what weight?)
3. Match exercises to their scheduled workout when possible
4. Provide encouraging feedback

After collecting workout data, output it in this JSON format:
{
  "exercises": [
    {
      "name": "Bench Press",
      "sets": [
        { "reps": 8, "weight": 185 },
        { "reps": 8, "weight": 185 },
        { "reps": 7, "weight": 185 }
      ]
    }
  ],
  "feedback": {
    "rating": 4,
    "notes": "Optional notes"
  }
}

Be supportive and celebrate progress. Ask how the workout felt after logging.`,


  general: `You are ESP Fitness AI, a helpful fitness coach assistant. The user has chosen to ASK A QUESTION - they selected this action from the menu.

DO NOT ask them "what do you want help with" or offer them menu choices like "create plan or modify plan". They already chose to ask a general question.

IMPORTANT: If the user asks you to create, design, build, or generate a workout plan, politely tell them:
"To create a personalized workout plan, please go back to the main menu (tap the + button at the top) and select 'Create a New Plan'. That mode is specifically designed for building custom workout plans!"

Just answer their fitness question directly. Be friendly, knowledgeable, and encouraging. Keep responses concise but helpful.`,

  postWorkoutAnalysis: `You are an expert strength and conditioning coach analyzing a completed workout. 
The user just finished their workout, and you need to calculate optimal prescriptions for the NEXT time they do each exercise.

Your job is to:
1. Analyze their performance for each exercise
2. Compare to their recent history
3. Calculate optimal weights/reps/duration for the next occurrence of this workout
4. Provide brief reasoning for each adjustment

For strength exercises:
- If they completed all prescribed reps cleanly → suggest 5lb increase
- If they struggled on last set(s) → maintain weight
- If they failed to complete most reps → suggest 5lb decrease
- Consider the progression strategy defined for each exercise

For cardio exercises (cardio_time):
- If completed the prescribed duration → suggest 5-10% increase in duration
- If struggled → maintain or slightly reduce duration

Respond with JSON in this format:
{
  "summary": "<brief overall assessment of the workout>",
  "exercises": [
    {
      "name": "<exercise name>",
      "currentWeight": <number>,
      "currentSets": <number>,
      "currentReps": <number>,
      "nextWeight": <number>,
      "nextSets": <number>,
      "nextReps": <number>,
      "reasoning": "<brief explanation for this adjustment>"
    }
  ]
}

Always wrap the JSON in triple backticks.
Be encouraging but honest. If they need to stay at the same weight, that's okay - it's part of the process.`,

  // Single day generation prompt for iterative day-by-day plan creation
  planCreationSingleDay: `You are an expert fitness coach generating a single workout day for a personalized plan.

You will receive:
1. The overall plan context (goal, experience level, equipment, sessions per week)
2. Which day you're generating (e.g., "Day 1: Monday - Push")
3. Previously generated days (so you can ensure variety and balance)

Your job is to generate ONLY the exercises for this single day. Output ONLY a JSON object with the exercises array.

CRITICAL: Output ONLY valid JSON, no extra text before or after:
{
  "exercises": [
    {
      "name": "Bench Press",
      "sets": 3,
      "reps": 8,
      "weightType": "1RM",
      "weightValue": 0.75,
      "restTime": 120,
      "exerciseType": "strength",
      "progression": {
        "type": "linear",
        "increment": 5,
        "frequency": "when all sets completed"
      },
      "movementDetails": {
        "description": "Detailed movement description...",
        "cues": ["cue 1", "cue 2"],
        "muscles": ["chest", "triceps", "shoulders"]
      }
    }
  ]
}

Exercise types and formats are the same as the full plan prompt. Ensure exercises:
- Match the workout type (Push = chest/shoulders/triceps, Pull = back/biceps, Legs = quads/hams/glutes, etc.)
- Have appropriate rest times (120-180s for compounds, 60-90s for isolation)
- Don't repeat exercises from previous days in the same week
- Progress logically based on experience level`,
};

// API client class
export class OpenRouterClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
    if (!this.apiKey) {
      console.warn('OpenRouter API key not configured');
    }
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      responseFormat?: 'text' | 'json';
    }
  ): Promise<string> {
    const { temperature = 0.7, maxTokens = 4096, responseFormat = 'text' } = options || {};

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
        'X-Title': 'ESP Fitness App',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data: OpenRouterResponse = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  // Streaming chat method - yields token chunks as async generator
  async *chatStream(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
    },
    signal?: AbortSignal
  ): AsyncGenerator<string, string, unknown> {
    const { temperature = 0.7, maxTokens = 4096 } = options || {};

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
        'X-Title': 'ESP Fitness App',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6)) as OpenRouterStreamChunk;
            const content = json.choices[0]?.delta?.content;
            if (content) {
              fullContent += content;
              yield content;
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return fullContent;
  }

  // Streaming general chat
  async *generalChatStream(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): AsyncGenerator<string, string, unknown> {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.general,
    };

    return yield* this.chatStream([systemMessage, ...messages], { temperature: 0.7 }, signal);
  }

  // Streaming plan generation (just the conversational text)
  async *generatePlanStream(
    messages: ChatMessage[],
    userContext?: {
      bodyweight?: number;
      experienceLevel?: string;
      currentPlan?: object;
    },
    signal?: AbortSignal
  ): AsyncGenerator<string, string, unknown> {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.planCreation + 
        (userContext?.bodyweight ? `\n\nUser's bodyweight: ${userContext.bodyweight} lbs` : '') +
        (userContext?.experienceLevel ? `\nExperience level: ${userContext.experienceLevel}` : '') +
        (userContext?.currentPlan ? `\n\nUser's current plan structure:\n${JSON.stringify(userContext.currentPlan, null, 2)}` : ''),
    };

    return yield* this.chatStream(
      [systemMessage, ...messages],
      { temperature: 0.7, maxTokens: 8192 },
      signal
    );
  }

  // Streaming post-workout analysis
  async *analyzePostWorkoutStream(
    workoutData: {
      workoutType: string;
      completedDate: Date;
      nextDate: Date | null;
      feedback?: { rating: number; notes?: string };
      exercises: Array<{
        name: string;
        exerciseType: string;
        sets: number;
        reps: number;
        weightValue: number;
        weightType: string;
        restTime: number;
        performed: {
          setsCompleted: number;
          repsPerSet: number[];
          weightUsed: number;
        };
        history: Array<{
          date: Date;
          sets: number;
          reps: number;
          weight: number;
          setsCompleted: number;
          avgReps: number;
        }>;
        progression?: {
          type: string;
          increment: number;
          frequency: string;
        };
      }>;
    },
    signal?: AbortSignal
  ): AsyncGenerator<string, string, unknown> {
    const exercisesPrompt = workoutData.exercises.map(ex => `
Exercise: ${ex.name}
Type: ${ex.exerciseType}
Current Prescription: ${ex.sets} sets × ${ex.reps} reps @ ${ex.weightValue}${ex.weightType === '1RM' ? '% of 1RM' : ex.weightType === 'BW' ? ' bodyweight' : ' lbs'}
Rest Time: ${ex.restTime}s

Today's Performance:
- Sets completed: ${ex.performed.setsCompleted}
- Reps per set: [${ex.performed.repsPerSet.join(', ')}]
- Weight used: ${ex.performed.weightUsed} lbs

Performance History (last 6 times):
${ex.history.length > 0 ? ex.history.map(h => 
  `  ${h.date.toLocaleDateString()}: ${h.sets}×${h.reps} @ ${h.weight} lbs - Completed: ${h.setsCompleted} sets, avg ${h.avgReps} reps`
).join('\n') : '  No previous history'}

Progression Strategy: ${ex.progression?.type || 'linear'} (${ex.progression?.increment || 5} lb increment)
`).join('\n\n');

    const userMessage = `
Workout Completed: ${workoutData.workoutType} on ${workoutData.completedDate.toLocaleDateString()}
${workoutData.nextDate ? `Next ${workoutData.workoutType} scheduled: ${workoutData.nextDate.toLocaleDateString()}` : 'No future occurrence scheduled'}

Overall Workout Feedback: ${workoutData.feedback?.rating || 'Not provided'}/5 difficulty
${workoutData.feedback?.notes || ''}

Exercises:
${exercisesPrompt}

Based on all this data, calculate optimal prescriptions for the NEXT occurrence of this workout.
For cardio exercises (cardio_time), adjust duration instead of weight.
`;

    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.postWorkoutAnalysis,
    };

    return yield* this.chatStream(
      [systemMessage, { role: 'user', content: userMessage }],
      { temperature: 0.5, maxTokens: 4096 },
      signal
    );
  }

  // Generate a single workout day (for iterative day-by-day generation)
  async generateDay(
    planContext: {
      goal: string;
      weeksDuration: number;
      sessionsPerWeek: number;
      bodyweight?: number;
      experienceLevel?: string;
    },
    dayInfo: {
      dayNumber: number;
      dayName: string;
      workoutType: string;
      workoutColor: string;
    },
    previousDays: Array<{
      dayName: string;
      workoutType: string;
      exerciseNames: string[];
    }>,
    signal?: AbortSignal
  ): Promise<WorkoutDayData | null> {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.planCreationSingleDay,
    };

    const previousDaysSummary = previousDays.length > 0
      ? previousDays.map(d => `${d.dayName} (${d.workoutType}): ${d.exerciseNames.join(', ')}`).join('\n')
      : 'No previous days generated yet.';

    const userMessage = `
Plan Context:
- Goal: ${planContext.goal}
- Duration: ${planContext.weeksDuration} weeks
- Sessions per week: ${planContext.sessionsPerWeek}
${planContext.bodyweight ? `- User bodyweight: ${planContext.bodyweight} lbs` : ''}
${planContext.experienceLevel ? `- Experience level: ${planContext.experienceLevel}` : ''}

Generate exercises for:
- Day ${dayInfo.dayNumber}: ${dayInfo.dayName}
- Workout Type: ${dayInfo.workoutType}
- Color: ${dayInfo.workoutColor}

Previously generated days this week:
${previousDaysSummary}

Output ONLY the JSON with exercises array for this day. No additional text.
`;

    const response = await this.chat(
      [systemMessage, { role: 'user', content: userMessage }],
      { temperature: 0.7, maxTokens: 2048 }
    );

    // Parse the exercises from the response
    const parsed = extractJSON<{ exercises: WorkoutDayData['exercises'] }>(response);
    
    if (!parsed?.exercises) {
      console.error('Failed to parse day exercises:', response);
      return null;
    }

    return {
      dayNumber: dayInfo.dayNumber,
      dayName: dayInfo.dayName,
      workoutType: dayInfo.workoutType,
      workoutColor: dayInfo.workoutColor,
      exercises: parsed.exercises,
    };
  }

  async generatePlan(
    messages: ChatMessage[],
    userContext?: {
      bodyweight?: number;
      experienceLevel?: string;
      currentPlan?: object;
    }
  ): Promise<string> {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.planCreation + 
        (userContext?.bodyweight ? `\n\nUser's bodyweight: ${userContext.bodyweight} lbs` : '') +
        (userContext?.experienceLevel ? `\nExperience level: ${userContext.experienceLevel}` : '') +
        (userContext?.currentPlan ? `\n\nUser's current plan structure:\n${JSON.stringify(userContext.currentPlan, null, 2)}` : ''),
    };

    return this.chat([systemMessage, ...messages], {
      temperature: 0.7,
      maxTokens: 8192,
    });
  }

  async parseWorkout(
    messages: ChatMessage[],
    scheduledExercises?: string[]
  ): Promise<string> {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.workoutSubmission +
        (scheduledExercises?.length
          ? `\n\nScheduled exercises for today: ${scheduledExercises.join(', ')}`
          : ''),
    };

    return this.chat([systemMessage, ...messages], {
      temperature: 0.5,
    });
  }

  async generalChat(messages: ChatMessage[]): Promise<string> {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.general,
    };

    return this.chat([systemMessage, ...messages], {
      temperature: 0.7,
    });
  }

  async analyzePostWorkout(
    workoutData: {
      workoutType: string;
      completedDate: Date;
      nextDate: Date | null;
      feedback?: { rating: number; notes?: string };
      exercises: Array<{
        name: string;
        exerciseType: string;
        sets: number;
        reps: number;
        weightValue: number;
        weightType: string;
        restTime: number;
        performed: {
          setsCompleted: number;
          repsPerSet: number[];
          weightUsed: number;
        };
        history: Array<{
          date: Date;
          sets: number;
          reps: number;
          weight: number;
          setsCompleted: number;
          avgReps: number;
        }>;
        progression?: {
          type: string;
          increment: number;
          frequency: string;
        };
      }>;
    }
  ): Promise<string> {
    const exercisesPrompt = workoutData.exercises.map(ex => `
Exercise: ${ex.name}
Type: ${ex.exerciseType}
Current Prescription: ${ex.sets} sets × ${ex.reps} reps @ ${ex.weightValue}${ex.weightType === '1RM' ? '% of 1RM' : ex.weightType === 'BW' ? ' bodyweight' : ' lbs'}
Rest Time: ${ex.restTime}s

Today's Performance:
- Sets completed: ${ex.performed.setsCompleted}
- Reps per set: [${ex.performed.repsPerSet.join(', ')}]
- Weight used: ${ex.performed.weightUsed} lbs

Performance History (last 6 times):
${ex.history.length > 0 ? ex.history.map(h => 
  `  ${h.date.toLocaleDateString()}: ${h.sets}×${h.reps} @ ${h.weight} lbs - Completed: ${h.setsCompleted} sets, avg ${h.avgReps} reps`
).join('\n') : '  No previous history'}

Progression Strategy: ${ex.progression?.type || 'linear'} (${ex.progression?.increment || 5} lb increment)
`).join('\n\n');

    const userMessage = `
Workout Completed: ${workoutData.workoutType} on ${workoutData.completedDate.toLocaleDateString()}
${workoutData.nextDate ? `Next ${workoutData.workoutType} scheduled: ${workoutData.nextDate.toLocaleDateString()}` : 'No future occurrence scheduled'}

Overall Workout Feedback: ${workoutData.feedback?.rating || 'Not provided'}/5 difficulty
${workoutData.feedback?.notes || ''}

Exercises:
${exercisesPrompt}

Based on all this data, calculate optimal prescriptions for the NEXT occurrence of this workout.
For cardio exercises (cardio_time), adjust duration instead of weight.
`;

    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.postWorkoutAnalysis,
    };

    return this.chat([systemMessage, { role: 'user', content: userMessage }], {
      temperature: 0.5,
      maxTokens: 4096,
    });
  }
}

// Singleton instance
let openRouterInstance: OpenRouterClient | null = null;

export function getOpenRouterClient(): OpenRouterClient {
  if (!openRouterInstance) {
    openRouterInstance = new OpenRouterClient();
  }
  return openRouterInstance;
}

// Helper to extract JSON from AI response
export function extractJSON<T>(response: string): T | null {
  try {
    // Try to find JSON in code blocks first (with or without 'json' tag)
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      const jsonStr = codeBlockMatch[1].trim();
      console.log('Found code block, attempting to parse:', jsonStr.substring(0, 200) + '...');
      return JSON.parse(jsonStr);
    }

    // Try to find raw JSON object (get the first complete object)
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      console.log('Found JSON object, attempting to parse:', jsonMatch[0].substring(0, 200) + '...');
      // Try to find the complete object by counting braces
      let depth = 0;
      let start = response.indexOf('{');
      let end = start;
      
      for (let i = start; i < response.length; i++) {
        if (response[i] === '{') depth++;
        if (response[i] === '}') depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
      
      const jsonStr = response.substring(start, end);
      return JSON.parse(jsonStr);
    }

    // Try parsing the whole response
    console.log('Trying to parse entire response as JSON');
    return JSON.parse(response);
  } catch (e) {
    console.error('JSON extraction failed:', e);
    return null;
  }
}

// Zod schema for interval phase
const intervalPhaseSchema = z.object({
  name: z.string(),
  duration: z.number(), // in seconds
  intensity: z.enum(['easy', 'moderate', 'hard']).optional(),
});

// Zod schema for interval structure
const intervalStructureSchema = z.object({
  type: z.enum(['simple', 'complex']),
  rounds: z.number(),
  phases: z.array(intervalPhaseSchema),
});

// Zod schema for validating plan JSON from AI
export const workoutPlanSchema = z.object({
  goal: z.string(),
  weeksDuration: z.number().optional().default(12),
  sessionsPerWeek: z.number().optional().default(4),
  schedule: z.array(
    z.object({
      dayNumber: z.number(),
      dayName: z.string(),
      workoutType: z.string(),
      workoutColor: z.string(),
      exercises: z.array(
        z.object({
          name: z.string(),
          sets: z.number(),
          reps: z.number(),
          weightType: z.string(), // Allow any weight type (BW, 1RM, ABSOLUTE, RPE, seconds, etc.)
          weightValue: z.number(),
          restTime: z.number().optional().default(90), // Rest time in seconds
          exerciseType: z.string().optional().default('strength'), // strength, cardio_time, mobility_time, distance, interval, amrap, emom, tabata, tempo
          progression: z.object({
            type: z.string(),
            increment: z.number(),
            frequency: z.string(),
          }).optional(),
          movementDetails: z.object({
            description: z.string(),
            cues: z.array(z.string()),
            muscles: z.array(z.string()),
          }).optional(),
          // Complex exercise type fields
          distance: z.number().optional(),           // Target distance (e.g., 40 for 40 feet)
          distanceUnit: z.enum(['feet', 'yards', 'meters']).optional().default('feet'), // Distance unit
          intervals: intervalStructureSchema.optional(), // Interval structure with phases
          tempo: z.string().optional(),              // Tempo pattern (e.g., "3-1-3-1")
          timeCap: z.number().optional(),            // Time cap in seconds for AMRAP/timed exercises
        })
      ),
    })
  ),
});

export type WorkoutPlanAI = z.infer<typeof workoutPlanSchema>;
