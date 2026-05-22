import { prisma } from './db';

// ─── Public shapes (serializable — passed straight to the client) ────────────

/** How a lift's progress is measured, derived from its exercise type. */
export type MetricKind = 'strength' | 'distance' | 'time' | 'rounds' | 'simple';

/** One calendar day of work for a single lift (sets merged across sessions). */
export interface LiftSessionPoint {
  date: string; // YYYY-MM-DD
  topWeight: number | null;
  est1RM: number | null;
  volume: number | null; // weight × reps, summed
  totalReps: number | null; // bodyweight fallback
  maxReps: number | null;
  maxDistance: number | null;
  maxDuration: number | null; // seconds
  rounds: number | null;
  setSummary: string;
}

export interface LiftHistory {
  name: string;
  exerciseType: string;
  metricKind: MetricKind;
  unit: string; // weight or distance unit; '' for time/rounds/simple
  isBodyweight: boolean; // strength lift with no external load recorded
  sessionCount: number;
  lastDate: string;
  /** Primary metric across time — used for the headline + delta + default chart. */
  current: number | null;
  best: number | null;
  first: number | null;
  points: LiftSessionPoint[]; // chronological ascending
}

export interface HistorySummary {
  liftsTracked: number;
  totalWorkouts: number;
  totalVolume: number; // lbs (kg converted), strength only
}

