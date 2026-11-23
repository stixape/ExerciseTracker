import { sameBandSelection } from './bands';
import { createId } from './ids';
import { modifierValue } from './modifiers';
import type { AppData, SetValues, TemplateExercise, TemplateSet } from './types';

export const MAX_EXERCISE_SETS = 100;
export const MAX_WORKOUT_SETS = 10_000;

type SetTarget = Pick<TemplateSet, 'target' | 'rangeMax'>;

export function replaceExerciseTarget(exercise: TemplateExercise, { target, rangeMax }: SetTarget): TemplateExercise {
  return { ...exercise, sets: exercise.sets.map((set) => ({ ...set, target: structuredClone(target), rangeMax })) };
}

export function resizeExerciseSets(exercise: TemplateExercise, count: number): TemplateExercise {
  const sets = exercise.sets.slice(0, count);
  const shared = exercise.sets[0];
  for (let index = sets.length; index < count; index++) {
    sets.push({ id: createId('template_set'), setNumber: index + 1, target: structuredClone(shared.target), rangeMax: shared.rangeMax });
  }
  return { ...exercise, sets };
}

function sameValues(left: SetValues, right: SetValues): boolean {
  const leftModifiers = Object.entries(left.modifiers ?? {});
  return left.weightKg === right.weightKg && left.reps === right.reps && left.seconds === right.seconds &&
    sameBandSelection(left.bandColourIds, right.bandColourIds) &&
    leftModifiers.length === Object.keys(right.modifiers ?? {}).length &&
    leftModifiers.every(([key, value]) => modifierValue(right.modifiers, key) === value);
}

/** Convert only the live plan. Active and recorded workouts retain their own targets. */
export function unifyLivePlan(data: AppData): AppData {
  const days = data.template.days.map((day) => {
    const exercises = day.exercises.map((exercise) => {
      const first = exercise.sets[0];
      return exercise.sets.every((set) => set.rangeMax === first.rangeMax && sameValues(set.target, first.target))
        ? exercise : replaceExerciseTarget(exercise, first);
    });
    return exercises.every((exercise, index) => exercise === day.exercises[index]) ? day : { ...day, exercises };
  });
  return days.every((day, index) => day === data.template.days[index]) ? data : { ...data, template: { ...data.template, days } };
}
