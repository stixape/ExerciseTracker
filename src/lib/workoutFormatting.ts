import type { BandColour, MetricMode, Modifier, SessionSet, SetValues } from '../domain/types';
import { formatModifierValues } from '../domain/modifiers';

export function formatSetActual(set: SessionSet, bandColours: BandColour[], modifiers?: Modifier[]): string {
  if (set.mode === 'other') return formatModifierValues(set.actual, modifiers) || 'Set completed';
  if (set.mode === 'weighted_reps') return `${set.actual.weightKg ?? 0} kg x ${formatActualReps(set)}`;
  if (set.mode === 'timed_hold') return `${set.actual.seconds ?? 0}s`;
  return `${formatBandNames(set.actual.bandColourIds ?? [], bandColours)} x ${formatActualReps(set)}`;
}

export function formatPlannedValues(mode: MetricMode, values: SetValues, bands: BandColour[], modifiers?: Modifier[]): string {
  if (mode === 'other') return formatModifierValues(values, modifiers) || 'Open targets';
  if (mode === 'timed_hold') return `${values.seconds ?? 0}s`;
  const load = mode === 'weighted_reps' ? `${values.weightKg ?? 0} KG` : formatBandNames(values.bandColourIds ?? [], bands);
  return `${load} · ${values.reps ?? 0} repetitions`;
}

export function formatActualReps(set: SessionSet): string {
  return String(set.actual.reps ?? 0);
}

export function formatBandNames(ids: string[], bandColours: BandColour[]): string {
  if (!ids.length) return 'No band';
  const selectedIds = new Set(ids);
  const names = bandColours.filter((band) => selectedIds.has(band.id)).map((band) => band.name);
  const knownIds = new Set(bandColours.map((band) => band.id));
  names.push(...ids.filter((id) => !knownIds.has(id)).map(() => 'Unknown'));
  return names.join(' + ');
}
