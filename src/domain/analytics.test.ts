import { describe, expect, it } from 'vitest';
import { calculatePersonalBests, calculateSetVolume, calculateVolumeTrend, detectPlateaus } from './analytics';
import type { SessionSet, WorkoutSession } from './types';

function session(
  id: string,
  weight: number,
  reps: number,
  date: string,
  options: { exerciseId?: string; exerciseName?: string; setCount?: number; completed?: boolean } = {},
): WorkoutSession {
  const exerciseId = options.exerciseId ?? 'squat';
  const exerciseName = options.exerciseName ?? 'Back Squat';
  const completedAt = options.completed === false ? undefined : date;
  const sets: SessionSet[] = Array.from({ length: options.setCount ?? 1 }, (_, index) => ({
    id: `${id}-set-${index}`,
    templateSetId: `template-set-${index}`,
    exerciseId,
    exerciseName,
    exerciseIndex: 0,
    setNumber: index + 1,
    mode: 'weighted_reps',
    target: { weightKg: 60, reps: 8 },
    actual: { weightKg: weight, reps },
    completedAt: date,
  }));
  return {
    id,
    templateDayId: 'day',
    label: 'Monday',
    startedAt: date,
    completedAt,
    snapshot: {
      id: 'day',
      weekday: 1,
      label: 'Monday',
      exercises: [
        {
          id: exerciseId,
          name: exerciseName,
          mode: 'weighted_reps',
          sets: sets.map((set) => ({ id: set.templateSetId, setNumber: set.setNumber, target: set.target })),
        },
      ],
    },
    restEvents: [],
    sets,
  };
}

describe('analytics', () => {
  it('calculates weighted PBs with correct volume units', () => {
    const bests = calculatePersonalBests([
      session('one', 60, 8, '2026-01-01T10:00:00Z'),
      session('two', 65, 6, '2026-01-08T10:00:00Z'),
    ]);

    expect(bests.some((best) => best.exerciseId === 'squat' && best.label.includes('65 kg'))).toBe(true);
    expect(bests.find((best) => best.label.startsWith('Best set volume'))?.label).toBe('Best set volume: 480 kg·reps');
  });

  it('uses the single performed rep count for set volume', () => {
    const set = session('one', 20, 7, '2026-01-01T10:00:00Z').sets[0];

    expect(calculateSetVolume(set)).toBe(140);
  });

  it('ignores sets from sessions that have not been completed', () => {
    expect(calculatePersonalBests([session('active', 100, 10, '2026-01-01T10:00:00Z', { completed: false })])).toEqual([]);
  });

  it('aggregates all sets in one session into one appearance', () => {
    const plateaus = detectPlateaus([session('one', 60, 8, '2026-01-01T10:00:00Z', { setCount: 3 })]);

    expect(plateaus).toEqual([]);
  });

  it('detects a plateau across three non-improving completed sessions', () => {
    const plateaus = detectPlateaus([
      session('one', 60, 8, '2026-01-01T10:00:00Z', { setCount: 3 }),
      session('two', 60, 8, '2026-01-08T10:00:00Z', { setCount: 3 }),
      session('three', 60, 8, '2026-01-15T10:00:00Z', { setCount: 3 }),
    ]);

    expect(plateaus).toMatchObject([{ exerciseId: 'squat', exerciseName: 'Back Squat', appearances: 3 }]);
  });

  it('does not flag improving appearances', () => {
    const plateaus = detectPlateaus([
      session('one', 60, 8, '2026-01-01T10:00:00Z'),
      session('two', 62.5, 8, '2026-01-08T10:00:00Z'),
      session('three', 65, 8, '2026-01-15T10:00:00Z'),
    ]);

    expect(plateaus).toEqual([]);
  });

  it('uses stable exercise IDs across renames and separates equal names with different IDs', () => {
    const renamed = [
      session('one', 60, 8, '2026-01-01T10:00:00Z', { exerciseId: 'stable-id', exerciseName: 'Squat' }),
      session('two', 60, 8, '2026-01-08T10:00:00Z', { exerciseId: 'stable-id', exerciseName: 'Back Squat' }),
      session('three', 60, 8, '2026-01-15T10:00:00Z', { exerciseId: 'stable-id', exerciseName: 'High Bar Squat' }),
      session('other', 60, 8, '2026-01-15T11:00:00Z', { exerciseId: 'different-id', exerciseName: 'High Bar Squat' }),
    ];

    expect(detectPlateaus(renamed)).toMatchObject([{ exerciseId: 'stable-id', exerciseName: 'High Bar Squat' }]);
    expect(calculatePersonalBests(renamed).filter((best) => best.label.startsWith('Highest load'))).toHaveLength(2);
  });

  it('sorts completed-session volume trend chronologically', () => {
    const trend = calculateVolumeTrend([
      session('later', 65, 8, '2026-01-08T10:00:00Z'),
      session('earlier', 60, 8, '2026-01-01T10:00:00Z'),
    ]);

    expect(trend.map((item) => item.volume)).toEqual([480, 520]);
  });

  it('rejects nonsensical plateau thresholds', () => {
    expect(() => detectPlateaus([], 1)).toThrow('Appearance threshold');
  });
});
