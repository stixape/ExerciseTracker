import { describe, expect, it } from 'vitest';
import { createDefaultTemplate, defaultBandColours } from './sampleData';
import { createSessionFromDay } from './session';
import { getCurrentSessionSet, getWheelValues, formatSetTarget, formatSetPreparation, getRepWheelMax, applySetProgression } from './workoutFlow';

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

  it('formats target and preparation details for weighted sets', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);
    const set = session.sets[0];

    expect(formatSetTarget(set, defaultBandColours)).toBe('60 kg x 5 reps');
    expect(formatSetPreparation(set, defaultBandColours)).toBe('Prepare 60 kg');
  });

  it('formats target and preparation details for timed and band sets', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);
    const timedSet = session.sets.find((set) => set.mode === 'timed_hold')!;
    const bandSet = session.sets.find((set) => set.mode === 'band_reps')!;

    expect(formatSetTarget(timedSet, defaultBandColours)).toBe('45 seconds');
    expect(formatSetPreparation(timedSet, defaultBandColours)).toBe('Prepare for 45 seconds');
    expect(formatSetTarget(bandSet, defaultBandColours)).toBe('Red x 10 reps');
    expect(formatSetPreparation(bandSet, defaultBandColours)).toBe('Prepare Red band');
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

  it('caps attained reps at the current set target', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);

    expect(getRepWheelMax(session.sets[0])).toBe(5);
    expect(getRepWheelMax(session.sets[3])).toBe(10);
  });

  it('updates the planned weight after a weighted target is met', () => {
    const template = createDefaultTemplate();
    const session = createSessionFromDay(template.days[0]);
    const set = { ...session.sets[0], actual: { ...session.sets[0].actual, reps: 5 } };
    const updatedTemplate = applySetProgression(template, session, set, { weightKg: 62.5 });

    expect(updatedTemplate.days[0].exercises[0].sets[0].target.weightKg).toBe(62.5);
    expect(template.days[0].exercises[0].sets[0].target.weightKg).toBe(60);
  });

  it('does not update the planned weight if the rep target was missed', () => {
    const template = createDefaultTemplate();
    const session = createSessionFromDay(template.days[0]);
    const set = { ...session.sets[0], actual: { ...session.sets[0].actual, reps: 4 } };
    const updatedTemplate = applySetProgression(template, session, set, { weightKg: 62.5 });

    expect(updatedTemplate.days[0].exercises[0].sets[0].target.weightKg).toBe(60);
  });

  it('updates the planned band after a band rep target is met', () => {
    const template = createDefaultTemplate();
    const session = createSessionFromDay(template.days[0]);
    const bandSet = session.sets.find((set) => set.mode === 'band_reps')!;
    const updatedTemplate = applySetProgression(template, session, { ...bandSet, actual: { ...bandSet.actual, reps: 10 } }, { bandColourIds: ['band_blue'] });

    expect(updatedTemplate.days[0].exercises[4].sets[0].target.bandColourIds).toEqual(['band_blue']);
  });
});
