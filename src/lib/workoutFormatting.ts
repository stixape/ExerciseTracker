import type { BandColour, SessionSet } from '../domain/types';

export function formatSetActual(set: SessionSet, bandColours: BandColour[]): string {
  if (set.mode === 'weighted_reps') return `${set.actual.weightKg ?? 0} kg x ${formatActualReps(set)}`;
  if (set.mode === 'timed_hold') return `${set.actual.seconds ?? 0}s`;
  return `${formatBandNames(set.actual.bandColourIds ?? [], bandColours)} x ${formatActualReps(set)}`;
}

export function formatActualReps(set: SessionSet): string {
  return String(set.actual.reps ?? 0);
}

export function formatBandNames(ids: string[], bandColours: BandColour[]): string {
  if (!ids.length) return 'No band';
  return ids.map((id) => bandColours.find((band) => band.id === id)?.name ?? 'Unknown').join(' + ');
}
