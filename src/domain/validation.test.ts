import { describe, expect, it } from 'vitest';
import { validateSetValues } from './validation';

describe('set value validation', () => {
  it('accepts valid weighted reps', () => {
    expect(validateSetValues('weighted_reps', { weightKg: 42.5, reps: 8 })).toEqual([]);
  });

  it('rejects missing band choices', () => {
    expect(validateSetValues('band_reps', { reps: 12 })).toContain('Choose at least one band colour.');
  });

  it('rejects invalid timed holds', () => {
    expect(validateSetValues('timed_hold', { seconds: -1 })).toContain('Seconds must be 0 or higher.');
  });
});
