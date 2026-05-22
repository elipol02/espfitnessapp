'use client';

import { useId, useMemo, useState } from 'react';
import { ChevronDown, Search, TrendingUp, Dumbbell, Trophy, Activity } from 'lucide-react';
import { EmptyState } from '@/app/components/EmptyState';
import { useRestTimer } from '@/app/components/RestTimerBadge';
import type { HistoryData, LiftHistory, LiftSessionPoint, MetricKind } from '@/app/lib/history';

type SortMode = 'recent' | 'name' | 'sessions' | 'weight';
type TimeRange = '2w' | '1m' | '3m' | '6m' | '1y' | 'all';

const TIME_RANGES: ReadonlyArray<readonly [TimeRange, string]> = [
  ['2w', '2W'],
  ['1m', '1M'],
  ['3m', '3M'],
  ['6m', '6M'],
  ['1y', '1Y'],
  ['all', 'All'],
];

interface MetricDef {
  key: string;
  label: string;
  pick: (p: LiftSessionPoint) => number | null;
}

const TYPE_LABELS: Record<string, string> = {
  strength: 'Strength',
  distance: 'Distance',
  time: 'Time',
  amrap: 'AMRAP',
  emom: 'EMOM',
  round_block: 'Rounds',
  tabata: 'Tabata',
  simple: 'Simple',
};

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtNum(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m === 0 ? `${rem}s` : `${m}:${String(rem).padStart(2, '0')}`;
}

function relDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  if (diff < 28) return `${Math.floor(diff / 7)}w ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function metricsFor(lift: LiftHistory): MetricDef[] {
  switch (lift.metricKind) {
    case 'strength':
      return lift.isBodyweight
        ? [
            { key: 'reps', label: 'Total reps', pick: (p) => p.totalReps },
            { key: 'best', label: 'Best set', pick: (p) => p.maxReps },
          ]
        : [
            { key: 'weight', label: 'Top weight', pick: (p) => p.topWeight },
            { key: '1rm', label: 'Est. 1RM', pick: (p) => p.est1RM },
            { key: 'volume', label: 'Volume', pick: (p) => p.volume },
          ];
    case 'distance':
      return [{ key: 'distance', label: 'Distance', pick: (p) => p.maxDistance }];
    case 'time':
      return [{ key: 'duration', label: 'Duration', pick: (p) => p.maxDuration }];
    case 'rounds':
      return [{ key: 'rounds', label: 'Rounds', pick: (p) => p.rounds }];
    default:
      return [];
  }
}

function formatMetric(kind: MetricKind, unit: string, isBodyweight: boolean, v: number | null): string {
  if (v === null || v === undefined) return '—';
  if (kind === 'time') return fmtDuration(v);
  if (kind === 'distance') return `${fmtNum(v)} ${unit}`;
  if (kind === 'rounds') return `${fmtNum(v)} rounds`;
  if (kind === 'strength') {
    if (isBodyweight) return `${fmtNum(v)} reps`;
    return `${fmtNum(v)} ${unit}`;
  }
  return fmtNum(v);
}

// ─── Time-range filtering ─────────────────────────────────────────────────────

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Earliest date (inclusive, YYYY-MM-DD) to keep for a range, or null for "all". */
function cutoffFor(range: TimeRange): string | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  switch (range) {
    case '2w': d.setDate(d.getDate() - 14); break;
    case '1m': d.setMonth(d.getMonth() - 1); break;
    case '3m': d.setMonth(d.getMonth() - 3); break;
    case '6m': d.setMonth(d.getMonth() - 6); break;
    case '1y': d.setFullYear(d.getFullYear() - 1); break;
    default: return null;
  }
  return ymd(d);
}

/** Restrict a lift to sessions on/after the cutoff, recomputing its summary fields.
 *  Returns null when nothing falls inside the window. */
function liftWithin(lift: LiftHistory, cutoff: string | null): LiftHistory | null {
  if (!cutoff) return lift;
  const points = lift.points.filter((p) => p.date >= cutoff);
  if (points.length === 0) return null;

  const primary = metricsFor(lift)[0];
  const values = primary
    ? points.map(primary.pick).filter((v): v is number => v !== null)
    : [];

  return {
    ...lift,
    sessionCount: points.length,
    lastDate: points[points.length - 1].date,
    current: values.length ? values[values.length - 1] : null,
    first: values.length ? values[0] : null,
    best: values.length ? Math.max(...values) : null,
    points,
  };
}

/** Heaviest top set across a lift's sessions; non-weighted lifts sort to the bottom. */
function weightKey(lift: LiftHistory): number {
  if (lift.metricKind !== 'strength' || lift.isBodyweight) return -1;
  let max = -1;
  for (const p of lift.points) {
    if (p.topWeight !== null && p.topWeight > max) max = p.topWeight;
  }
  return max;
}

// ─── Inline SVG chart (dependency-free) ──────────────────────────────────────

function Chart({
  values,
  variant,
}: {
  values: number[];
  variant: 'spark' | 'full';
}) {
  const gradId = useId();
  if (values.length === 0) return null;

  const full = variant === 'full';
  const W = full ? 320 : 120;
  const H = full ? 150 : 40;
  const padX = full ? 8 : 3;
  const padT = full ? 14 : 5;
  const padB = full ? 14 : 5;
  const innerW = W - padX * 2;
  const innerH = H - padT - padB;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const n = values.length;
  const xAt = (i: number) => (n <= 1 ? padX + innerW / 2 : padX + (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * innerH;
  const baseline = padT + innerH;

  const pts = values.map((v, i) => [xAt(i), yAt(v)] as const);
  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath =
    n >= 2
      ? `${linePath} L ${pts[n - 1][0].toFixed(1)} ${baseline} L ${pts[0][0].toFixed(1)} ${baseline} Z`
      : '';
  const last = pts[n - 1];
  const color = 'var(--primary)';

  // Uniform scaling (default preserveAspectRatio) keeps the emphasis dots round;
  // non-scaling-stroke keeps the line crisp regardless of container width.
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color }} stopOpacity={full ? 0.28 : 0.22} />
          <stop offset="100%" style={{ stopColor: color }} stopOpacity="0" />
        </linearGradient>
      </defs>
      {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
      {n >= 2 && (
        <path
          d={linePath}
          fill="none"
          style={{ stroke: color }}
          strokeWidth={full ? 2 : 1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {full &&
        pts.slice(0, -1).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.25} style={{ fill: color }} />)}
      {/* Always emphasize the latest point */}
      <circle cx={last[0]} cy={last[1]} r={full ? 3.5 : 2.75} style={{ fill: color }} />
    </svg>
  );
}

// ─── Lift card ───────────────────────────────────────────────────────────────

function LiftCard({ lift }: { lift: LiftHistory }) {
  const metrics = metricsFor(lift);
  const [open, setOpen] = useState(false);
  const [metricKey, setMetricKey] = useState(metrics[0]?.key ?? '');

  // The React Compiler memoizes these automatically — no manual useMemo needed.
  const primary = metrics[0];
  const sparkValues = primary
    ? lift.points.map(primary.pick).filter((v): v is number => v !== null)
    : [];

  const headline = primary
    ? formatMetric(lift.metricKind, lift.unit, lift.isBodyweight, lift.current)
    : `${lift.sessionCount} done`;

  const delta = lift.current !== null && lift.first !== null ? lift.current - lift.first : null;
  const showDelta = delta !== null && lift.sessionCount > 1 && lift.metricKind !== 'simple';

  // Selected-metric series + PR detection for the expanded view.
  const selected = metrics.find((m) => m.key === metricKey) ?? primary;
  const series = selected
    ? lift.points
        .map((p) => ({ value: selected.pick(p), date: p.date, summary: p.setSummary }))
        .filter((s): s is { value: number; date: string; summary: string } => s.value !== null)
    : [];

  const prDates = new Set<string>();
  if (selected) {
    let runningMax = -Infinity;
    let started = false;
    for (const p of lift.points) {
      const v = selected.pick(p);
      if (v === null) continue;
      if (started && v > runningMax) prDates.add(p.date);
      runningMax = Math.max(runningMax, v);
      started = true;
    }
  }

  return (
    <div className="bg-surface rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-surface-elevated transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground truncate">{lift.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-background px-1.5 py-0.5 rounded shrink-0">
              {TYPE_LABELS[lift.exerciseType] ?? lift.exerciseType}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lift.sessionCount} {lift.sessionCount === 1 ? 'session' : 'sessions'} · {relDate(lift.lastDate)}
          </p>
        </div>

        {sparkValues.length > 1 && (
          <div className="w-[88px] shrink-0 opacity-90">
            <Chart values={sparkValues} variant="spark" />
          </div>
        )}

        <div className="text-right shrink-0 min-w-[56px]">
          <div className="font-bold text-foreground leading-tight">{headline}</div>
          {showDelta && (
            <div
              className={`text-xs font-medium ${
                delta! > 0 ? 'text-success' : delta! < 0 ? 'text-muted-foreground' : 'text-muted-foreground'
              }`}
            >
              {delta! > 0 ? '▲' : delta! < 0 ? '▼' : ''}{' '}
              {formatMetric(lift.metricKind, lift.unit, lift.isBodyweight, Math.abs(delta!))}
            </div>
          )}
        </div>

        <ChevronDown
          size={18}
          className={`text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 animate-fade-in border-t border-border">
          {metrics.length > 1 && (
            <div className="flex bg-background rounded-lg p-1 mt-3">
              {metrics.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMetricKey(m.key)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    selected?.key === m.key ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {series.length > 0 && selected ? (
            <div className={metrics.length > 1 ? '' : 'mt-3'}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{selected.label}</span>
                <span className="text-muted-foreground">
                  Best{' '}
                  <span className="text-foreground font-medium">
                    {formatMetric(
                      lift.metricKind,
                      lift.unit,
                      lift.isBodyweight,
                      Math.max(...series.map((s) => s.value)),
                    )}
                  </span>
                </span>
              </div>
              <Chart values={series.map((s) => s.value)} variant="full" />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
                <span>{relDate(series[0].date)}</span>
                <span>{relDate(series[series.length - 1].date)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mt-3">Completed on the dates below.</p>
          )}

          {/* Session-by-session log, newest first */}
          <div className="space-y-1.5">
            {[...lift.points].reverse().map((p) => {
              const v = selected?.pick(p) ?? null;
              const isPR = prDates.has(p.date);
              return (
                <div key={p.date} className="flex items-center gap-2 text-sm py-1.5 border-b border-border/40 last:border-0">
                  <span className="text-muted-foreground w-20 shrink-0">{relDate(p.date)}</span>
                  <span className="text-foreground flex-1 min-w-0 truncate">{p.setSummary}</span>
                  {isPR && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-warning shrink-0">
                      <Trophy size={11} /> PR
                    </span>
                  )}
                  {selected && v !== null && (
                    <span className="text-foreground font-medium shrink-0 tabular-nums">
                      {formatMetric(lift.metricKind, lift.unit, lift.isBodyweight, v)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function HistoryContent({ data }: { data: HistoryData }) {
  const restTimer = useRestTimer();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [range, setRange] = useState<TimeRange>('all');

  // Restrict every lift to the chosen window, then derive a summary that tracks
  // the same window so the headline stats move with the filter.
  const { lifts, summary } = useMemo(() => {
    const cutoff = cutoffFor(range);
    const ranged = data.lifts
      .map((l) => liftWithin(l, cutoff))
      .filter((l): l is LiftHistory => l !== null);

    const dates = new Set<string>();
    let volume = 0;
    for (const l of ranged) {
      for (const p of l.points) {
        dates.add(p.date);
        if (l.metricKind === 'strength' && !l.isBodyweight && p.volume) volume += p.volume;
      }
    }
    const summary = {
      liftsTracked: ranged.length,
      totalWorkouts: dates.size,
      totalVolume: Math.round(volume),
    };

    const q = query.trim().toLowerCase();
    const filtered = q ? ranged.filter((l) => l.name.toLowerCase().includes(q)) : ranged;
    const sorted = [...filtered];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'sessions') sorted.sort((a, b) => b.sessionCount - a.sessionCount);
    else if (sort === 'weight') sorted.sort((a, b) => weightKey(b) - weightKey(a));
    else sorted.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
    return { lifts: sorted, summary };
  }, [data.lifts, query, sort, range]);

  if (data.lifts.length === 0) {
    return (
      <div className="px-5 pt-8 pb-28">
        <div className="max-w-lg mx-auto space-y-8">
          <h1 className="text-2xl font-bold text-foreground">Progress</h1>
          <EmptyState
            icon="📈"
            title="No history yet"
            description="Complete a workout and your lifts will show up here, tracked over time."
            actionLabel="Go to Home"
            actionHref="/home"
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="max-w-lg mx-auto">
          {/* Title + sort */}
          <div className="px-5 pt-3 pb-2 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-foreground truncate min-w-0">Progress</h1>
            <div className={`flex bg-surface rounded-lg p-0.5 shrink-0 transition-all duration-200 ${restTimer !== null ? 'mr-20' : ''}`}>
              {([
                ['recent', 'Recent'],
                ['name', 'A–Z'],
                ['sessions', 'Top'],
                ['weight', 'Weight'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSort(key)}
                  className={`px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                    sort === key ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Time range */}
          <div className="px-5 pb-3">
            <div className="flex bg-surface rounded-lg p-0.5">
              {TIME_RANGES.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setRange(key)}
                  className={`flex-1 px-1 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                    range === key ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="max-w-lg mx-auto space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center text-center">
              <Dumbbell className="w-5 h-5 text-primary mb-2" />
              <span className="text-2xl font-bold text-foreground">{summary.liftsTracked}</span>
              <span className="text-xs text-muted-foreground mt-1">Lifts</span>
            </div>
            <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center text-center">
              <Activity className="w-5 h-5 text-success mb-2" />
              <span className="text-2xl font-bold text-foreground">{summary.totalWorkouts}</span>
              <span className="text-xs text-muted-foreground mt-1">Workouts</span>
            </div>
            <div className="bg-surface rounded-xl p-4 flex flex-col items-center justify-center text-center">
              <TrendingUp className="w-5 h-5 text-warning mb-2" />
              <span className="text-2xl font-bold text-foreground">
                {summary.totalVolume >= 1000
                  ? `${(summary.totalVolume / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`
                  : summary.totalVolume}
              </span>
              <span className="text-xs text-muted-foreground mt-1">Volume (lbs)</span>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lifts"
              className="w-full bg-surface rounded-xl pl-9 pr-3 py-2.5 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Lift list */}
          {lifts.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {query.trim() ? `No lifts match “${query}”.` : 'No workouts logged in this time range.'}
            </p>
          ) : (
            <div className="space-y-2.5">
              {lifts.map((lift) => (
                <LiftCard key={lift.name} lift={lift} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
