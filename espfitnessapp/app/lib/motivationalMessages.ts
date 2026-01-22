/**
 * Motivational Messages System
 * 
 * Returns a message based on:
 * - Program progress percentage (0-100%) - how far through the program you are
 * - Workout completion rate (0-100%) - percentage of scheduled workouts completed
 * 
 * Completion rate tiers (HIGH STANDARDS):
 * - 95-100%: Elite (PRAISE ONLY)
 * - 75-94%: Mediocre (critical)
 * - 50-74%: Bad (harsh)
 * - 0-49%: Terrible (brutal insults)
 * 
 * Progress phases:
 * - 0-25%: Early stage
 * - 25-50%: Building to halfway
 * - 50-75%: Past halfway
 * - 75-99%: Almost there
 * - 100%: Completed
 */

interface MessageConfig {
  progressRange: [number, number]; // How far through the program (0-100%)
  completionRange: [number, number]; // Workout completion rate (0-100%)
  messages: string[];
}

const MESSAGE_POOL: MessageConfig[] = [
  // 0-25% PROGRESS (EARLY STAGE)
  {
    progressRange: [0, 2],
    completionRange: [0, 100],
    messages: [
      "There is hard work ahead",
      "You have one chance to achieve greatness",
      "This is the beginning",
      "Start your engines nigga",
    ]
  },
  {
    progressRange: [3, 25],
    completionRange: [100, 100],
    messages: [
      "Starting strong 💪",
      "Perfect start, keep this energy",
      "You're locked in from day one",
      "Elite mindset already",
      "This is how champions begin",
      "Flawless execution",
      "Unstoppable momentum",
    ]
  },
  {
    progressRange: [3, 25],
    completionRange: [75, 99],
    messages: [
      "Lukewarm start",
      "You're already slipping",
      "Half-assing detected",
      "Barely acceptable",
      "Not impressive",
      "Your potential is being wasted",
    ]
  },
  {
    progressRange: [3, 25],
    completionRange: [50, 74],
    messages: [
      "Pathetic first week energy",
      "Already making excuses?",
      "This is embarrassing already",
      "You're failing before you started",
      "Mediocrity detected early",
      "Zero discipline",
    ]
  },
  {
    progressRange: [3, 25],
    completionRange: [1, 49],
    messages: [
      "You are a fat chud",
      "Your couch misses you",
      "Professional time waster",
      "Absolutely disgraceful",
      "Delete the app, save us both time",
      "You're basically furniture",
      "Please kill yourself",
    ]
  },


  // 25-50% PROGRESS (BUILDING TO HALFWAY)
  {
    progressRange: [25, 50],
    completionRange: [100, 100],
    messages: [
      "You're crushing it",
      "Beast mode activated",
      "Consistency is your weapon",
      "This is dominance",
      "Halfway there and dominating",
      "Elite warrior energy",
      "Nigga built different",
    ]
  },
  {
    progressRange: [25, 50],
    completionRange: [75, 99],
    messages: [
      "Your laziness is showing",
      "Halfway to mediocrity",
      "This is getting embarrassing",
      "Aggressively mediocre",
      "Wake up",
    ]
  },
  {
    progressRange: [25, 50],
    completionRange: [50, 74],
    messages: [
      "You're a quitter in slow motion",
      "This is disgraceful",
      "Failure is your comfort zone",
      "You've accomplished nothing",
      "Living down to expectations",
      "This is pathetic",
    ]
  },
  {
    progressRange: [25, 50],
    completionRange: [0, 49],
    messages: [
      "Halfway through wasting time",
      "You're a complete failure",
      "Delete yourseld",
      "Pure disappointment",
      "Just give up already",
      "Absolute trainwreck",
    ]
  },

  // 50-75% PROGRESS (PAST HALFWAY)
  {
    progressRange: [50, 75],
    completionRange: [100, 100],
    messages: [
      "Past halfway and perfect",
      "You're ascending",
      "Nothing stops you",
      "This is greatness",
      "You're in beast mode",
      "Elite performance",
      "Legendary grind",
      "Nigga is off the chain",
    ]
  },
  {
    progressRange: [50, 75],
    completionRange: [75, 99],
    messages: [
      "Still mediocre",
      "This is almost sad",
      "Your potential s dying",
      "Underwhelming",
      "You're wasting time",
      "Not your best effort",
    ]
  },
  {
    progressRange: [50, 75],
    completionRange: [50, 74],
    messages: [
      "Over halfway to nowhere",
      "This is pathetic",
      "Still failing after all this time",
      "Professional underachiever",
      "Zero improvement",
      "You're hopeless",
    ]
  },
  {
    progressRange: [50, 75],
    completionRange: [0, 49],
    messages: [
      "You're a walking L",
      "Your failure is art",
      "Just stop",
      "Complete waste",
      "Uninstall",
      "60% wasted",
      "This is a disaster",
    ]
  },

  // 75-99% PROGRESS (ALMOST THERE)
  {
    progressRange: [75, 99],
    completionRange: [100, 100],
    messages: [
      "Almost there, perfect execution",
      "You are ascending",
      "Final stretch dominance",
      "Final push, stay strong",
      "So close to greatness",
      "Absolutely elite",
      "White Ass Nigga Going Hard As Fuck",
    ]
  },
  {
    progressRange: [75, 99],
    completionRange: [75, 99],
    messages: [
      "So close yet not there",
      "Fumbling at the finish",
      "This is your legacy?",
      "Tragically average",
      "You had one job",
    ]
  },
  {
    progressRange: [75, 99],
    completionRange: [50, 74],
    messages: [
      "Clown behavior all program",
      "Masterclass in failure",
      "How are you this bad?",
      "You've learned zero",
      "This is embarrassing",
      "This is why the Goys are losing",
    ]
  },
  {
    progressRange: [75, 99],
    completionRange: [0, 49],
    messages: [
      "Almost done, still a failure",
      "You're a living L",
      "This is historically bad",
      "Your failure is legendary",
      "Delete yourself",
    ]
  },

  // 100% PROGRESS (COMPLETED)
  {
    progressRange: [100, 100],
    completionRange: [95, 100],
    messages: [
      "CHAMPION",
      "Fucking Legend",
      "You are inevitable",
      "This is greatness",
      "Absolutely unstoppable",
      "Hall of fame worthy",
      "You've achieved mastery",
      "ASCENDED",
    ]
  },
  {
    progressRange: [100, 100],
    completionRange: [75, 94],
    messages: [
      "Barely scraped through",
      "The bare minimum king",
      "You finished... technically",
      "Peak mediocrity achieved",
      "This doesn't count",
      "Are you a retarded person?",
    ]
  },
  {
    progressRange: [100, 100],
    completionRange: [50, 74],
    messages: [
      "Finished but not really",
      "You've learned nothing",
      "Somehow got worse",
      "This is embarrassing",
      "Congrats on nothing",
    ]
  },
  {
    progressRange: [100, 100],
    completionRange: [0, 49],
    messages: [
      "You wasted everyone's time",
      "Uninstall immediately",
      "Generational curse",
      "You're a living L",
      "Commit suicide",
      "Retard Goy",
    ]
  },
];

