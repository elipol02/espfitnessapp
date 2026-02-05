import { z } from 'zod';

// OpenRouter API client
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-haiku-4.5';

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
  | 'text-chunk'           // Token from conversational response
  | 'text-done'            // Conversational text complete
  | 'tool-call'            // Tool call detected (includes tool name and args)
  | 'tool-result'          // Tool execution result
  | 'error'                // Something went wrong
  | 'done'                 // Generation complete
  | 'cancelled';           // User stopped generation

export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  toolResult?: {
    toolCallId: string;
    result: unknown;
  };
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
    setsMin?: number;
    reps: number;
    repsMin?: number;
    weightType: string;
    weightValue: number;
    restTime?: number;
    exerciseType?: string;
    progression?: string;
    movementDetails?: {
      description: string;
      cues: string[];
      muscles: string[];
    };
    duration?: number;
    distance?: number;
    distanceUnit?: string;
    intervals?: object;
    tempo?: string;
    timeCap?: number;
    movements?: Array<{
      name: string;
      reps?: number;
      duration?: number;
      weight?: number;
      weightType?: string;
    }>;
  }>;
}

export interface ExerciseAdjustment {
  name: string;
  currentWeight: number;
  currentSets: number;
  currentReps: number;
  currentDuration?: number;
  currentDistance?: number;
  currentTimeCap?: number;
  currentIntervals?: object;
  nextWeight: number;
  nextSets: number;
  nextReps: number;
  nextDuration?: number;
  nextDistance?: number;
  nextTimeCap?: number;
  nextIntervals?: object;
  reasoning: string;
}

