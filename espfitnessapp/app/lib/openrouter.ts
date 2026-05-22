import { z } from 'zod';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-4.6';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

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

export type SSEEventType =
  | 'text-chunk'
  | 'text-done'
  | 'tool-call'
  | 'tool-result'
  | 'ask-user'
  | 'new-bubble'
  | 'error'
  | 'done'
  | 'cancelled';

export interface AskUserQuestion {
  id: string;
  question: string;
  options: string[];
}

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
  questions?: AskUserQuestion[];
  error?: string;
  savedMessageIds?: string[];
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

const EXERCISE_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    exerciseType: {
      type: 'string',
      enum: ['strength', 'distance', 'time', 'amrap', 'emom', 'round_block', 'tabata', 'simple'],
    },
    config: {
      type: 'object',
      description:
        'Type-specific config. strength: {sets,repsMin,repsMax,weightType,baseWeight,weightUnit,restSeconds,tempo?}. distance: {sets,distanceTarget,distanceUnit,restSeconds}. time: {sets,durationSeconds,restSeconds}. amrap: {timeCap,movements:[{name,reps?,weight?,weightUnit?}]}. emom: {intervalSeconds,totalMinutes,movements:[...]}. round_block: {rounds,restBetweenRounds,movements:[...]}. tabata: {rounds,workSeconds,restSeconds,movements:[...]}. simple: {} (empty or {notes?})',
    },
    progression: {
      type: 'object',
      description:
        'REQUIRED. double_progression: {type:"double_progression",repsMin,repsMax,weightIncrement,weightIncrementUnit}. linear: {type:"linear",incrementValue,incrementUnit}. none: {type:"none"}. NEVER omit.',
    },
    groupTag: {
      type: 'string',
      description: 'Optional. Exercises sharing the same groupTag are done as a superset/circuit.',
    },
    order: { type: 'number' },
    notes: { type: 'string' },
  },
  required: ['name', 'exerciseType', 'config', 'progression', 'order'],
} as const;

