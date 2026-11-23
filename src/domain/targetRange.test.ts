import { describe, expect, it } from 'vitest';
import { createDefaultTemplate, defaultBandColours } from './sampleData';
import { createSessionFromDay } from './session';
import type { WorkoutSession } from './types';
import { getRecordedRangeMax, parseTargetRange } from './targetRange';
import { applySessionProgressions, stageSetProgression } from './workoutFlow';
import { formatPlannedSets } from '../lib/workoutFormatting';

describe('planned target ranges', () => {
  it('accepts whole numbers, ranges and a seconds suffix', () => {
    expect(parseTargetRange('5')).toEqual({ min: 5 });
    expect(parseTargetRange('3-5')).toEqual({ min: 3, max: 5 });
    expect(parseTargetRange('20 – 60 s', true)).toEqual({ min: 20, max: 60 });
    expect(parseTargetRange('40s', true)).toEqual({ min: 40 });
    expect(parseTargetRange('4-4')).toEqual({ min: 4 });
  });

  it.each(['', '3-', '5-3', '3.5', '-5', '3-5s', '3-5-7', '9007199254740992'])('rejects draft %j', (draft) => {
    expect(parseTargetRange(draft)).toBeUndefined();
  });

  it('groups consecutive identical targets and displays load first', () => {
    const day = createDefaultTemplate().days[0];
    const weighted = day.exercises.find((exercise) => exercise.mode === 'weighted_reps')!;
    const timed = day.exercises.find((exercise) => exercise.mode === 'timed_hold')!;
    const banded = day.exercises.find((exercise) => exercise.mode === 'band_reps')!;
    weighted.sets = weighted.sets.map((set) => ({ ...set, target: { weightKg: 45, reps: 5 } }));
    timed.sets = timed.sets.map((set) => ({ ...set, target: { seconds: 40 } }));
    banded.sets = banded.sets.map((set) => ({ ...set, target: { bandColourIds: ['band_red'], reps: 10 } }));

    expect(formatPlannedSets(weighted, defaultBandColours)).toBe('45 KG - 3x5');
    expect(formatPlannedSets(timed, defaultBandColours)).toBe('3x40s');
    expect(formatPlannedSets(banded, defaultBandColours)).toBe('Red - 3x10');

    weighted.sets[1] = { ...weighted.sets[1], target: { weightKg: 50, reps: 3 }, rangeMax: 5 };
    expect(formatPlannedSets(weighted, defaultBandColours)).toBe('45 KG - 1x5 · 50 KG - 1x3-5 · 45 KG - 1x5');
    timed.sets = timed.sets.map((set) => ({ ...set, target: { seconds: 20 }, rangeMax: 60 }));
    expect(formatPlannedSets(timed, defaultBandColours)).toBe('3x20-60s');
  });

  it('prefills the minimum and treats an explicit numeric target as replacing the range', () => {
    const template = createDefaultTemplate();
    template.days[0].exercises[0].sets.forEach((set) => { set.rangeMax = 8; });
    const session = createSessionFromDay(template.days[0]);
    const set = session.sets[2];
    const rangeMax = getRecordedRangeMax(session, set);

    expect(rangeMax).toBe(8);
    expect(set.actual.reps).toBe(5);
    const completedAt = new Date().toISOString();
    const completed: WorkoutSession = { ...session, completedAt, sets: session.sets.map((item) => ({ ...item, completedAt })) };
    const bandIds = defaultBandColours.map((band) => band.id);
    completed.sets[2] = stageSetProgression(completed.sets[2], { reps: 5 }, bandIds);
    expect(applySessionProgressions(template, completed, defaultBandColours).days[0].exercises[0].sets.map((item) => item.rangeMax))
      .toEqual([undefined, undefined, undefined]);
    completed.sets[2] = stageSetProgression(completed.sets[2], { weightKg: 70 }, bandIds);
    expect(applySessionProgressions(template, completed, defaultBandColours).days[0].exercises[0].sets[0])
      .toMatchObject({ rangeMax: 8, target: { weightKg: 70, reps: 5 } });
    expect(getRecordedRangeMax(session, set)).toBe(8);
  });
});