// Tool definitions for function calling
export const WORKOUT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'create_workout_plan',
      description: 'Create or edit a workout plan. Use this when the user wants to create a new workout plan, edit their existing plan, add exercises, modify workout structure, etc. IMPORTANT: Ask for equipment, days per week, experience level, injuries, and session length BEFORE calling this tool.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'The user\'s fitness goal (e.g., "build muscle", "lose weight", "get stronger")'
          },
          weeksDuration: {
            type: 'number',
            description: 'How many weeks the plan should last (default: 12)'
          },
          sessionsPerWeek: {
            type: 'number',
            description: 'Number of workout sessions per week'
          },
          schedule: {
            type: 'array',
            description: 'Array of workout days with complete exercises. Each day includes dayNumber (0=Sunday, 1=Monday, etc.), dayName, workoutType, workoutColor, and exercises array with ALL details (sets, reps, weight, progression, movementDetails).',
            items: {
              type: 'object',
              properties: {
                dayNumber: { type: 'number' },
                dayName: { type: 'string' },
                workoutType: { type: 'string' },
                workoutColor: { type: 'string' },
                exercises: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      exerciseType: { type: 'string', enum: ['strength', 'cardio_time', 'mobility_time', 'distance', 'interval', 'amrap', 'emom', 'tabata', 'tempo'] },
                      sets: { type: 'number' },
                      reps: { type: 'number' },
                      weightType: { type: 'string', enum: ['ABSOLUTE', 'BW', '1RM'] },
                      weightValue: { type: 'number' },
                      restTime: { type: 'number' },
                      progression: { type: 'string' },
                      movementDetails: {
                        type: 'object',
                        properties: {
                          description: { type: 'string' },
                          cues: { type: 'array', items: { type: 'string' } },
                          muscles: { type: 'array', items: { type: 'string' } }
                        },
                        required: ['description', 'cues', 'muscles']
                      },
                      duration: { type: 'number' },
                      distance: { type: 'number' },
                      distanceUnit: { type: 'string' },
                      tempo: { type: 'string' },
                      timeCap: { type: 'number' }
                    },
                    required: ['name', 'sets', 'reps', 'weightType', 'weightValue', 'progression', 'movementDetails']
                  }
                }
              },
              required: ['dayNumber', 'dayName', 'workoutType', 'workoutColor', 'exercises']
            }
          },
          isEdit: {
            type: 'boolean',
            description: 'True if editing an existing plan, false if creating new'
          }
        },
        required: ['goal', 'schedule']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'analyze_workout',
      description: 'Analyze a completed workout and provide progression recommendations. ONLY use this tool when an adjustmentId is explicitly provided in the system context. Do NOT call this tool if no adjustmentId is available.',
      parameters: {
        type: 'object',
        properties: {
          adjustmentId: {
            type: 'string',
            description: 'CRITICAL: Use the EXACT adjustmentId string provided in the system message after "Adjustment ID available in context:". Copy it exactly as-is - do not modify, append, or include any other text. Example: if system says "Adjustment ID available in context: abc123", use "abc123"'
          },
          summary: {
            type: 'string',
            description: 'Brief overall assessment of the workout'
          },
          exercises: {
            type: 'array',
            description: 'Array of exercise adjustments with current and next values. Include detailed set-by-set performance data if available.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                exerciseType: { type: 'string', description: 'Type of exercise: strength, distance, cardio_time, etc.' },
                currentWeight: { type: 'number', description: 'Average weight used (only for summary)' },
                currentSets: { type: 'number', description: 'Number of sets completed' },
                currentReps: { type: 'number', description: 'Average reps/distance completed (only for summary)' },
                currentRepsPerSet: { type: 'array', items: { type: 'number' }, description: 'REQUIRED: Extract actual values from each set. For strength: reps per set. For distance: distance per set. For time-based (cardio_time, mobility_time): minutes. Examples: "Set 1: 40 meters" -> [40], "5 minutes" -> [5]' },
                currentWeightsUsed: { type: 'array', items: { type: 'number' }, description: 'REQUIRED: Extract actual weights from each set. Example: "@ 50 lbs" for each set -> [50, 50, 50]. For exercises without weight, use [0]' },
                currentDistanceUnit: { type: 'string', description: 'For distance exercises only: the unit (feet, meters, yards)' },
                currentRestTime: { type: 'number', description: 'Rest time in seconds from prescribed rest time' },
                currentIntervalStructure: { type: 'string', description: 'For interval exercises only: description of interval phases (e.g., "30sec hard / 30sec easy")' },
                nextWeight: { type: 'number' },
                nextSets: { type: 'number' },
                nextReps: { type: 'number', description: 'For strength: reps. For distance: distance value. For time-based: minutes' },
                nextDistanceUnit: { type: 'string', description: 'For distance exercises only: the unit (feet, meters, yards)' },
                nextRestTime: { type: 'number', description: 'Recommended rest time in seconds for next workout' },
                nextIntervalStructure: { type: 'string', description: 'For interval exercises only: description of interval phases for next workout (e.g., "30sec hard / 30sec easy")' },
                nextProgression: { type: 'string', description: 'Progressive overload strategy (e.g., "linear +5 lbs weekly", "linear +10 meters per set weekly")' },
                reasoning: { type: 'string' }
              },
              required: ['name', 'currentWeight', 'currentSets', 'currentReps', 'nextWeight', 'nextSets', 'nextReps', 'reasoning']
            }
          }
        },
        required: ['adjustmentId', 'summary', 'exercises']
      }
    }
  }
];

