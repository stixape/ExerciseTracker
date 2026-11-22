import type { MetricMode, SessionSet, WorkoutSession } from './types';

export interface TargetRange {
  min: number;
  max?: number;
}

export function rangeMetric(mode: MetricMode): 'reps' | 'seconds' | undefined {
  if (mode === 'timed_hold') return 'seconds';
  if (mode === 'weighted_reps' || mode === 'band_reps') return 'reps';
}

export function formatTargetRange(min: number, max?: number): string {
  return max === undefined ? String(min) : min + '-' + max;
}

export function getRecordedRangeMax(session: WorkoutSession, set: SessionSet): number | undefined {
  return session.snapshot.exercises[set.exerciseIndex]?.sets.find((item) => item.id === set.templateSetId)?.rangeMax;
}

export function parseTargetRange(text: string, seconds = false): TargetRange | undefined {
  const value = seconds ? text.trim().replace(/\s*s$/i, '') : text.trim();
  const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/u.exec(value);
  if (!match) return undefined;
  const min = Number(match[1]);
  if (!Number.isSafeInteger(min)) return undefined;
  if (match[2] === undefined) return { min };
  const max = Number(match[2]);
  if (!Number.isSafeInteger(max) || max < min) return undefined;
  return max === min ? { min } : { min, max };
}
