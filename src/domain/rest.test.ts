import { describe, expect, it } from 'vitest';
import { formatDuration, getRestDurationSeconds } from './rest';

describe('rest timer rules', () => {
  it('uses 3 minutes after first exercise sets when another set remains', () => {
    expect(getRestDurationSeconds(0, true)).toBe(180);
  });

  it('uses 2 minutes after later exercise sets when another set remains', () => {
    expect(getRestDurationSeconds(1, true)).toBe(120);
    expect(getRestDurationSeconds(4, true)).toBe(120);
  });

  it('does not create a timer after the final set', () => {
    expect(getRestDurationSeconds(0, false)).toBe(0);
    expect(getRestDurationSeconds(3, false)).toBe(0);
  });

  it('formats countdown values for the workout display', () => {
    expect(formatDuration(180)).toBe('3:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
  });
});
