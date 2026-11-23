import { describe, expect, it } from 'vitest';
import { createDefaultTemplate, defaultBandColours } from './sampleData';
import { createSessionFromDay } from './session';
import type { WorkoutSession } from './types';
import {
  applySessionProgressions,
  formatSetTarget,
  getCurrentSessionSet,
  getRepWheelMax,
  getWheelValues,
  reviewExerciseProgression,
  stageSetProgression,
} from './workoutFlow';

const bandIds = defaultBandColours.map((band) => band.id);

function completedFixture(template = createDefaultTemplate()) {
  const session = createSessionFromDay(template.days[0]);
  const completedAt = new Date().toISOString();
  const completed: WorkoutSession = { ...session, completedAt, sets: session.sets.map((set) => ({ ...set, completedAt })) };
  return { template, session: completed };
}

describe('focused workout flow helpers', () => {
  it('selects the first incomplete set in strict workout order', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);
    const nextSet = getCurrentSessionSet({
      ...session,
      sets: session.sets.map((set, index) => (index === 0 ? { ...set, completedAt: '2026-05-12T10:00:00.000Z' } : set)),
    });

    expect(nextSet?.id).toBe(session.sets[1].id);
    expect(nextSet?.exerciseName).toBe(session.sets[1].exerciseName);
  });

  it('formats target details for weighted sets', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);
    const set = session.sets[0];

    expect(formatSetTarget(set, defaultBandColours)).toBe('60 kg x 5 reps');
  });

  it('formats target details for timed and band sets', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);
    const timedSet = session.sets.find((set) => set.mode === 'timed_hold')!;
    const bandSet = session.sets.find((set) => set.mode === 'band_reps')!;

    expect(formatSetTarget(timedSet, defaultBandColours)).toBe('45 seconds');
    expect(formatSetTarget(bandSet, defaultBandColours)).toBe('Red x 10 reps');
  });

  it('creates inclusive scroll wheel values within the configured limits', () => {
    const reps = getWheelValues(50);
    const seconds = getWheelValues(300);

    expect(reps[0]).toBe(0);
    expect(reps.at(-1)).toBe(50);
    expect(reps).toHaveLength(51);
    expect(seconds[0]).toBe(0);
    expect(seconds.at(-1)).toBe(300);
    expect(seconds).toHaveLength(301);
  });

  it('allows over-performance beyond the current rep target', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);

    expect(getRepWheelMax(session.sets[0])).toBe(50);
    expect(getRepWheelMax({ ...session.sets[0], target: { ...session.sets[0].target, reps: 75 } })).toBe(75);
  });

  it('applies final-set increases to all sets after saving a complete workout', () => {
    const { template, session } = completedFixture();
    session.sets[2] = stageSetProgression(session.sets[2], { weightKg: 62.5, reps: 6 }, bandIds);
    expect(applySessionProgressions(template, { ...session, completedAt: undefined }, defaultBandColours)).toBe(template);
    expect(applySessionProgressions(template, session, defaultBandColours).days[0].exercises[0].sets.map((set) => set.target))
      .toMatchObject(Array(3).fill({ weightKg: 62.5, reps: 6 }));
    expect(session.sets[2].target.weightKg).toBe(60);
    expect(stageSetProgression(session.sets[2], { weightKg: undefined }, bandIds).proposedNextTarget).toBeUndefined();
  });

  it('blocks increases, applies decreases and ignores legacy proposals on earlier sets', () => {
    const { template, session } = completedFixture();
    const exercise = template.days[0].exercises[0];
    session.sets[0] = { ...session.sets[0], actual: { weightKg: 60, reps: 4 }, proposedNextTarget: { weightKg: 50 } };
    const final = stageSetProgression(session.sets[2], { weightKg: 65, reps: 4 }, bandIds);
    session.sets[2] = final;
    expect(reviewExerciseProgression(exercise, session, final, defaultBandColours))
      .toEqual({ accepted: { reps: 4 }, blocked: ['Weight'] });
    const updated = applySessionProgressions(template, session, defaultBandColours);
    expect(updated.days[0].exercises[0].sets.map((set) => set.target)).toMatchObject(Array(3).fill({ weightKg: 60, reps: 4 }));
    session.sets[0].actual.reps = 5;
    expect(reviewExerciseProgression(exercise, session, final, defaultBandColours).blocked).toEqual([]);
    session.sets[0].actual.weightKg = 40;
    expect(reviewExerciseProgression(exercise, session, final, defaultBandColours).blocked).toEqual(['Weight']);
    exercise.sets.forEach((set) => { set.target.weightKg = 70; });
    expect(reviewExerciseProgression(exercise, session, final, defaultBandColours))
      .toEqual({ accepted: { reps: 4, weightKg: 65 }, blocked: [] });
  });

  it('adds the ranks of combined bands using the current Settings order', () => {
    const { template, session } = completedFixture();
    const exercise = template.days[0].exercises[4];
    session.sets.find((set) => set.exerciseId === exercise.id)!.actual.reps = 9;
    const final = stageSetProgression(session.sets.at(-1)!, { bandColourIds: ['band_yellow', 'band_green'] }, bandIds);
    expect(reviewExerciseProgression(exercise, session, final, defaultBandColours).blocked).toEqual(['Bands']);
    const redLast = defaultBandColours.filter((band) => band.id !== 'band_red').concat(defaultBandColours[1]);
    expect(reviewExerciseProgression(exercise, session, final, redLast))
      .toEqual({ accepted: { bandColourIds: ['band_yellow', 'band_green'] }, blocked: [] });
  });

  it('validates staged values including bounded interval work time', () => {
    const { session } = completedFixture();
    const band = session.sets.find((set) => set.mode === 'band_reps')!;
    const interval = { ...band, mode: 'interval' as const };
    expect(() => stageSetProgression(session.sets[0], { weightKg: Number.NaN }, bandIds)).toThrow('Next weight');
    expect(() => stageSetProgression(band, { bandColourIds: ['missing'] }, bandIds)).toThrow('not available');
    expect(() => stageSetProgression(interval, { seconds: 0 }, bandIds)).toThrow('Next work time');
    expect(stageSetProgression(interval, { seconds: 90 }, bandIds).proposedNextTarget).toEqual({ seconds: 90 });
  });

  it('handles numeric Other increases, clears and changed definitions independently', () => {
    const template = createDefaultTemplate();
    const exercise = template.days[0].exercises[0];
    exercise.mode = 'other';
    exercise.modifiers = [{ id: 'grip', label: 'Grip', type: 'text' }, { id: 'balance', label: 'Balance', type: 'number' }];
    exercise.sets.forEach((set) => { set.target = { modifiers: { grip: 'Wide', balance: 0 } }; });
    const { session } = completedFixture(template);
    session.sets[2] = stageSetProgression(session.sets[2], { modifiers: { grip: null, balance: 1.5 } }, bandIds);
    expect(reviewExerciseProgression(exercise, session, session.sets[2], defaultBandColours))
      .toEqual({ accepted: { modifiers: { grip: null } }, blocked: ['Balance'] });
    const applied = applySessionProgressions(template, session, defaultBandColours);
    expect(applied.days[0].exercises[0].sets.map((set) => set.target.modifiers)).toEqual(Array(3).fill({ balance: 0 }));
    exercise.modifiers = [{ id: 'new-grip', label: 'Grip', type: 'text' }, { id: 'balance', label: 'Balance', type: 'text' }];
    exercise.sets.forEach((set) => { set.target = { modifiers: { 'new-grip': 'Neutral', balance: 'Steady' } }; });
    expect(applySessionProgressions(template, session, defaultBandColours)).toBe(template);
  });
});
