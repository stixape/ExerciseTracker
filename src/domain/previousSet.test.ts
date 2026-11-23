import { expect, it } from 'vitest';
import { findPreviousSet } from './previousSet';
import { createDefaultTemplate } from './sampleData';
import { createSessionFromDay } from './session';
import type { TemplateExercise } from './types';

function fixture(mode: TemplateExercise['mode'], target: TemplateExercise['sets'][number]['target'], rangeMax?: number) {
  const day = createDefaultTemplate().days[0];
  const exercise = { ...day.exercises[0], mode };
  exercise.sets = exercise.sets.map((set) => ({ ...set, target, rangeMax }));
  if (mode === 'other') exercise.modifiers = [{ id: 'grip', label: 'Grip', type: 'text' }];
  day.exercises = [exercise];
  function save(dayNumber: number) {
    const saved = createSessionFromDay(day, new Date(2026, 10, dayNumber, 10));
    return {
      ...saved,
      completedAt: saved.startedAt,
      sets: saved.sets.map((set) => ({ ...set, completedAt: saved.startedAt })),
    };
  }
  return { day, save, active: createSessionFromDay(day, new Date(2026, 10, 23, 10)) };
}

it('finds the newest matching recorded load and exact set number even after a different workout setting', () => {
  const { day, save, active } = fixture('weighted_reps', { weightKg: 45, reps: 5 });
  const older = save(2);
  const match = save(9);
  const latest = save(16);
  match.sets[1].actual.reps = 12;
  match.sets[1].target.weightKg = 43;
  latest.sets[1].actual.weightKg = 50;
  expect(findPreviousSet([older, latest, match], active, active.sets[1])).toBe(match.sets[1]);
  expect(findPreviousSet([latest], active, active.sets[1])).toBeUndefined();
  expect(findPreviousSet([{ ...match, templateDayId: day.id + '-other' }], active, active.sets[1])).toBeUndefined();
});

it('matches an exact band combination by ID, independently of selection order', () => {
  const { save, active } = fixture('band_reps', { reps: 10, bandColourIds: ['red', 'blue'] });
  const match = save(9);
  match.sets[0].actual.bandColourIds = ['blue', 'red'];
  const latest = save(16);
  latest.sets[0].actual.bandColourIds = ['red'];
  expect(findPreviousSet([latest, match], active, active.sets[0])).toBe(match.sets[0]);
});

it.each(['timed_hold', 'interval'] as const)('matches the planned %s duration and returns performed seconds', (mode) => {
  const rangeMax = mode === 'timed_hold' ? 30 : undefined;
  const { save, active } = fixture(mode, { seconds: 20 }, rangeMax);
  const match = save(9);
  match.sets[0].actual.seconds = 23;
  const latest = save(16);
  if (mode === 'timed_hold') latest.snapshot.exercises[0].sets[0].rangeMax = 40;
  else latest.sets[0].target.seconds = 22;
  expect(findPreviousSet([latest, match], active, active.sets[0])?.actual.seconds).toBe(23);
});

it('matches Other target values and definitions and skips unrecorded results', () => {
  const { save, active } = fixture('other', { modifiers: { grip: 'Wide' } });
  const match = save(9);
  match.sets[0].actual.modifiers = { grip: 'Neutral' };
  const latest = save(16);
  expect(findPreviousSet([latest, match], active, active.sets[0])).toBe(match.sets[0]);
  match.snapshot.exercises[0].modifiers![0].type = 'number';
  expect(findPreviousSet([latest, match], active, active.sets[0])).toBeUndefined();
});
