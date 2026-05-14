import type { MetricMode, SetValues } from './types';

export function validateSetValues(mode: MetricMode, values: SetValues): string[] {
  const errors: string[] = [];

  if (mode === 'weighted_reps') {
    if (values.weightKg === undefined || values.weightKg < 0) errors.push('Weight must be 0 kg or higher.');
    if (values.reps === undefined || values.reps < 0) errors.push('Reps must be 0 or higher.');
    if (values.leftReps !== undefined && values.leftReps < 0) errors.push('Left reps must be 0 or higher.');
    if (values.rightReps !== undefined && values.rightReps < 0) errors.push('Right reps must be 0 or higher.');
  }

  if (mode === 'timed_hold' && (values.seconds === undefined || values.seconds < 0)) {
    errors.push('Seconds must be 0 or higher.');
  }

  if (mode === 'band_reps') {
    if (!values.bandColourIds?.length) errors.push('Choose at least one band colour.');
    if (values.reps === undefined || values.reps < 0) errors.push('Reps must be 0 or higher.');
    if (values.leftReps !== undefined && values.leftReps < 0) errors.push('Left reps must be 0 or higher.');
    if (values.rightReps !== undefined && values.rightReps < 0) errors.push('Right reps must be 0 or higher.');
  }

  return errors;
}
