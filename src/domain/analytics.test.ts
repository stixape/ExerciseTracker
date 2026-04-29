import { describe, expect, it } from 'vitest';
import { calculatePersonalBests, detectPlateaus } from './analytics';
import type { WorkoutSession } from './types';

function session(id: string, weight: number, reps: number, date: string): WorkoutSession {
  return {
    id,
    templateDayId: 'day',
    label: 'Monday',
    startedAt: date,
    completedAt: date,
    snapshot: { id: 'day', weekday: 1, label: 'Monday', exercises: [] },
    restEvents: [],
    sets: [
      {
        id: `${id}-set`,
        templateSetId: 'template-set',
        exerciseId: 'squat',
        exerciseName: 'Back Squat',
        exerciseIndex: 0,
        setNumber: 1,
        mode: 'weighted_reps',
        target: { weightKg: 60, reps: 8 },
        actual: { weightKg: weight, reps },
        completedAt: date,
      },
    ],
  };
}

describe('analytics', () => {
  it('calculates weighted personal bests', () => {
    const bests = calculatePersonalBests([session('one', 60, 8, '2026-01-01T10:00:00Z'), session('two', 65, 6, '2026-01-08T10:00:00Z')]);

    expect(bests.some((best) => best.exerciseName === 'Back Squat' && best.label.includes('65 kg'))).toBe(true);
  });

  it('detects a simple plateau over repeated non-improving appearances', () => {
    const plateaus = detectPlateaus([
      session('one', 60, 8, '2026-01-01T10:00:00Z'),
      session('two', 60, 8, '2026-01-08T10:00:00Z'),
      session('three', 60, 8, '2026-01-15T10:00:00Z'),
    ]);

    expect(plateaus).toHaveLength(1);
    expect(plateaus[0].exerciseName).toBe('Back Squat');
  });
});