export interface HistoryData {
  summary: HistorySummary;
  lifts: LiftHistory[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KG_TO_LBS = 2.20462;

function metricKindFor(exerciseType: string): MetricKind {
  switch (exerciseType) {
    case 'strength':
      return 'strength';
    case 'distance':
      return 'distance';
    case 'time':
      return 'time';
    case 'amrap':
    case 'emom':
    case 'round_block':
    case 'tabata':
      return 'rounds';
    default:
      return 'simple';
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Epley estimated 1-rep max. */
function epley(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Per-day accumulator collecting raw sets before we collapse them into a point.
interface Bucket {
  strengthSets: { weight: number; reps: number }[];
  distances: number[];
  durations: number[];
  rounds: { rounds: number; time: number }[];
  simple: boolean;
}

function emptyBucket(): Bucket {
  return { strengthSets: [], distances: [], durations: [], rounds: [], simple: false };
}

interface LiftAcc {
  name: string;
  exerciseType: string;
  metricKind: MetricKind;
  unit: string;
  byDate: Map<string, Bucket>;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export async function getHistory(userId: string): Promise<HistoryData> {
  const sessions = await prisma.workoutSession.findMany({
    where: { userId, status: 'completed' },
    orderBy: { workoutDate: 'asc' },
    select: {
      workoutDate: true,
      entries: {
        select: {
          data: true,
          exercise: { select: { name: true, exerciseType: true, config: true } },
        },
      },
    },
  });

  const lifts = new Map<string, LiftAcc>();
  let totalVolume = 0;

  for (const session of sessions) {
    const dateStr = session.workoutDate.toISOString().slice(0, 10);

    for (const entry of session.entries) {
      const exercise = entry.exercise;
      if (!exercise) continue;

      const name = exercise.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const metricKind = metricKindFor(exercise.exerciseType);
      const config = (exercise.config ?? {}) as Record<string, unknown>;
      const data = (entry.data ?? {}) as Record<string, unknown>;

      let acc = lifts.get(key);
      if (!acc) {
        acc = {
          name,
          exerciseType: exercise.exerciseType,
          metricKind,
          unit:
            metricKind === 'strength'
              ? (config.weightUnit as string) || 'lbs'
              : metricKind === 'distance'
                ? (config.distanceUnit as string) || 'mi'
                : '',
          byDate: new Map(),
        };
        lifts.set(key, acc);
      }

      let bucket = acc.byDate.get(dateStr);
      if (!bucket) {
        bucket = emptyBucket();
        acc.byDate.set(dateStr, bucket);
      }

      const sets = Array.isArray(data.sets) ? (data.sets as Record<string, unknown>[]) : [];

      switch (metricKind) {
        case 'strength': {
          const unit = (sets[0]?.weightUnit as string) || acc.unit;
          for (const s of sets) {
            const reps = num(s.reps);
            const weight = num(s.weight);
            if (reps === null || reps <= 0) continue;
            const w = weight ?? 0;
            bucket.strengthSets.push({ weight: w, reps });
            const lbs = unit === 'kg' ? w * KG_TO_LBS : w;
            totalVolume += lbs * reps;
          }
          break;
        }
        case 'distance': {
          for (const s of sets) {
            const d = num(s.distance);
            const dur = num(s.durationSeconds);
            if (d !== null && d > 0) bucket.distances.push(d);
            if (dur !== null && dur > 0) bucket.durations.push(dur);
          }
          break;
        }
        case 'time': {
          for (const s of sets) {
            const dur = num(s.durationSeconds);
            if (dur !== null && dur > 0) bucket.durations.push(dur);
          }
          break;
        }
        case 'rounds': {
          const r = num(data.roundsCompleted);
          const t = num(data.timeElapsed);
          if (r !== null) bucket.rounds.push({ rounds: r, time: t ?? 0 });
          break;
        }
        default: {
          if (data.completed !== false) bucket.simple = true;
        }
      }
    }
  }

  const result: LiftHistory[] = [];

  for (const acc of lifts.values()) {
    const points: LiftSessionPoint[] = [];
    for (const [date, b] of [...acc.byDate.entries()].sort((a, z) => a[0].localeCompare(z[0]))) {
      const point = buildPoint(date, acc.metricKind, b, acc.unit);
      if (point) points.push(point);
    }
    if (points.length === 0) continue;

    const isBodyweight =
      acc.metricKind === 'strength' && points.every((p) => (p.topWeight ?? 0) <= 0);

    const primary = (p: LiftSessionPoint): number | null => primaryMetric(acc.metricKind, isBodyweight, p);
    const values = points.map(primary).filter((v): v is number => v !== null);

    result.push({
      name: acc.name,
      exerciseType: acc.exerciseType,
      metricKind: acc.metricKind,
      unit: acc.unit,
      isBodyweight,
      sessionCount: points.length,
      lastDate: points[points.length - 1].date,
      current: values.length ? values[values.length - 1] : null,
      first: values.length ? values[0] : null,
      best: values.length ? Math.max(...values) : null,
      points,
    });
  }

  // Most recently performed first.
  result.sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  return {
    summary: {
      liftsTracked: result.length,
      totalWorkouts: sessions.length,
      totalVolume: Math.round(totalVolume),
    },
    lifts: result,
  };
}

function primaryMetric(kind: MetricKind, isBodyweight: boolean, p: LiftSessionPoint): number | null {
  switch (kind) {
    case 'strength':
      return isBodyweight ? p.totalReps : p.topWeight;
    case 'distance':
      return p.maxDistance;
    case 'time':
      return p.maxDuration;
    case 'rounds':
      return p.rounds;
    default:
      return null;
  }
}

function buildPoint(
  date: string,
  kind: MetricKind,
  b: Bucket,
  unit: string,
): LiftSessionPoint | null {
  const base: LiftSessionPoint = {
    date,
    topWeight: null,
    est1RM: null,
    volume: null,
    totalReps: null,
    maxReps: null,
    maxDistance: null,
    maxDuration: null,
    rounds: null,
    setSummary: '',
  };

  switch (kind) {
    case 'strength': {
      if (b.strengthSets.length === 0) return null;
      base.topWeight = round1(Math.max(...b.strengthSets.map((s) => s.weight)));
      base.est1RM = round1(Math.max(...b.strengthSets.map((s) => epley(s.weight, s.reps))));
      base.volume = round1(b.strengthSets.reduce((sum, s) => sum + s.weight * s.reps, 0));
      base.totalReps = b.strengthSets.reduce((sum, s) => sum + s.reps, 0);
      base.maxReps = Math.max(...b.strengthSets.map((s) => s.reps));
      base.setSummary = b.strengthSets
        .map((s) => (s.weight > 0 ? `${round1(s.weight)}×${s.reps}` : `${s.reps}`))
        .join(', ');
      return base;
    }
    case 'distance': {
      if (b.distances.length === 0) return null;
      base.maxDistance = round1(Math.max(...b.distances));
      base.setSummary = b.distances.map((d) => `${round1(d)} ${unit}`).join(', ');
      return base;
    }
    case 'time': {
      if (b.durations.length === 0) return null;
      base.maxDuration = Math.max(...b.durations);
      base.setSummary = b.durations.map((d) => fmtDuration(d)).join(', ');
      return base;
    }
    case 'rounds': {
      if (b.rounds.length === 0) return null;
      const best = b.rounds.reduce((a, z) => (z.rounds > a.rounds ? z : a));
      base.rounds = best.rounds;
      base.setSummary = best.time > 0
        ? `${best.rounds} rounds · ${fmtDuration(best.time)}`
        : `${best.rounds} rounds`;
      return base;
    }
    default: {
      if (!b.simple) return null;
      base.setSummary = 'Completed';
      return base;
    }
  }
}

function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}:${String(rem).padStart(2, '0')}`;
}