/**
 * Get a motivational message based on program progress
 * @param progressPercentage - How far through the program (0-100%)
 * @param completionRate - Percentage of scheduled workouts completed (0-100%)
 */
export function getMotivationalMessage(
  progressPercentage: number,
  completionRate: number
): string {
  // Find matching message configs
  const matches = MESSAGE_POOL.filter(config => {
    const inProgressRange = progressPercentage >= config.progressRange[0] && 
                           progressPercentage <= config.progressRange[1];
    const inCompletionRange = completionRate >= config.completionRange[0] && 
                              completionRate <= config.completionRange[1];
    return inProgressRange && inCompletionRange;
  });

  if (matches.length === 0) {
    // Fallback message if no match found
    return "Keep going";
  }

  // Pick a random config from matches
  const selectedConfig = matches[Math.floor(Math.random() * matches.length)];
  
  // Pick a random message from that config
  const messages = selectedConfig.messages;
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Calculate completion rate based on workout stats
 * @returns Percentage of scheduled workouts completed (0-100%)
 */
export function calculateCompletionRate(
  completedWorkouts: number,
  totalScheduledWorkouts: number
): number {
  if (totalScheduledWorkouts === 0) return 0;
  return Math.round((completedWorkouts / totalScheduledWorkouts) * 100);
}

/**
 * Calculate program progress percentage based on time elapsed
 * @returns Percentage of program duration completed (0-100%)
 */
export function calculateProgressPercentage(
  startDate: string | Date,
  durationWeeks: number
): number {
  const start = new Date(startDate);
  const now = new Date();
  const totalDays = durationWeeks * 7;
  const daysPassed = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysPassed < 0) return 0;
  if (daysPassed >= totalDays) return 100;
  
  return Math.round((daysPassed / totalDays) * 100);
}