export const WORKOUT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'create_workout_plan',
      description:
        "Build the user's weekly SCHEDULE. Use ONLY for (a) creating their first schedule, or (b) STRUCTURAL changes to an existing one — adding/removing a training day, adding/removing a slot, or adding/removing/reordering a rotation. Do NOT use this to change exercises, weights, sets, or reps inside an existing workout — use edit_workout_plan for that. Returns schedule JSON for approval (no DB writes yet); on approval it is reconciled by workout NAME, so unchanged workouts keep their history. When restructuring an existing schedule, output the COMPLETE schedule (every day, including unchanged ones). For a NEW schedule, ALWAYS use ask_user first for: days per week, session length, equipment, experience level, injuries, goals, and whether they want A/B rotation. A rotation cycles workout types across the same days (e.g., MWF alternates Upper-A and Upper-B each occurrence). Multiple slots on a day means TWO separate workouts (e.g., strength + cardio same day).",
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Short label shown as the preview title (e.g., "Summer Strength Block")',
          },
          schedule: {
            type: 'array',
            description:
              'Array of day entries. dayOfWeek: 1=Mon…7=Sun. Each day has one or more slots. A "fixed" slot is a single workout. A "rotation" slot alternates between multiple workouts across occurrences (A/B, A/B/C, etc.). Use rotation when the user wants alternating splits on shared days.',
            items: {
              type: 'object',
              properties: {
                dayOfWeek: { type: 'number', description: '1=Monday through 7=Sunday' },
                dayName: { type: 'string', description: 'e.g. "Monday"' },
                slots: {
                  type: 'array',
                  description:
                    'One or more workout slots for this day. Usually 1. Use 2+ only when the user explicitly wants multiple workouts on the same day.',
                  items: {
                    oneOf: [
                      {
                        type: 'object',
                        description: 'A fixed (non-rotating) workout slot.',
                        properties: {
                          type: { type: 'string', enum: ['fixed'] },
                          workoutTypeName: { type: 'string', description: 'e.g. "Push Day"' },
                          workoutTypeColor: {
                            type: 'string',
                            description: 'Hex color. Options: #06b6d4, #ef4444, #10b981, #a855f7, #eab308, #ec4899, #14b8a6, #f97316, #8b5cf6',
                          },
                          workoutTypeCategory: {
                            type: 'string',
                            enum: ['strength', 'cardio', 'conditioning', 'mobility', 'mixed'],
                          },
                          exercises: { type: 'array', items: EXERCISE_ITEM_SCHEMA },
                        },
                        required: ['type', 'workoutTypeName', 'workoutTypeColor', 'exercises'],
                      },
                      {
                        type: 'object',
                        description:
                          'A rotating slot that cycles through multiple workouts (A/B, A/B/C, etc.) across each occurrence of this day. All days sharing the same rotationName share a single rotation counter.',
                        properties: {
                          type: { type: 'string', enum: ['rotation'] },
                          rotationName: {
                            type: 'string',
                            description:
                              'Unique name for this rotation group. Days sharing the same rotationName share the same A/B counter (e.g. "MWF Upper/Lower"). Must be the SAME string for every day that participates in the same rotation.',
                          },
                          rotationEntries: {
                            type: 'array',
                            description: 'Ordered list of workout types that cycle (A, B, C…). Minimum 2.',
                            items: {
                              type: 'object',
                              properties: {
                                workoutTypeName: { type: 'string' },
                                workoutTypeColor: { type: 'string' },
                                workoutTypeCategory: {
                                  type: 'string',
                                  enum: ['strength', 'cardio', 'conditioning', 'mobility', 'mixed'],
                                },
                                exercises: { type: 'array', items: EXERCISE_ITEM_SCHEMA },
                              },
                              required: ['workoutTypeName', 'workoutTypeColor', 'exercises'],
                            },
                          },
                        },
                        required: ['type', 'rotationName', 'rotationEntries'],
                      },
                    ],
                  },
                },
              },
              required: ['dayOfWeek', 'dayName', 'slots'],
            },
          },
        },
        required: ['name', 'schedule'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_workout_plan',
      description:
        "PREFERRED tool for changing an existing schedule. Edits ONE existing workout type, updating its exercises in place by ID (never deletes/recreates the workout, so completed-session history is preserved). Use for changing weights/sets/reps/tempo/rest, swapping an exercise, or adding/removing exercises within a workout. It does NOT change which days are scheduled or rotation structure — use create_workout_plan only for those structural changes. Call get_workout_history first to see what the user has actually been doing.",
      parameters: {
        type: 'object',
        properties: {
          workoutTypeId: { type: 'string', description: 'The WorkoutType ID to edit' },
          name: { type: 'string', description: 'Optional new name for the workout type' },
          color: { type: 'string', description: 'Optional new hex color' },
          exercises: {
            type: 'array',
            description:
              'Exercises to update or create. If id is present, the exercise is UPDATED. If id is absent, a new exercise is CREATED.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Existing exercise ID for updates. Omit for new exercises.' },
                name: { type: 'string' },
                exerciseType: {
                  type: 'string',
                  enum: ['strength', 'distance', 'time', 'amrap', 'emom', 'round_block', 'tabata', 'simple'],
                },
                config: { type: 'object' },
                progression: {
                  type: 'object',
                  description:
                    'REQUIRED. Progression rule. Use double_progression for rep-range strength exercises, linear for fixed-rep weight increases, or none for pure bodyweight. NEVER omit.',
                },
                groupTag: { type: 'string' },
                order: { type: 'number' },
                notes: { type: 'string' },
              },
              required: ['name', 'exerciseType', 'config', 'progression', 'order'],
            },
          },
          deleteExerciseIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exercise IDs to delete from the workout type.',
          },
        },
        required: ['workoutTypeId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remove_from_schedule',
      description:
        "Remove items from the user's schedule WITHOUT deleting any workout history. Use to take a workout off a single day, remove a workout from the schedule entirely, or clear the whole schedule. Workout types, exercises, and logged sessions are ALWAYS preserved — this only unschedules. Before clearing the whole schedule or removing an entire day, briefly confirm with the user first unless they were explicit.",
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['remove_day', 'remove_workout', 'clear_schedule'],
            description:
              "'remove_day' = unschedule everything on one day (needs dayOfWeek). 'remove_workout' = take one workout type off every day it appears (needs workoutTypeId). 'clear_schedule' = wipe the entire schedule.",
          },
          dayOfWeek: { type: 'number', description: 'For remove_day: 1=Monday … 7=Sunday.' },
          workoutTypeId: { type: 'string', description: 'For remove_workout: the WorkoutType ID from the current schedule shown in context.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ask_user',
      description:
        'Ask the user one or more multiple-choice questions to gather structured information. Use this BEFORE building a new schedule or making significant decisions. The UI will show questions one at a time. An "Other" free-text option is always added automatically — do NOT include it in your options list.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: 'List of questions to ask the user, shown one at a time.',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Unique identifier for this question (e.g. "experience_level")',
                },
                question: {
                  type: 'string',
                  description: 'The question text to display to the user',
                },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Answer options to display as buttons. Do NOT include "Other" — it is added automatically.',
                },
              },
              required: ['id', 'question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_workout_history',
      description:
        'Fetch past performance data for a specific workout type. Use this BEFORE suggesting changes so you understand what the user has actually been doing. Returns recent completed sessions with exercise-by-exercise data.',
      parameters: {
        type: 'object',
        properties: {
          workoutTypeId: { type: 'string', description: 'The WorkoutType ID to fetch history for' },
          limit: { type: 'number', description: 'Max sessions to return (default: 10)' },
        },
        required: ['workoutTypeId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_memory',
      description:
        'Store a memory for this user. Call this when the user shares critical information (goals, preferences, injuries, equipment, experience level, constraints) or when you answer an important question that should be remembered for future conversations. Use a concise, factual summary (e.g. "User has knee pain; avoid heavy squatting" or "Prefers 4 days per week, 45 min sessions"). Do not store trivial chitchat.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Concise summary to remember. One or two sentences; include key facts only.',
          },
        },
        required: ['content'],
      },
    },
  },
];

