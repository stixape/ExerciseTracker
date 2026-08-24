import type { MetricMode, PlannedSetProgression, SetValues } from './types';

function isFiniteNonNegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function isWholeNonNegative(value: number | undefined): value is number {
  return isFiniteNonNegative(value) && Number.isInteger(value);
}

function validateSideReps(values: SetValues, errors: string[]): void {
  if (values.leftReps !== undefined && !isWholeNonNegative(values.leftReps)) {
    errors.push('Left reps must be a whole number of 0 or higher.');
  }
  if (values.rightReps !== undefined && !isWholeNonNegative(values.rightReps)) {
    errors.push('Right reps must be a whole number of 0 or higher.');
  }
}

function validateBandIds(ids: string[] | undefined, knownBandColourIds?: Iterable<string>): string[] {
  const errors: string[] = [];
  if (!ids?.length) return ['Choose at least one band colour.'];

  const knownIds = knownBandColourIds ? new Set(knownBandColourIds) : undefined;
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) {
      errors.push('Band choices must have valid IDs.');
      continue;
    }
    if (seen.has(id)) errors.push('Choose each band colour only once.');
    if (knownIds && !knownIds.has(id)) errors.push(`Band colour "${id}" is not available.`);
    seen.add(id);
  }
  return [...new Set(errors)];
}

export function validateSetValues(mode: MetricMode, values: SetValues, knownBandColourIds?: Iterable<string>): string[] {
  const errors: string[] = [];

  if (mode === 'weighted_reps') {
    if (!isFiniteNonNegative(values.weightKg)) errors.push('Weight must be a finite value of 0 kg or higher.');
    if (!isWholeNonNegative(values.reps)) errors.push('Reps must be a whole number of 0 or higher.');
    validateSideReps(values, errors);
  }

  if (mode === 'timed_hold' && !isWholeNonNegative(values.seconds)) {
    errors.push('Seconds must be a whole number of 0 or higher.');
  }

  if (mode === 'band_reps') {
    errors.push(...validateBandIds(values.bandColourIds, knownBandColourIds));
    if (!isWholeNonNegative(values.reps)) errors.push('Reps must be a whole number of 0 or higher.');
    validateSideReps(values, errors);
  }

  return errors;
}

export function validatePlannedSetProgression(
  mode: MetricMode,
  progression: PlannedSetProgression,
  knownBandColourIds?: Iterable<string>,
): string[] {
  const errors: string[] = [];
  if (progression.reps !== undefined && !isWholeNonNegative(progression.reps)) {
    errors.push('Next reps must be a whole number of 0 or higher.');
  }
  if (progression.leftReps !== undefined && !isWholeNonNegative(progression.leftReps)) {
    errors.push('Next left reps must be a whole number of 0 or higher.');
  }
  if (progression.rightReps !== undefined && !isWholeNonNegative(progression.rightReps)) {
    errors.push('Next right reps must be a whole number of 0 or higher.');
  }
  if (progression.seconds !== undefined && !isWholeNonNegative(progression.seconds)) {
    errors.push('Next seconds must be a whole number of 0 or higher.');
  }

  if (mode === 'weighted_reps') {
    if (progression.bandColourIds !== undefined) errors.push('Band progression can only be used for band exercises.');
    if (progression.seconds !== undefined) errors.push('Seconds progression can only be used for timed exercises.');
    if (progression.weightKg !== undefined && !isFiniteNonNegative(progression.weightKg)) {
      errors.push('Next weight must be a finite value of 0 kg or higher.');
    }
    return errors;
  }

  if (mode === 'band_reps') {
    if (progression.weightKg !== undefined) errors.push('Weight progression can only be used for weighted exercises.');
    if (progression.seconds !== undefined) errors.push('Seconds progression can only be used for timed exercises.');
    if (progression.bandColourIds !== undefined) errors.push(...validateBandIds(progression.bandColourIds, knownBandColourIds));
    return errors;
  }

  if (
    progression.weightKg !== undefined ||
    progression.reps !== undefined ||
    progression.leftReps !== undefined ||
    progression.rightReps !== undefined ||
    progression.bandColourIds !== undefined
  ) {
    errors.push('Timed exercises only support seconds progression.');
  }
  return errors;
}
