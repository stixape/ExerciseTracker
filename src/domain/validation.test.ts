import { describe, expect, it } from 'vitest';
import { validatePlannedSetProgression, validateSetValues } from './validation';

describe('set value validation', () => {
  it('accepts valid weighted reps', () => {
    expect(validateSetValues('weighted_reps', { weightKg: 42.5, reps: 8 })).toEqual([]);
  });

  it('rejects missing band choices', () => {
    expect(validateSetValues('band_reps', { reps: 12 })).toContain('Choose at least one band colour.');
  });

  it('rejects invalid timed holds', () => {
    expect(validateSetValues('timed_hold', { seconds: -1 })).toContain('Seconds must be a whole number of 0 or higher.');
  });

  it('rejects non-finite weights and fractional counts', () => {
    expect(validateSetValues('weighted_reps', { weightKg: Number.NaN, reps: 8 })).toContain(
      'Weight must be a finite value of 0 kg or higher.',
    );
    expect(validateSetValues('weighted_reps', { weightKg: 40, reps: 7.5 })).toContain(
      'Reps must be a whole number of 0 or higher.',
    );
  });

  it('checks band IDs against the configured choices', () => {
    expect(validateSetValues('band_reps', { reps: 12, bandColourIds: ['missing'] }, ['band_red'])).toContain(
      'Band colour "missing" is not available.',
    );
  });

  it('validates mode-specific planned targets', () => {
    expect(validatePlannedSetProgression('weighted_reps', { weightKg: -2 })).toContain(
      'Next weight must be a finite value of 0 kg or higher.',
    );
    expect(validatePlannedSetProgression('timed_hold', { reps: 10 })).toContain(
      'Timed exercises only support seconds progression.',
    );
    expect(validatePlannedSetProgression('timed_hold', { seconds: 75 })).toEqual([]);
  });
});