// ─── System Prompt ──────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are ESP Fitness AI, an expert fitness coach assistant.

HOW THE APP WORKS: The user has ONE ongoing weekly workout SCHEDULE — a set of days, each with one or more workouts (and optional A/B rotations). There are no separate "plans", no start/end dates, and nothing to activate or archive — edits take effect on the single live schedule. The user's current schedule (workout types + exercise IDs) is shown below when they have one. Completed workouts and logged history are tied to each workout type and exercise, so PRESERVE those identities: change existing workouts in place rather than rebuilding the schedule.

You have access to these tools:

**ask_user**: Ask the user structured multiple-choice questions. Use this to gather information before building a new schedule. Questions are shown one at a time with selectable options. An "Other" free-text option is always automatically included. Call this ONCE with ALL your questions bundled together — do not call it multiple times in a row.

**create_workout_plan**: Builds the user's weekly schedule. Use it ONLY to create their first schedule or to make STRUCTURAL changes (add/remove a training day, add/remove a slot, add/remove/reorder a rotation). Do NOT use it to change exercises, weights, sets, or reps — that's edit_workout_plan. For a brand-new schedule, ALWAYS use ask_user first to collect:
- How many days per week to work out
- Session length (30min, 45min, 60min, 90min)
- Available equipment (full gym, home gym, dumbbells, kettlebells, bodyweight)
- Experience level (beginner, intermediate, advanced)
- Any injuries or limitations
- Specific goals
- Whether they want A/B rotation (for undulating periodization or upper/lower splits that alternate across days)

