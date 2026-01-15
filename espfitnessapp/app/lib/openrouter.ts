import { z } from 'zod';

// OpenRouter API client for GPT-5.2 Thinking
// use anthropic/claude-haiku-4.5 for cheaper

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
    setsMin?: number;      // For ranges like "3-4", this is 3 and sets is 4
    reps: number;
    repsMin?: number;      // For ranges like "6-8", this is 6 and reps is 8
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
    // Time-based fields
    duration?: number;     // Duration in minutes (cardio_time, mobility_time)
    // Distance fields
    distance?: number;
    distanceUnit?: string;
    // Interval fields
    intervals?: object;
    // Tempo fields
    tempo?: string;
    // AMRAP/EMOM/Tabata fields
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
  nextWeight: number;
  nextSets: number;
  nextReps: number;
  reasoning: string;
}

// System prompts for different modes
export const SYSTEM_PROMPTS = {
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

CONVERSATIONAL APPROACH:
- You will receive detailed data about the workout that was completed
- If the user provides additional feedback or corrections (like "I did 3x125 front squat easy" or "for TGU I did 44 lbs easy"), integrate that information
- Ask clarifying follow-up questions ONLY if critical information is missing or unclear
- Once you have enough information, provide your analysis and prescriptions

Your job is to:
1. Analyze their performance for each exercise
2. Compare to their recent history
3. Calculate optimal weights, sets, AND reps for the next occurrence of this workout
4. Provide brief reasoning for each adjustment

CRITICAL: You can adjust weight, sets, AND reps. Consider all three variables to create optimal progressive overload.

Follow these guidelines based on exercise type:

═══════════════════════════════════════════════════════════════
STRENGTH EXERCISES (strength, tempo):
═══════════════════════════════════════════════════════════════

WEIGHT ADJUSTMENTS:
- If they completed all prescribed reps cleanly → suggest 5lb increase (or 10lb for lower body)
- If they struggled on last set(s) but completed most reps → maintain weight
- If they failed to complete most reps → suggest 5lb decrease
- Consider the progression strategy defined for each exercise

SET ADJUSTMENTS:
- If they're crushing the workout and it's too easy → add 1 set (up to 5 sets max typically)
- If they're consistently failing to complete sets → reduce by 1 set
- Consider training volume needs and recovery capacity

REP ADJUSTMENTS:
- If they're exceeding target reps consistently by 2+ reps → increase rep target by 1-2
- If strength focus is needed → decrease reps and increase weight
- If hypertrophy focus → increase reps toward 8-12 range
- If they're failing to hit rep targets → decrease reps by 1-2 OR decrease weight

STRATEGIC ADJUSTMENTS:
- You can change the workout structure (e.g., 3×8 → 4×6 for more strength focus)
- You can adjust rep ranges for variety (e.g., 4×8 → 5×5 for a strength block)
- Consider periodization: vary intensity and volume over time
- Match adjustments to the user's goal and training phase

═══════════════════════════════════════════════════════════════
DISTANCE EXERCISES (carries, sprints, sleds):
═══════════════════════════════════════════════════════════════
- Keep distance and sets the same - DO NOT change distance!
- Only adjust weight (for carries) or add/remove sets
- If completed all sets at prescribed distance → increase weight by 5-10 lbs
- If struggled → reduce weight or reduce sets
- Example: "3×40m @ 53 lbs" completed well → "3×40m @ 62 lbs"

═══════════════════════════════════════════════════════════════
TIME-BASED EXERCISES (cardio_time, mobility_time):
═══════════════════════════════════════════════════════════════
- Adjust duration (kept in "reps" field for these types)
- If completed the prescribed duration → suggest 5-10% increase in duration
- If struggled → maintain or slightly reduce duration
- Weight should remain 0, sets should remain 1

═══════════════════════════════════════════════════════════════
INTERVAL/AMRAP/EMOM/TABATA:
═══════════════════════════════════════════════════════════════
- INTERVAL: Generally maintain structure, can adjust weight if used
- AMRAP: Adjust "reps per round" (in "reps" field) based on rounds completed
- EMOM: Adjust "reps per minute" (in "reps" field) based on rest time available
- TABATA: Adjust "reps per round" (in "reps" field) based on performance
- These can also have weight adjusted if using weighted movements

CRITICAL REQUIREMENTS FOR YOUR RESPONSE:

1. **Weight Format**: ALL weights in your suggestions MUST be in absolute pounds (lbs)
   - The data you receive already shows actual weights performed in pounds
   - Your nextWeight suggestions must be actual pounds (e.g., 85, 135, 225)
   - DO NOT use percentages or decimals like 0.83 - use real weights

2. **Analysis Format**: For EACH exercise, provide clear analysis showing:
   - What was prescribed (the plan)
   - What was actually performed (the reality)
   - What should be prescribed next (your recommendation)

3. **Be Specific**: Reference actual numbers from the performance data
   - Example: "You were prescribed 5×3 @ 165 lbs, completed all sets cleanly at that weight, so increasing to 170 lbs"

RESPONSE FORMAT:
First, write a brief analysis for the overall workout, then analyze each exercise individually with specifics about prescribed vs performed.

Then, provide the suggestions in JSON format wrapped in triple backticks:
\`\`\`json
{
  "summary": "<brief overall assessment>",
  "exercises": [
    {
      "name": "<exercise name - MUST match exactly as provided>",
      "currentWeight": <number>,
      "currentSets": <number>,
      "currentReps": <number>,
      "nextWeight": <number>,
      "nextSets": <number>,
      "nextReps": <number>,
      "nextDuration": <number or undefined>,  // For time-based exercises ONLY (in minutes)
      "nextDistance": <number or undefined>,  // For distance exercises ONLY (same as current)
      "reasoning": "<brief explanation for this adjustment - mention what changed and why>"
    }
  ]
}
\`\`\`

IMPORTANT FIELD USAGE BY EXERCISE TYPE:
- STRENGTH/TEMPO: Use nextWeight, nextSets, nextReps (ignore duration/distance)
- TIME-BASED (cardio_time, mobility_time): Use nextDuration (in minutes), set nextReps = nextDuration also for compatibility
- DISTANCE: Use nextDistance (keep same as current), nextSets, nextWeight
- AMRAP/EMOM/TABATA: Use nextReps (for reps per round/minute), nextSets if applicable, nextWeight if using weight

CRITICAL REQUIREMENTS: 
- Write conversational text FIRST, BEFORE the JSON block
- Include ALL exercises from the workout in your JSON response
- List exercises in the EXACT SAME ORDER they were provided in the input data
- Provide a suggestion for EVERY exercise, even if it's to maintain current values
- If they need to stay at the same weight/sets/reps, that's okay - consistency is part of the process`,

  // Plan structure prompt - generates ONLY the plan skeleton without exercises
  planStructure: `You are an expert fitness coach AI assistant. The user wants to create a workout plan.

BEFORE generating the plan structure, you MUST ask follow-up questions to gather important information. Ask about:
1. Days per week they want to work out (e.g., 3, 4, 5, or 6 days)
2. Length of each session (e.g., 30 minutes, 45 minutes, 60 minutes, 90 minutes)
3. Available equipment (e.g., full gym, home gym, dumbbells only, bodyweight only, kettlebells, etc.)
4. Experience level (e.g., beginner, intermediate, advanced)
5. Any injuries or limitations (e.g., knee issues, back problems, shoulder mobility, etc.)
6. Specific goals beyond the general goal they mentioned (e.g., build muscle, lose weight, improve strength, increase endurance, etc.)

IMPORTANT: 
- If the user's initial message doesn't contain enough information, ask these questions in a friendly, conversational way. You can ask multiple questions at once.
- DO NOT output any JSON until you have gathered sufficient information to create a personalized plan.
- If the user has already provided most of this information in their message or previous messages, you can proceed to generate the plan structure.
- Use the conversation history to avoid asking for information the user has already provided.

ONLY after you have gathered sufficient information (or if the user has already provided it), generate the plan structure.

CRITICAL: You must output ONLY the plan structure WITHOUT exercises. The exercises will be generated separately for each day.

When generating a plan structure, first write a brief friendly message explaining the plan, then output the structure in this JSON format:
\`\`\`json
{
  "goal": "User's fitness goal",
  "weeksDuration": 12,
  "sessionsPerWeek": 3,
  "schedule": [
    {
      "dayNumber": 0,
      "dayName": "Sunday",
      "workoutType": "Push",
      "workoutColor": "#ef4444"
    },
    {
      "dayNumber": 2,
      "dayName": "Tuesday",
      "workoutType": "Pull",
      "workoutColor": "#06b6d4"
    },
    {
      "dayNumber": 4,
      "dayName": "Thursday",
      "workoutType": "Legs",
      "workoutColor": "#10b981"
    }
  ]
}
\`\`\`

CRITICAL RULES:
1. ONLY include workout days in the schedule. Do NOT include rest days - they are automatic.
2. dayNumber MUST match the day of week: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
3. dayName MUST match dayNumber (e.g., dayNumber 0 = "Sunday", dayNumber 2 = "Tuesday")
4. Each dayNumber can only appear ONCE in the schedule
5. sessionsPerWeek should equal the number of workout days in the schedule

WORKOUT TYPE RULES:
1. workoutType can be one or two words (e.g., "Push", "Pull", "Legs", "Upper Strength", "Full Body")
2. NEVER use underscores or hyphens
3. If the SAME workout appears on multiple days, use the SAME name and color
4. Different workout types should use different colors
5. Use variant names (A/B) when the same type appears with different focuses

Available workout colors:
- #06b6d4 (cyan), #ef4444 (red), #10b981 (emerald), #a855f7 (purple)
- #eab308 (yellow), #ec4899 (pink), #14b8a6 (teal), #f97316 (orange)
- #8b5cf6 (violet)`,

  // Single day generation prompt for iterative day-by-day plan creation
  planCreationSingleDay: `You are generating exercises for a single workout day. Output ONLY valid JSON.

WEIGHT TYPES - ONLY USE THESE 3:
- "ABSOLUTE": fixed pounds (35 = 35lb kettlebell, 135 = 135 lbs, 0 = bodyweight only)
- "BW": % of bodyweight (0.5 = 50% BW)  
- "1RM": % of one-rep max (0.75 = 75% 1RM)

═══════════════════════════════════════════════════════════════
EXERCISE TYPES - USE THE CORRECT ONE!
═══════════════════════════════════════════════════════════════

STRENGTH (lifting for sets × reps) → "3×8 @ 135 lbs"
{
  "name": "Bench Press",
  "exerciseType": "strength",
  "sets": 3, "reps": 8,
  "weightType": "ABSOLUTE", "weightValue": 135, "restTime": 90,
  "progression": {
    "type": "linear",
    "increment": 5,
    "frequency": "weekly"
  },
  "movementDetails": {
    "description": "Lie flat on bench, grip bar slightly wider than shoulders, lower to chest, press up explosively.",
    "cues": ["Retract shoulder blades", "Elbows 45 degrees", "Drive through feet", "Full lockout at top"],
    "muscles": ["Chest", "Triceps", "Front Delts"]
  }
}

KETTLEBELL EXAMPLE (use ABSOLUTE with actual KB weight):
{
  "name": "Kettlebell Swing",
  "exerciseType": "strength",
  "sets": 5, "reps": 10,
  "weightType": "ABSOLUTE", "weightValue": 53, "restTime": 90,
  "progression": {
    "type": "linear",
    "increment": 9,
    "frequency": "every 2 weeks"
  },
  "movementDetails": {
    "description": "Hinge at hips, swing KB between legs, explosively drive hips forward to shoulder height.",
    "cues": ["Hinge, don't squat", "Snap hips", "Keep core tight", "Neutral spine"],
    "muscles": ["Glutes", "Hamstrings", "Lower Back", "Shoulders"]
  }
}

CARDIO_TIME (timed cardio) → "10 min"
{
  "name": "Easy Warm-Up Jog",
  "exerciseType": "cardio_time",
  "duration": 10,
  "sets": 1, "reps": 1,
  "weightType": "ABSOLUTE", "weightValue": 0, "restTime": 0
}

MOBILITY_TIME (stretching/drills) → "8 min"
{
  "name": "Dynamic Stretching",
  "exerciseType": "mobility_time",
  "duration": 8,
  "sets": 1, "reps": 1,
  "weightType": "ABSOLUTE", "weightValue": 0, "restTime": 0
}

DISTANCE (carries, sprints) → "3 × 40 meters"
{
  "name": "Suitcase Carry",
  "exerciseType": "distance",
  "sets": 3, "reps": 1,
  "distance": 40, "distanceUnit": "meters",
  "weightType": "BW", "weightValue": 0.5, "restTime": 60,
  "progression": {
    "type": "linear",
    "increment": 0.05,
    "frequency": "weekly"
  },
  "movementDetails": {
    "description": "Hold heavy weight in one hand, walk specified distance maintaining upright posture.",
    "cues": ["Stand tall", "Don't lean", "Squeeze the weight", "Brace core"],
    "muscles": ["Core", "Obliques", "Forearms", "Traps"]
  }
}

INTERVAL (work/rest intervals) → "4 rounds: 2 min hard / 2 min easy"
{
  "name": "Run/Walk Intervals",
  "exerciseType": "interval",
  "sets": 1, "reps": 1,
  "weightType": "ABSOLUTE", "weightValue": 0, "restTime": 0,
  "intervals": {
    "type": "simple", "rounds": 4,
    "phases": [
      { "name": "Hard", "duration": 120, "intensity": "hard" },
      { "name": "Easy", "duration": 120, "intensity": "easy" }
    ]
  }
}

AMRAP (single movement) → "AMRAP 10 min • 10 reps/round"
{
  "name": "Kettlebell Swing AMRAP",
  "exerciseType": "amrap",
  "timeCap": 600,
  "reps": 10,
  "sets": 1, "weightType": "ABSOLUTE", "weightValue": 53, "restTime": 0,
  "progression": {
    "type": "linear",
    "increment": 2,
    "frequency": "weekly"
  },
  "movementDetails": {
    "description": "Complete as many rounds as possible of 10 KB swings in 10 minutes.",
    "cues": ["Maintain form", "Rest as needed", "Count your rounds"],
    "muscles": ["Glutes", "Hamstrings", "Lower Back"]
  }
}

AMRAP (multi-movement circuit) → "AMRAP 10 min"
{
  "name": "10-Min AMRAP Circuit",
  "exerciseType": "amrap",
  "timeCap": 600,
  "movements": [{ "name": "Push-ups", "reps": 10 }, { "name": "Squats", "reps": 15 }],
  "reps": 1, "sets": 1, "weightType": "ABSOLUTE", "weightValue": 0, "restTime": 0
}

EMOM (with weight) → "EMOM 10 min • 10 reps/min @ 53 lbs"
{
  "name": "Kettlebell Swing EMOM",
  "exerciseType": "emom",
  "timeCap": 600,
  "reps": 10,
  "sets": 1, "weightType": "ABSOLUTE", "weightValue": 53, "restTime": 0,
  "progression": {
    "type": "linear",
    "increment": 9,
    "frequency": "every 2 weeks"
  },
  "movementDetails": {
    "description": "Perform 10 kettlebell swings at the start of every minute for 10 minutes.",
    "cues": ["Start each minute fresh", "Maintain pace", "Use rest time wisely"],
    "muscles": ["Glutes", "Hamstrings", "Lower Back"]
  }
}

TABATA → "Tabata 8 rounds • 8 reps/round"
{
  "name": "Burpee Tabata",
  "exerciseType": "tabata",
  "timeCap": 240, "sets": 8, "reps": 8,
  "weightType": "ABSOLUTE", "weightValue": 0, "restTime": 0,
  "progression": {
    "type": "linear",
    "increment": 1,
    "frequency": "weekly"
  },
  "movementDetails": {
    "description": "Perform burpees for 20 seconds, rest 10 seconds. Repeat for 8 rounds.",
    "cues": ["Go hard for 20s", "Use 10s rest", "Track total reps"],
    "muscles": ["Full Body", "Cardio"]
  }
}

TEMPO → "3×8 @ tempo 3-1-3-1"
{
  "name": "Tempo Squat",
  "exerciseType": "tempo",
  "sets": 3, "reps": 8, "tempo": "3-1-3-1",
  "weightType": "ABSOLUTE", "weightValue": 95, "restTime": 90
}

═══════════════════════════════════════════════════════════════
QUICK REFERENCE
═══════════════════════════════════════════════════════════════
Warm-up jog, easy run → cardio_time (use "duration" in minutes)
Stretching, drills → mobility_time (use "duration" in minutes)  
Carries, sled, sprints → distance (use "distance" + "distanceUnit")
Run/walk intervals → interval (use "intervals" with phases)
Squats, bench, rows → strength (use sets × reps × weight)
EMOM workouts → emom (use "timeCap" + "reps" per minute + "weightValue")
AMRAP workouts → amrap (use "timeCap" + "reps" per round + "weightValue")
Tabata workouts → tabata (use "sets" rounds + "reps" per round)

OUTPUT FORMAT:
{
  "exercises": [
    { ... exercise 1 ... },
    { ... exercise 2 ... }
  ]
}

REQUIRED FOR ALL EXERCISES:
- progression: { "type": "linear", "increment": 5, "frequency": "weekly" }
- movementDetails: { "description": "...", "cues": ["...", "..."], "muscles": ["...", "..."] }`,
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

  // Streaming plan STRUCTURE generation (no exercises - they're generated day by day)
  async *generatePlanStructureStream(
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
      content: SYSTEM_PROMPTS.planStructure + 
        (userContext?.bodyweight ? `\n\nUser's bodyweight: ${userContext.bodyweight} lbs` : '') +
        (userContext?.experienceLevel ? `\nExperience level: ${userContext.experienceLevel}` : '') +
        (userContext?.currentPlan ? `\n\nUser's current plan structure:\n${JSON.stringify(userContext.currentPlan, null, 2)}` : ''),
    };

    return yield* this.chatStream(
      [systemMessage, ...messages],
      { temperature: 0.7, maxTokens: 2048 },
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
          weightsPerSet: number[];
          duration?: number; // Performed duration in seconds
          distance?: number; // Performed distance
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
        // Prescribed values for non-strength exercises
        duration?: number;
        distance?: number;
        distanceUnit?: string;
      }>;
    },
    chatHistory?: ChatMessage[],
    signal?: AbortSignal
  ): AsyncGenerator<string, string, unknown> {
    const exercisesPrompt = workoutData.exercises.map((ex: any) => {
      // All weights are already converted to absolute pounds in buildExerciseData
      let prescribedFormat = '';
      
      switch (ex.exerciseType) {
        case 'cardio_time':
        case 'mobility_time':
          prescribedFormat = `${ex.duration || ex.reps} minutes`;
          break;
        case 'distance':
          const distWeight = ex.weightValue > 0 ? ` @ ${ex.weightValue} lbs` : '';
          prescribedFormat = `${ex.sets} sets × ${ex.distance || 0} ${ex.distanceUnit || 'feet'}${distWeight}`;
          break;
        case 'amrap':
          const amrapWt = ex.weightValue > 0 ? ` @ ${ex.weightValue} lbs` : '';
          prescribedFormat = `AMRAP ${Math.floor((ex.timeCap || 600) / 60)} minutes • ${ex.reps} reps per round${amrapWt}`;
          break;
        case 'emom':
          const emomWt = ex.weightValue > 0 ? ` @ ${ex.weightValue} lbs` : '';
          prescribedFormat = `EMOM ${Math.floor((ex.timeCap || 600) / 60)} minutes • ${ex.reps} reps per minute${emomWt}`;
          break;
        case 'tabata':
          const tabataWt = ex.weightValue > 0 ? ` @ ${ex.weightValue} lbs` : '';
          prescribedFormat = `Tabata ${ex.sets} rounds (20s/10s) • ${ex.reps} reps per round${tabataWt}`;
          break;
        case 'tempo':
          prescribedFormat = `${ex.sets} sets × ${ex.reps} reps @ tempo ${ex.tempo || '3-1-3-1'}, weight: ${ex.weightValue} lbs`;
          break;
        case 'interval':
          prescribedFormat = ex.intervals ? `${ex.intervals.rounds} rounds of intervals` : 'Interval training';
          break;
        default: // strength
          prescribedFormat = `${ex.sets} sets × ${ex.reps} reps @ ${ex.weightValue} lbs`;
      }
      
      return `
═══════════════════════════════════════════════════════════════
${ex.name} (${ex.exerciseType})
═══════════════════════════════════════════════════════════════

📋 PRESCRIBED (What was planned):
   ${prescribedFormat}
   Rest Time: ${ex.restTime}s

💪 PERFORMED (What was actually done):
   ${ex.exerciseType === 'cardio_time' || ex.exerciseType === 'mobility_time' 
     ? `Duration: ${ex.performed.duration ? Math.round(ex.performed.duration / 60) + ' minutes' : ex.performed.repsPerSet[0] + ' minutes'}`
     : ex.exerciseType === 'distance'
     ? `Sets completed: ${ex.performed.setsCompleted} of ${ex.sets}${ex.performed.weightsPerSet.length > 0 ? `\n   ${ex.performed.weightsPerSet.map((weight: number, idx: number) => 
     `Set ${idx + 1}: ${ex.performed.distance || ex.distance || 0} ${ex.distanceUnit || 'feet'} @ ${weight} lbs`
   ).join('\n   ')}` : ''}`
     : `Sets completed: ${ex.performed.setsCompleted} of ${ex.sets}\n   ${ex.performed.weightsPerSet.map((weight: number, idx: number) => 
     `Set ${idx + 1}: ${ex.performed.repsPerSet[idx] || 0} reps @ ${weight} lbs`
   ).join('\n   ')}`}

📊 PERFORMANCE HISTORY (Last 6 sessions):
${ex.history.length > 0 ? ex.history.map((h: { date: Date; sets: number; reps: number; weight: number; setsCompleted: number; avgReps: number }) => 
  `   ${h.date.toLocaleDateString()}: ${h.sets}×${h.reps} @ ${h.weight} lbs - Completed: ${h.setsCompleted} sets, avg ${h.avgReps} reps`
).join('\n') : '   No previous history'}

🎯 PROGRESSION STRATEGY: ${ex.progression?.type || 'linear'} (${ex.progression?.increment || 5} lb increment per ${ex.progression?.frequency || 'session'})
`;
    }).join('\n\n');

    const userMessage = `
═══════════════════════════════════════════════════════════════
WORKOUT COMPLETED
═══════════════════════════════════════════════════════════════
Workout Type: ${workoutData.workoutType}
Date Completed: ${workoutData.completedDate.toLocaleDateString()}
${workoutData.nextDate ? `Next ${workoutData.workoutType} scheduled: ${workoutData.nextDate.toLocaleDateString()}` : 'No future occurrence scheduled'}

Overall Workout Feedback: ${workoutData.feedback?.rating || 'Not provided'}/5 difficulty
${workoutData.feedback?.notes ? `Notes: ${workoutData.feedback.notes}` : ''}

═══════════════════════════════════════════════════════════════
EXERCISE PERFORMANCE DATA
═══════════════════════════════════════════════════════════════
${exercisesPrompt}

═══════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════
Based on this ${workoutData.workoutType} workout data, calculate optimal prescriptions for the NEXT occurrence of this workout.

Key points:
- DISTANCE: Keep distance same, adjust weight only
- TIME-BASED: Adjust duration (in "reps" field)
- STRENGTH/TEMPO: Adjust weight, sets, and/or reps
- AMRAP/EMOM/TABATA: Can adjust reps per round/minute (in "reps" field) and/or weight

If you need any clarification about how the user performed any exercise, ask them. Otherwise, provide your analysis and suggestions.
`;

    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.postWorkoutAnalysis,
    };

    // If chat history is provided, use it for conversational context
    // Otherwise, start fresh with just the workout data
    const messages: ChatMessage[] = chatHistory && chatHistory.length > 0
      ? [systemMessage, ...chatHistory]
      : [systemMessage, { role: 'user', content: userMessage }];

    // If we have chat history, determine if we need to add the workout data context
    // Only add it on the first analysis (when there are no assistant messages yet)
    if (chatHistory && chatHistory.length > 0) {
      const hasAssistantResponse = chatHistory.some(msg => msg.role === 'assistant');
      // If no assistant has responded yet, this is the first analysis - add workout data
      // If assistant has already responded, the user is providing follow-up info - don't add data again
      if (!hasAssistantResponse) {
        messages.push({ role: 'user', content: userMessage });
      }
    }

    return yield* this.chatStream(
      messages,
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
    options?: {
      chatHistory?: ChatMessage[];
      fullGeneratedDays?: WorkoutDayData[];
    },
    signal?: AbortSignal
  ): Promise<WorkoutDayData | null> {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS.planCreationSingleDay,
    };

    // Build messages array with chat history if provided
    const messages: ChatMessage[] = [systemMessage];
    
    // Include full chat history if provided (this includes user's answers about equipment, injuries, etc.)
    if (options?.chatHistory && options.chatHistory.length > 0) {
      messages.push(...options.chatHistory);
    }

    // Build previous days summary with full details if available
    let previousDaysSummary = 'No previous days generated yet.';
    if (options?.fullGeneratedDays && options.fullGeneratedDays.length > 0) {
      previousDaysSummary = options.fullGeneratedDays.map(day => {
        const exercisesDetail = day.exercises.map(ex => {
          let detail = ex.name;
          if (ex.exerciseType === 'strength' || ex.exerciseType === 'tempo') {
            detail += `: ${ex.sets}×${ex.reps} @ ${ex.weightValue}${ex.weightType === '1RM' ? '% 1RM' : ex.weightType === 'BW' ? '% BW' : ' lbs'}`;
          } else if (ex.exerciseType === 'cardio_time' || ex.exerciseType === 'mobility_time') {
            detail += `: ${ex.duration} min`;
          } else if (ex.exerciseType === 'distance') {
            detail += `: ${ex.sets}×${ex.distance}${ex.distanceUnit || 'm'} @ ${ex.weightValue}${ex.weightType === 'BW' ? '% BW' : ' lbs'}`;
          } else if (ex.exerciseType === 'amrap' || ex.exerciseType === 'emom') {
            detail += `: ${ex.timeCap ? Math.floor(ex.timeCap / 60) : 'N/A'} min, ${ex.reps} reps/round`;
          } else if (ex.exerciseType === 'tabata') {
            detail += `: ${ex.sets} rounds, ${ex.reps} reps/round`;
          }
          return detail;
        }).join('; ');
        return `${day.dayName} (${day.workoutType}): ${exercisesDetail}`;
      }).join('\n\n');
    } else if (previousDays.length > 0) {
      // Fallback to simple summary if full days not provided
      previousDaysSummary = previousDays.map(d => `${d.dayName} (${d.workoutType}): ${d.exerciseNames.join(', ')}`).join('\n');
    }

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

Previously generated days this week (with full exercise details):
${previousDaysSummary}

Output ONLY the JSON with exercises array for this day. No additional text.
`;

    messages.push({ role: 'user', content: userMessage });

    const response = await this.chat(
      messages,
      { temperature: 0.7, maxTokens: 8192 }
    );

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
          weightType: z.string(), // ONLY use: ABSOLUTE, BW, or 1RM
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