// System prompt for unified chat with tool calls
export const SYSTEM_PROMPT = `You are ESP Fitness AI, an expert fitness coach assistant that helps users with their workout plans and fitness questions.

IMPORTANT: You have access to specialized tools for workout operations. Use them when appropriate:

**create_workout_plan**: Use this tool when the user wants to:
- Create a new workout plan
- Edit their existing plan  
- Modify workout structure
- Add or change exercises
IMPORTANT: Before calling this tool, ask the user important questions:
- How many days per week they want to work out
- Session length (30min, 45min, 60min, 90min)
- Available equipment (full gym, home gym, dumbbells, kettlebells, bodyweight)
- Experience level (beginner, intermediate, advanced)
- Any injuries or limitations
- Specific goals beyond their general goal

When calling create_workout_plan, you MUST provide complete exercise details including:
- exerciseType (strength, cardio_time, mobility_time, distance, interval, amrap, emom, tabata, tempo)
- sets, reps, weightType (ABSOLUTE/BW/1RM), weightValue
- restTime (in seconds: 60-180s typical)
- progression (e.g., "linear +5 lbs weekly", "add 1 rep each session")
- movementDetails with description, cues array, and muscles array

EXERCISE TYPES QUICK REFERENCE:
- strength: Traditional sets×reps with weight (e.g., "3×8 @ 135 lbs")
- cardio_time: Timed cardio (use duration field in minutes)
- mobility_time: Timed stretching (use duration field in minutes)
- distance: Carries, sprints (use distance + distanceUnit fields)
- interval: Work/rest intervals (use intervals object with rounds and phases)
- amrap: As Many Rounds/Reps As Possible (use timeCap in seconds, reps per round)
- emom: Every Minute On the Minute (use timeCap in seconds, reps per minute)
- tabata: 20s work/10s rest (use timeCap, sets for rounds, reps per round)
- tempo: Tempo-controlled lifting (use tempo field like "3-1-3-1")

WEIGHT TYPES:
- ABSOLUTE: Fixed pounds (135 = 135 lbs, 53 = 53lb KB, 0 = bodyweight only)
- BW: Percentage of bodyweight (0.5 = 50% BW for weighted carries)
- 1RM: Percentage of one-rep max (0.75 = 75% 1RM for strength work)

WORKOUT COLORS (use these for schedule):
- #06b6d4 (cyan), #ef4444 (red), #10b981 (emerald), #a855f7 (purple)
- #eab308 (yellow), #ec4899 (pink), #14b8a6 (teal), #f97316 (orange), #8b5cf6 (violet)

**analyze_workout**: Use this tool ONLY when:
- An adjustmentId is provided in the context (look for "Adjustment ID available in context: [id]" at the end of this system message)
- The user has just finished a workout session and needs progression recommendations

CRITICAL INSTRUCTIONS FOR USING analyze_workout:
1. Check if "Adjustment ID available in context:" appears in this system message
2. If YES: Extract the EXACT ID that appears after the colon (e.g., "cmkzxlhpk000004jo6mvmwogi")
3. Use that EXACT string for the adjustmentId parameter - do not modify it or add any text
4. If NO: Do NOT call this tool. Explain that they need to complete a workout first through the live workout feature.

AUTOMATIC WORKOUT ANALYSIS:
- If you receive an empty/blank message AND "COMPLETED WORKOUT DATA" appears in this system message, the user just finished a workout and wants automatic analysis
- Review the completed workout data carefully: did they complete all sets and reps as prescribed?
- If everything looks good (all sets completed, reasonable performance), IMMEDIATELY call analyze_workout with appropriate progression recommendations
- If you see issues (missed sets, noted difficulty/pain, incomplete workout), ask a brief follow-up question before providing recommendations
- Be proactive - don't ask unnecessary questions if the data is clear

CRITICAL: When calling analyze_workout, you MUST include detailed set-by-set data FOR APPROPRIATE EXERCISE TYPES:
- Look at the "Completed:" section in the workout data - it shows individual sets
- Include the exerciseType field (strength, distance, cardio_time, emom, interval, amrap, tabata, etc.) for each exercise
- Extract set-by-set data into arrays ONLY for these types:
  * STRENGTH exercises: "Set 1: 8 reps @ 135 lbs" → currentRepsPerSet: [8,8,7], currentWeightsUsed: [135,135,135]
  * DISTANCE exercises: "Set 1: 40 meters @ 50 lbs" → currentRepsPerSet: [40,40,40], currentWeightsUsed: [50,50,50], currentDistanceUnit: "meters"
- DO NOT include currentRepsPerSet arrays for: EMOM, Interval, AMRAP, Tabata (use summary values only: currentSets for rounds, currentReps for reps per round)
- Include currentRestTime from the prescribed rest time shown (but NOT for emom, interval, amrap, tabata)
- ALWAYS include nextRestTime for strength/distance exercises (typically 60-180s), but NOT for emom, interval, amrap, tabata
- ALWAYS include nextProgression (the progressive overload strategy from "Progression strategy:" or create one)
- For distance exercises, include nextDistanceUnit (feet, meters, yards) and use distance-appropriate progressions like "linear +10 meters per set weekly"
- For interval exercises, ALWAYS include currentIntervalStructure and nextIntervalStructure (e.g., "15sec hard / 15sec easy" or "30sec hard / 30sec easy") extracted EXACTLY from the "Completed:" section of the workout data. Look for the phase descriptions after "rounds completed:"

EXAMPLES OF TOOL CALLS:

Strength Exercise (Squat):
  Input: "Set 1: 8 reps @ 135 lbs, Set 2: 8 reps @ 135 lbs, Set 3: 7 reps @ 135 lbs"
  Tool call should include:
  {
    "name": "Squat",
    "exerciseType": "strength",
    "currentRepsPerSet": [8, 8, 7],
    "currentWeightsUsed": [135, 135, 135],
    "nextReps": 8,
    "nextWeight": 140,
    "nextRestTime": 180,
    "nextProgression": "linear +5 lbs weekly"
  }

Distance Exercise (Suitcase Carry):
  Input: "Set 1: 40 meters @ 50 lbs, Set 2: 40 meters @ 50 lbs, Set 3: 40 meters @ 50 lbs"
  Tool call should include:
  {
    "name": "Suitcase Carry",
    "exerciseType": "distance",
    "currentRepsPerSet": [40, 40, 40],
    "currentWeightsUsed": [50, 50, 50],
    "currentDistanceUnit": "meters",
    "nextReps": 50,
    "nextWeight": 50,
    "nextDistanceUnit": "meters",
    "nextRestTime": 120,
    "nextProgression": "linear +10 meters per set weekly"
  }

Time-Based Exercise (Core Circuit):
  Input: "5 minutes"
  Tool call should include:
  {
    "name": "Core Circuit",
    "exerciseType": "cardio_time",
    "currentRepsPerSet": [5],
    "currentWeightsUsed": [0],
    "nextSets": 1,
    "nextReps": 5,
    "nextWeight": 0,
    "nextProgression": "maintain 5 minutes, no progressive overload"
  }

EMOM Exercise (Kettlebell Swing):
  Input: "20 rounds completed in EMOM 20 min"
  Tool call should include:
  {
    "name": "1H Kettlebell Swing EMOM",
    "exerciseType": "emom",
    "currentSets": 20,
    "currentReps": 10,
    "currentWeight": 44,
    "nextSets": 20,
    "nextReps": 10,
    "nextWeight": 50,
    "nextProgression": "linear +6 lbs every 2 weeks"
  }

Interval Exercise (Assault Bike):
  Input: "16 rounds completed: 15sec hard / 15sec easy"
  Tool call should include:
  {
    "name": "Assault Bike Intervals",
    "exerciseType": "interval",
    "currentSets": 16,
    "currentReps": 0,
    "currentWeight": 0,
    "currentIntervalStructure": "15sec hard / 15sec easy",
    "nextSets": 16,
    "nextReps": 0,
    "nextWeight": 0,
    "nextIntervalStructure": "15sec hard / 15sec easy",
    "nextProgression": "maintain current intervals, focus on max effort during work phases"
  }

CONVERSATIONAL APPROACH:
- Be friendly, encouraging, and knowledgeable
- Ask clarifying questions when you need more information
- Keep responses concise but helpful
- Celebrate progress and provide constructive feedback
- For general fitness questions, answer directly without using tools

WHEN NOT TO USE TOOLS:
- General fitness questions (nutrition, form, technique, etc.) - answer these directly
- Casual conversation about workouts
- Questions about their current plan (you have access to it in context)`;

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
      tools?: typeof WORKOUT_TOOLS;
    }
  ): Promise<string> {
    const { temperature = 0.7, maxTokens = 4096, responseFormat = 'text', tools } = options || {};

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
        tools: tools || undefined,
        tool_choice: tools ? 'auto' : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data: OpenRouterResponse = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  // Streaming chat method - yields token chunks OR tool calls
  async *chatStream(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      tools?: typeof WORKOUT_TOOLS;
    },
    signal?: AbortSignal
  ): AsyncGenerator<{ type: 'text'; content: string } | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } }, void, unknown> {
    const { temperature = 0.7, maxTokens = 4096, tools } = options || {};

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
        tools: tools || undefined,
        tool_choice: tools ? 'auto' : undefined,
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
    let buffer = '';
    const toolCallsBuffer = new Map<number, { id?: string; name?: string; arguments?: string }>();

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
            const json = JSON.parse(trimmed.slice(6)) as OpenRouterStreamChunk & {
              choices: Array<{
                delta: {
                  role?: string;
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    type?: 'function';
                    function?: {
                      name?: string;
                      arguments?: string;
                    };
                  }>;
                };
                finish_reason: string | null;
              }>;
            };
            
            const delta = json.choices[0]?.delta;
            
            // Handle text content
            if (delta?.content) {
              yield { type: 'text', content: delta.content };
            }
            
            // Handle tool calls (accumulate them as they stream)
            if (delta?.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const idx = toolCallDelta.index;
                if (!toolCallsBuffer.has(idx)) {
                  toolCallsBuffer.set(idx, {});
                }
                const toolCall = toolCallsBuffer.get(idx)!;
                
                if (toolCallDelta.id) toolCall.id = toolCallDelta.id;
                if (toolCallDelta.function?.name) toolCall.name = toolCallDelta.function.name;
                if (toolCallDelta.function?.arguments) {
                  toolCall.arguments = (toolCall.arguments || '') + toolCallDelta.function.arguments;
                }
              }
            }
            
            // When streaming is done, yield complete tool calls
            if (json.choices[0]?.finish_reason === 'tool_calls') {
              for (const [_, toolCall] of toolCallsBuffer) {
                if (toolCall.id && toolCall.name && toolCall.arguments) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: toolCall.id,
                      name: toolCall.name,
                      arguments: toolCall.arguments
                    }
                  };
                }
              }
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Format a single exercise for plan context
  private formatExerciseForContext(ex: {
    name: string;
    sets?: number;
    reps?: number;
    weightType?: string;
    weightValue?: number;
    exerciseType?: string;
    duration?: number;
    distance?: number;
    distanceUnit?: string;
    intervals?: { rounds?: number; phases?: Array<{ name: string; duration: number }> };
    timeCap?: number;
    tempo?: string;
  }): string {
    const type = ex.exerciseType || 'strength';
    const w = ex.weightValue ?? 0;
    const wt = ex.weightType || 'ABSOLUTE';
    const fmt = () => {
      if (wt === '1RM') return `${Math.round((w || 0) * 100)}% 1RM`;
      if (wt === 'BW') return `${Math.round((w || 0) * 100)}% BW`;
      if (w > 0) return `${w} lbs`;
      return '';
    };
    if (type === 'cardio_time' || type === 'mobility_time') {
      return `${ex.name} – ${ex.duration ?? ex.reps ?? 0} min`;
    }
    if (type === 'distance') {
      const wStr = w > 0 ? ` @ ${fmt()}` : '';
      return `${ex.name} – ${ex.sets ?? 1}×${ex.distance ?? 0} ${ex.distanceUnit || 'feet'}${wStr}`;
    }
    if (type === 'interval' && ex.intervals) {
      const { rounds, phases } = ex.intervals as { rounds?: number; phases?: Array<{ name: string; duration: number }> };
      const wStr = w > 0 ? ` @ ${fmt()}` : '';
      if (phases?.length === 2) {
        return `${ex.name} – ${rounds ?? 0} rounds: ${Math.floor((phases[0]?.duration ?? 0) / 60)} min ${phases[0]?.name} / ${Math.floor((phases[1]?.duration ?? 0) / 60)} min ${phases[1]?.name}${wStr}`;
      }
      return `${ex.name} – ${rounds ?? 0} rounds interval${wStr}`;
    }
    if (type === 'amrap') {
      const wStr = w > 0 ? ` @ ${fmt()}` : '';
      return `${ex.name} – AMRAP ${Math.floor((ex.timeCap ?? 600) / 60)} min • ${ex.reps ?? 0} reps/round${wStr}`;
    }
    if (type === 'emom') {
      const wStr = w > 0 ? ` @ ${fmt()}` : '';
      return `${ex.name} – EMOM ${Math.floor((ex.timeCap ?? 600) / 60)} min • ${ex.reps ?? 0} reps/min${wStr}`;
    }
    if (type === 'tabata') {
      const wStr = w > 0 ? ` @ ${fmt()}` : '';
      return `${ex.name} – Tabata ${ex.sets ?? 8} rounds • ${ex.reps ?? 0} reps/round${wStr}`;
    }
    if (type === 'tempo') {
      return `${ex.name} – ${ex.sets ?? 0}×${ex.reps ?? 0} @ tempo ${ex.tempo || '3-1-3-1'}${w > 0 ? `, ${fmt()}` : ''}`;
    }
    // strength or default
    return `${ex.name} – ${ex.sets ?? 0}×${ex.reps ?? 0} @ ${fmt() || 'bodyweight'}`;
  }

  // Unified chat stream with tool support
  async *unifiedChatStream(
    messages: ChatMessage[],
    context?: {
      currentPlan?: object;
      userName?: string | null;
      bodyweight?: number | null;
      adjustmentId?: string | null;
      workoutLogData?: {
        workoutDate: Date;
        dayName: string;
        workoutType: string;
        exercises: Array<{
          name: string;
          exerciseType?: string;
          prescribedSets: number;
          prescribedReps: number;
          prescribedWeight: number;
          weightType: string;
          prescribedRestTime: number;
          progression: unknown;
          duration?: number | null;
          distance?: number | null;
          distanceUnit?: string | null;
          timeCap?: number | null;
          intervals?: unknown | null;
          tempo?: string | null;
          completedSets: number;
          repsPerSet: unknown;
          weightUsed: unknown;
          completedDuration?: number | null;
          completedDistance?: number | null;
          completedRounds?: number | null;
          timeElapsed?: number | null;
          performanceData?: unknown | null;
          notes?: string | null;
        }>;
      } | null;
    },
    signal?: AbortSignal
  ): AsyncGenerator<{ type: 'text'; content: string } | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } }, void, unknown> {
    let systemContent = SYSTEM_PROMPT;

    // Add current plan context if available
    if (context?.currentPlan) {
      const plan = context.currentPlan as {
        goal?: string;
        weeksDuration?: number;
        workoutDays?: Array<{
          dayNumber: number;
          dayName: string;
          workoutType: string;
          workoutColor?: string;
          exercises?: unknown[];
        }>;
      };
      const sessionsPerWeek =
        plan.workoutDays?.filter((d: { workoutType?: string }) => d.workoutType !== 'Rest')?.length ??
        plan.workoutDays?.length ??
        0;
      const planBlock = `

USER'S CURRENT WORKOUT PLAN (available for reference):
Goal: ${plan.goal ?? 'Not set'}
Duration: ${plan.weeksDuration ?? 12} weeks
Sessions per week: ${sessionsPerWeek}

WEEKLY SCHEDULE:
${(plan.workoutDays ?? [])
  .sort((a: { dayNumber: number }, b: { dayNumber: number }) => a.dayNumber - b.dayNumber)
  .map(
    (day: {
      dayNumber: number;
      dayName: string;
      workoutType: string;
      workoutColor?: string;
      exercises?: unknown[];
    }) => {
      const exList = (day.exercises ?? [])
        .map((ex: unknown) =>
          this.formatExerciseForContext(
            ex as {
              name: string;
              sets?: number;
              reps?: number;
              weightType?: string;
              weightValue?: number;
              exerciseType?: string;
              duration?: number;
              distance?: number;
              distanceUnit?: string;
              intervals?: { rounds?: number; phases?: Array<{ name: string; duration: number }> };
              timeCap?: number;
              tempo?: string;
            }
          )
        )
        .join('\n  ');
      return `${day.dayName} (Day ${day.dayNumber}) – ${day.workoutType}:\n  ${exList || 'No exercises'}`;
    }
  )
  .join('\n\n')}`;
      systemContent += planBlock;
    }
    if (context?.userName) {
      systemContent += `\n\nUser's name: ${context.userName}`;
    }
    if (context?.bodyweight != null) {
      systemContent += `\n\nUser's bodyweight: ${context.bodyweight} lbs`;
    }
    if (context?.adjustmentId) {
      systemContent += `\n\nAdjustment ID available in context: ${context.adjustmentId}`;
    }
    if (context?.workoutLogData) {
      const log = context.workoutLogData;
      console.log('=== WORKOUT LOG DATA FOR AI ===');
      console.log('Exercises:', log.exercises.length);
      log.exercises.forEach((ex: any, idx: number) => {
        console.log(`\nExercise ${idx + 1}: ${ex.name}`);
        console.log(`  Type: ${ex.exerciseType}`);
        console.log(`  repsPerSet:`, ex.repsPerSet);
        console.log(`  weightUsed:`, ex.weightUsed);
        console.log(`  completedDuration:`, ex.completedDuration);
        console.log(`  distance:`, ex.distance, ex.distanceUnit);
      });
      console.log('=== END WORKOUT LOG DATA ===');
      
      systemContent += `\n\nCOMPLETED WORKOUT DATA (for analysis):
Date: ${new Date(log.workoutDate).toLocaleDateString()}
Workout: ${log.dayName} - ${log.workoutType}

Exercises performed:
${log.exercises.map((ex: any) => {
  const exerciseType = ex.exerciseType || 'strength';
  const reps = Array.isArray(ex.repsPerSet) ? ex.repsPerSet : [];
  const weights = Array.isArray(ex.weightUsed) ? ex.weightUsed : [];
  const progressionStr = ex.progression && typeof ex.progression === 'string' ? ex.progression : 'Not specified';
  
  let prescribedInfo = '';
  let completedInfo = '';
  
  // Format based on exercise type
  if (exerciseType === 'cardio_time' || exerciseType === 'mobility_time') {
    // Convert seconds to minutes for display
    const prescribedMinutes = ex.duration ? Math.round(ex.duration / 60) : ex.prescribedReps;
    // Use repsPerSet array if available (contains minutes), otherwise fall back to completedDuration
    if (reps.length > 0) {
      const minutes = reps[0]; // For time-based exercises, repsPerSet[0] contains minutes
      prescribedInfo = `${prescribedMinutes} minutes`;
      completedInfo = `${minutes} minutes`;
    } else {
      const completedMinutes = ex.completedDuration 
        ? Math.round(ex.completedDuration / 60) 
        : (ex.duration ? Math.round(ex.duration / 60) : ex.prescribedReps);
      prescribedInfo = `${prescribedMinutes} minutes`;
      completedInfo = `${completedMinutes} minutes`;
    }
  } else if (exerciseType === 'distance') {
    const distanceUnit = ex.distanceUnit || 'feet';
    prescribedInfo = `${ex.prescribedSets} × ${ex.distance} ${distanceUnit}${ex.prescribedWeight > 0 ? ` @ ${ex.prescribedWeight} lbs` : ''}, ${ex.prescribedRestTime}s rest`;
    const setsInfo = reps.length > 0 
      ? '\n  ' + reps.map((r: number, i: number) => {
          const dist = r; // For distance exercises, repsPerSet contains distance values
          return `  Set ${i + 1}: ${dist} ${distanceUnit}${weights[i] ? ` @ ${weights[i]} lbs` : ''}`;
        }).join('\n  ')
      : `${ex.completedSets} × ${ex.completedDistance || ex.distance} ${distanceUnit}`;
    completedInfo = setsInfo;
  } else if (exerciseType === 'amrap') {
    const timeCap = Math.floor((ex.timeCap || 600) / 60);
    prescribedInfo = `AMRAP ${timeCap} min, ${ex.prescribedReps} reps/round${ex.prescribedWeight > 0 ? ` @ ${ex.prescribedWeight} lbs` : ''}`;
    completedInfo = `${ex.completedRounds || 0} rounds completed in ${Math.floor((ex.timeElapsed || ex.timeCap || 0) / 60)} min`;
  } else if (exerciseType === 'emom') {
    const timeCap = Math.floor((ex.timeCap || 600) / 60);
    prescribedInfo = `EMOM ${timeCap} min, ${ex.prescribedReps} reps/min${ex.prescribedWeight > 0 ? ` @ ${ex.prescribedWeight} lbs` : ''}`;
    completedInfo = `${ex.completedRounds || timeCap} rounds completed`;
  } else if (exerciseType === 'tabata') {
    prescribedInfo = `Tabata ${ex.prescribedSets} rounds, ${ex.prescribedReps} reps/round${ex.prescribedWeight > 0 ? ` @ ${ex.prescribedWeight} lbs` : ''}`;
    completedInfo = `${ex.completedRounds || ex.prescribedSets} rounds completed`;
  } else if (exerciseType === 'interval') {
    const intervals = ex.intervals as any;
    if (intervals && intervals.phases) {
      const formatDuration = (seconds: number) => {
        if (seconds >= 60) {
          const mins = Math.floor(seconds / 60);
          const secs = seconds % 60;
          return secs > 0 ? `${mins}min ${secs}sec` : `${mins}min`;
        }
        return `${seconds}sec`;
      };
      const phaseDescription = intervals.phases.map((p: any) => `${formatDuration(p.duration)} ${p.name}`).join(' / ');
      prescribedInfo = `${intervals.rounds} rounds: ${phaseDescription}`;
      completedInfo = `${ex.completedRounds || intervals.rounds} rounds completed: ${phaseDescription}`;
    } else {
      prescribedInfo = `Interval training`;
      completedInfo = `Completed`;
    }
  } else if (exerciseType === 'tempo') {
    prescribedInfo = `${ex.prescribedSets}×${ex.prescribedReps} @ tempo ${ex.tempo || '3-1-3-1'}, ${ex.prescribedWeight} lbs`;
    const setsInfo = reps.length > 0 
      ? '\n  ' + reps.map((r: number, i: number) => `  Set ${i + 1}: ${r} reps @ ${weights[i] ?? ex.prescribedWeight} lbs`).join('\n  ')
      : `${ex.completedSets}×${ex.prescribedReps} @ ${ex.prescribedWeight} lbs`;
    completedInfo = setsInfo;
  } else {
    // strength or default
    prescribedInfo = `${ex.prescribedSets}×${ex.prescribedReps} @ ${ex.prescribedWeight} lbs (${ex.weightType}), ${ex.prescribedRestTime}s rest`;
    const setsInfo = reps.length > 0 
      ? '\n  ' + reps.map((r: number, i: number) => `  Set ${i + 1}: ${r} reps @ ${weights[i] ?? ex.prescribedWeight} lbs`).join('\n  ')
      : `${ex.completedSets} sets completed`;
    completedInfo = setsInfo;
  }
  
  return `- ${ex.name} (${exerciseType}):
  Prescribed: ${prescribedInfo}
  Progression strategy: ${progressionStr}
  Completed: ${completedInfo}${ex.notes ? `\n  Notes: ${ex.notes}` : ''}`;
}).join('\n\n')}`;
    }

    const systemMessage: ChatMessage = {
      role: 'system',
      content: systemContent,
    };

    yield* this.chatStream([systemMessage, ...messages], { temperature: 0.7, tools: WORKOUT_TOOLS }, signal);
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

// Helper to extract JSON from AI response (legacy - not used in new tool call system)
export function extractJSON<T>(response: string): T | null {
  try {
    // Try to find JSON in code blocks first
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      const jsonStr = codeBlockMatch[1].trim();
      return JSON.parse(jsonStr);
    }

    // Try to find raw JSON object
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
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
    return JSON.parse(response);
  } catch (e) {
    console.error('JSON extraction failed:', e);
    return null;
  }
}

// Zod schema for interval phase
const intervalPhaseSchema = z.object({
  name: z.string(),
  duration: z.number(),
  intensity: z.enum(['easy', 'moderate', 'hard']).optional(),
});

// Zod schema for interval structure
const intervalStructureSchema = z.object({
  type: z.enum(['simple', 'complex']),
  rounds: z.number(),
  phases: z.array(intervalPhaseSchema),
});

// Zod schema for validating plan JSON from AI (legacy - not used in new tool call system)
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
          weightType: z.string(),
          weightValue: z.number(),
          restTime: z.number().optional().default(90),
          exerciseType: z.string().optional().default('strength'),
          progression: z.string().optional(),
          movementDetails: z.object({
            description: z.string(),
            cues: z.array(z.string()),
            muscles: z.array(z.string()),
          }).optional(),
          distance: z.number().optional(),
          distanceUnit: z.enum(['feet', 'yards', 'meters']).optional().default('feet'),
          intervals: intervalStructureSchema.optional(),
          tempo: z.string().optional(),
          timeCap: z.number().optional(),
        })
      ),
    })
  ),
});

export type WorkoutPlanAI = z.infer<typeof workoutPlanSchema>;