**CHANGING AN EXISTING SCHEDULE — EDIT IN PLACE, DON'T REBUILD**: The user's current schedule (with workout type and exercise IDs) is shown below. Always make the SMALLEST change that does the job:
- Changing weights, sets, reps, tempo, rest, or swapping/adding/removing exercises inside a workout → use **edit_workout_plan** (one call per workout type, by ID). This preserves history. Do NOT regenerate the whole schedule for this.
- Only when the STRUCTURE itself changes — adding/removing a training day, adding/removing a slot, or adding/changing a rotation — use **create_workout_plan**, and output the COMPLETE intended schedule (every day, including unchanged ones, reproduced from the schedule below). On approval it reconciles by workout name: unchanged workouts keep their history, only differences apply, and any day you omit is removed. NEVER send just the changed day.
Never call create_workout_plan just to tweak something inside an existing workout — that needlessly rebuilds the schedule.

**A/B ROTATION**: Use a rotation slot when workouts should ALTERNATE across occurrences of the same days (e.g., MWF: Mon=A, Wed=B, Fri=A, next Mon=B, etc.). Set the same "rotationName" string on every day that shares the counter. Use 2 entries for A/B, 3 for A/B/C. Do NOT use rotation if they simply want different workouts on different days of the week — that is just normal fixed slots per day. Use rotation only when the same day slots alternate over multiple weeks.

**MULTIPLE SLOTS PER DAY**: Only use multiple slots (e.g., slots: [{strength slot}, {cardio slot}]) when the user explicitly wants TWO separate workout sessions on the same day. Most plans use one slot per day.

**edit_workout_plan**: The preferred tool for changing an existing schedule. Edits exercises within ONE existing workout type — add, update, or remove. Provide exercise IDs for updates, omit IDs for new exercises, and use deleteExerciseIds for removals. When editing multiple workouts, make ONE edit_workout_plan call per workout type; do not stop after the first edit. After your LAST edit_workout_plan for the request, do not send a long follow-up message — use at most a brief confirmation or no text after the final edit.

**get_workout_history**: Fetch past workout performance for a workout type. ALWAYS call this before suggesting edits — you need to see what they've actually been doing.

**remove_from_schedule**: Unschedule things — take a workout off a day (remove_day), remove a workout from the schedule everywhere (remove_workout, by workoutTypeId), or clear the whole schedule (clear_schedule). This NEVER deletes workout history; it only unschedules, so workout types and logged sessions are preserved. Use this instead of create_workout_plan when the user just wants to remove/drop something. Briefly confirm before clearing the whole schedule or removing a full day unless the user was explicit.

**write_memory**: Store a memory when the user shares critical info (goals, injuries, preferences, equipment, experience) or when you give an answer worth remembering. Keep summaries concise and factual.

EXERCISE TYPES:
- strength: sets × reps with weight. Config: {sets, repsMin, repsMax, weightType, baseWeight, weightUnit (lbs/kg ONLY — never use "percent" or any other unit), restSeconds, tempo?}
  weightType values:
  - "absolute": external load is used. baseWeight = actual weight (e.g. 45 for 45 lbs). Use for exercises with dumbbells, barbells, vest, etc.
  - "bodyweight": no external load. baseWeight = 0, weightUnit = "lbs". Use for pure bodyweight movements like pull-ups, push-ups, dips, pistol squats, etc.
  - "percentage_1rm": baseWeight = percentage of 1RM (e.g. 80 for 80%). Rarely used; only when user explicitly programs by percentage.
- distance: sets × distance. Config: {sets, distanceTarget, distanceUnit (feet/yards/meters/miles/km), restSeconds}
- time: sets × duration. Config: {sets, durationSeconds, restSeconds}
- amrap: As Many Rounds As Possible. Config: {timeCap (seconds), movements: [{name, reps?, weight?, weightUnit?}]}
- emom: Every Minute On the Minute. Config: {intervalSeconds, totalMinutes, movements: [...]}
- round_block: Fixed rounds. Config: {rounds, restBetweenRounds, movements: [...]}
- tabata: Work/rest intervals. Config: {rounds, workSeconds, restSeconds, movements: [...]}
- simple: Just mark it done — no sets, reps, or weight. Config: {} (empty, or {notes?}). Always use progression: {type:"none"}.

