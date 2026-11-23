import { expect, it } from 'vitest';
import { resizeExerciseSets, unifyLivePlan } from './plan';
import { createDefaultAppData } from './sampleData';
import { createSessionFromDay } from './session';

it('converts mixed plans using Set 1 and leaves active snapshots as recorded', () => {
  const data = createDefaultAppData();
  const day = data.template.days[0];
  const exercise = day.exercises[0];
  exercise.sets[0].rangeMax = 7;
  exercise.sets[1].target.weightKg = 25;
  data.activeWorkout = { session: createSessionFromDay(day) };
  const result = unifyLivePlan(data);
  const sets = result.template.days[0].exercises[0].sets;
  expect(sets.map((set) => set.id)).toEqual(exercise.sets.map((set) => set.id));
  expect(sets.map((set) => [set.target.weightKg, set.rangeMax])).toEqual([[60, 7], [60, 7], [60, 7]]);
  expect(result.activeWorkout).toBe(data.activeWorkout);
  expect(result.activeWorkout?.session.sets[1].target.weightKg).toBe(25);
  expect(unifyLivePlan(result)).toBe(result);
});

it('resizes from the end and gives added sets independent copies of the shared target', () => {
  const exercise = createDefaultAppData().template.days[0].exercises[4];
  exercise.sets[0].rangeMax = 12;
  const trimmed = resizeExerciseSets(exercise, 2);
  const grown = resizeExerciseSets(trimmed, 4);
  expect(grown.sets.map((set) => set.setNumber)).toEqual([1, 2, 3, 4]);
  expect(grown.sets.slice(0, 2)).toEqual(exercise.sets.slice(0, 2));
  expect(grown.sets[2].id).not.toBe(exercise.sets[2].id);
  expect(grown.sets[2]).toMatchObject({ target: exercise.sets[0].target, rangeMax: 12 });
  expect(grown.sets[2].target.bandColourIds).not.toBe(exercise.sets[0].target.bandColourIds);
});
