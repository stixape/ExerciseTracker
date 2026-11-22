import type { BandColour, Modifier, SessionSet, TemplateExercise } from '../domain/types';
import { formatModifierValues } from '../domain/modifiers';
import { formatTargetRange } from '../domain/targetRange';

export function formatSetActual(set: SessionSet, bandColours: BandColour[], modifiers?: Modifier[]): string {
  if (set.mode === 'other') return formatModifierValues(set.actual, modifiers) || 'Set completed';
  if (set.mode === 'weighted_reps') return `${set.actual.weightKg ?? 0} kg x ${formatActualReps(set)}`;
  if (set.mode === 'timed_hold') return `${set.actual.seconds ?? 0}s`;
  return `${formatBandNames(set.actual.bandColourIds ?? [], bandColours)} x ${formatActualReps(set)}`;
}

export function formatPlannedSets(exercise: TemplateExercise, bands: BandColour[]): string {
  const { mode } = exercise;
  const groups: { load: string; measure: string; count: number }[] = [];
  for (const set of exercise.sets) {
    const { target, rangeMax } = set;
    let load = '';
    let measure: string;
    if (mode === 'other') {
      measure = formatModifierValues(target, exercise.modifiers) || 'Open targets';
    } else if (mode === 'timed_hold') {
      measure = formatTargetRange(target.seconds ?? 0, rangeMax) + 's';
    } else {
      const bandIds = target.bandColourIds ?? [];
      if (mode === 'weighted_reps' && target.weightKg !== undefined) load = target.weightKg + ' KG';
      if (mode === 'band_reps' && bandIds.length) load = formatBandNames(bandIds, bands);
      measure = formatTargetRange(target.reps ?? 0, rangeMax);
    }
    const previous = groups.at(-1);
    if (previous?.load === load && previous.measure === measure) previous.count++;
    else groups.push({ load, measure, count: 1 });
  }
  return groups.map(({ load, measure, count }) => {
    if (mode === 'other') return `${count} ${count === 1 ? 'set' : 'sets'} - ${measure}`;
    return `${load ? load + ' - ' : ''}${count}x${measure}`;
  }).join(' · ');
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