PROGRESSION RULES (REQUIRED on EVERY exercise — never omit the progression field):
- double_progression: {type:"double_progression", repsMin:6, repsMax:12, weightIncrement:5, weightIncrementUnit:"lbs"} — build reps to repsMax across all sets, then bump weight back to repsMin. Use this for ALL weighted strength exercises with a rep range (e.g. "6-10 reps, +5 lbs at top").
- linear: {type:"linear", incrementValue:5, incrementUnit:"lbs"} — add weight every session regardless of reps. Use for exercises where weight always increases each session.
- none: {type:"none"} — no progression tracking. Use ONLY for pure bodyweight exercises with no load component (e.g. Hollow Body Holds, Scapular Pull-ups).

CRITICAL: Every single exercise object MUST include a progression field. There are no exceptions. Missing progression = broken tracking.

WORKOUT TYPE COLORS: #06b6d4 (cyan), #ef4444 (red), #10b981 (emerald), #a855f7 (purple), #eab308 (yellow), #ec4899 (pink), #14b8a6 (teal), #f97316 (orange), #8b5cf6 (violet)

CONVERSATIONAL APPROACH:
- Be friendly, encouraging, and knowledgeable
- Keep responses concise
- For general fitness questions, answer directly without using tools
- Celebrate progress and provide constructive feedback
- Use ask_user when you need multiple pieces of structured information — bundle ALL questions into a single call rather than asking one question at a time in chat`;

// ─── Build System Message ───────────────────────────────────────────────────

export interface PlanContext {
  currentPlan?: {
    dayAssignments: Array<{
      dayOfWeek: number;
      workoutType: {
        id: string;
        name: string;
        color: string;
        exercises: Array<{
          id: string;
          name: string;
          exerciseType: string;
          config: Record<string, unknown>;
          progression: Record<string, unknown> | null;
          order: number;
        }>;
      };
    }>;
  } | null;
  userName?: string | null;
  bodyweight?: number | null;
  /** Recent memory summaries to inject into system message (searched per request). */
  memorySummaries?: string[];
}

export function buildSystemMessage(context?: PlanContext): ChatMessage {
  let systemContent = SYSTEM_PROMPT;

  if (context?.currentPlan) {
    const plan = context.currentPlan;
    const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    systemContent += `\n\nUSER'S CURRENT SCHEDULE (what they have today — give any NEW or restructured schedule its own descriptive name, never "Current Schedule"):\n\nWEEKLY SCHEDULE:\n`;
    const sorted = [...plan.dayAssignments].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    for (const da of sorted) {
      const wt = da.workoutType;
      systemContent += `\n${dayNames[da.dayOfWeek]} – ${wt.name} (ID: ${wt.id}):\n`;
      for (const ex of wt.exercises.sort((a, b) => a.order - b.order)) {
        systemContent += `  - ${ex.name} (${ex.exerciseType}, ID: ${ex.id}): ${JSON.stringify(ex.config)}`;
        if (ex.progression) systemContent += ` | progression: ${JSON.stringify(ex.progression)}`;
        systemContent += '\n';
      }
    }
  }

  if (context?.userName) {
    systemContent += `\n\nUser's name: ${context.userName}`;
  }
  if (context?.bodyweight != null) {
    systemContent += `\nUser's bodyweight: ${context.bodyweight} lbs`;
  }
  if (context?.memorySummaries?.length) {
    systemContent += `\n\nRECENT MEMORIES (use these to personalize responses):\n${context.memorySummaries.map((s) => `- ${s}`).join('\n')}`;
  }

  return { role: 'system', content: systemContent };
}

// ─── API Client ─────────────────────────────────────────────────────────────

export class OpenRouterClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
    if (!this.apiKey) {
      console.warn('OpenRouter API key not configured');
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: {
      temperature?: number;

      tools?: typeof WORKOUT_TOOLS;
    },
    signal?: AbortSignal
  ): AsyncGenerator<
    | { type: 'text'; content: string }
    | { type: 'tool_call_start'; name: string }
    | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } },
    void,
    unknown
  > {
    const { temperature = 0.7, tools } = options || {};

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
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallsBuffer = new Map<number, { id?: string; name?: string; arguments?: string; nameYielded?: boolean }>();

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
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason: string | null;
              }>;
            };

            const delta = json.choices[0]?.delta;

            if (delta?.content) {
              yield { type: 'text', content: delta.content };
            }

            if (delta?.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const idx = toolCallDelta.index;
                if (!toolCallsBuffer.has(idx)) {
                  toolCallsBuffer.set(idx, {});
                }
                const toolCall = toolCallsBuffer.get(idx)!;
                if (toolCallDelta.id) toolCall.id = toolCallDelta.id;
                if (toolCallDelta.function?.name) {
                  toolCall.name = toolCallDelta.function.name;
                  if (!toolCall.nameYielded) {
                    toolCall.nameYielded = true;
                    yield { type: 'tool_call_start', name: toolCall.name };
                  }
                }
                if (toolCallDelta.function?.arguments) {
                  toolCall.arguments = (toolCall.arguments || '') + toolCallDelta.function.arguments;
                }
              }
            }

            const finishReason = json.choices[0]?.finish_reason;

            if (finishReason === 'length' && toolCallsBuffer.size > 0) {
              throw new Error(
                'The schedule was too large to generate in one response. Try requesting fewer workout days or simpler exercises.',
              );
            }

            if (finishReason === 'tool_calls') {
              for (const [, toolCall] of toolCallsBuffer) {
                if (toolCall.id && toolCall.name && toolCall.arguments) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: toolCall.id,
                      name: toolCall.name,
                      arguments: toolCall.arguments,
                    },
                  };
                }
              }
              toolCallsBuffer.clear();
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async *unifiedChatStream(
    messages: ChatMessage[],
    context?: PlanContext,
    signal?: AbortSignal
  ): AsyncGenerator<
    | { type: 'text'; content: string }
    | { type: 'tool_call_start'; name: string }
    | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } },
    void,
    unknown
  > {
    const systemMessage = buildSystemMessage(context);
    yield* this.chatStream([systemMessage, ...messages], { temperature: 0.7, tools: WORKOUT_TOOLS }, signal);
  }
}

let openRouterInstance: OpenRouterClient | null = null;

export function getOpenRouterClient(): OpenRouterClient {
  if (!openRouterInstance) {
    openRouterInstance = new OpenRouterClient();
  }
  return openRouterInstance;
}

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const exerciseItemSchema = z.object({
  name: z.string(),
  exerciseType: z.enum(['strength', 'distance', 'time', 'amrap', 'emom', 'round_block', 'tabata', 'simple']),
  config: z.record(z.string(), z.unknown()),
  progression: z.record(z.string(), z.unknown()).optional(),
  groupTag: z.string().optional(),
  order: z.number(),
  notes: z.string().optional(),
});

const fixedSlotSchema = z.object({
  type: z.literal('fixed'),
  workoutTypeName: z.string(),
  workoutTypeColor: z.string(),
  workoutTypeCategory: z.string().optional(),
  exercises: z.array(exerciseItemSchema),
});

const rotationSlotSchema = z.object({
  type: z.literal('rotation'),
  rotationName: z.string(),
  rotationEntries: z.array(
    z.object({
      workoutTypeName: z.string(),
      workoutTypeColor: z.string(),
      workoutTypeCategory: z.string().optional(),
      exercises: z.array(exerciseItemSchema),
    })
  ),
});

export const planDataSchema = z.object({
  name: z.string(),
  schedule: z.array(
    z.object({
      dayOfWeek: z.number().min(1).max(7),
      dayName: z.string(),
      slots: z.array(z.union([fixedSlotSchema, rotationSlotSchema])),
    })
  ),
});

export type PlanDataAI = z.infer<typeof planDataSchema>;
