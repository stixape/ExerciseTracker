import { describe, expect, it } from 'vitest';
import { validateAppData } from '../lib/appDataSchema';
import { createDefaultAppData } from './sampleData';
import { createSessionFromDay } from './session';
import { removeBandColour, reorderBandColours } from './bands';
import { formatBandNames } from '../lib/workoutFormatting';

describe('band colour management', () => {
  it('reorders the palette without changing band identity', () => {
    const data = createDefaultAppData();
    const reordered = reorderBandColours(data.bandColours, 'band_blue', 'band_yellow');

    expect(reordered.map((band) => band.id)).toEqual([
      'band_blue',
      'band_yellow',
      'band_red',
      'band_green',
      'band_black',
    ]);
    expect(reordered.find((band) => band.id === 'band_blue')?.hex).toBe('#2d6cdf');
    expect(formatBandNames(['band_yellow', 'band_blue'], reordered)).toBe('Blue + Yellow');
  });

  it('deletes a used band from plans, saved workouts, and the active workout', () => {
    const data = createDefaultAppData();
    const session = createSessionFromDay(data.template.days[0]);
    const completedAt = new Date(Date.parse(session.startedAt) + 60_000).toISOString();
    const completedSession = {
      ...session,
      completedAt,
      sets: session.sets.map((set) => ({ ...set, completedAt })),
    };
    const bandSet = completedSession.sets.find((set) => set.mode === 'band_reps');
    if (!bandSet) throw new Error('Expected a band set in the starter plan.');
    bandSet.proposedNextTarget = { bandColourIds: ['band_red'] };
    data.sessions = [completedSession];
    data.activeWorkout = { session: { ...structuredClone(session), id: 'active-session' } };

    const next = removeBandColour(data, 'band_red');

    expect(next.bandColours.some((band) => band.id === 'band_red')).toBe(false);
    expect(JSON.stringify(next)).not.toContain('band_red');
    const validation = validateAppData(next);
    expect(validation.ok, validation.ok ? undefined : validation.error).toBe(true);
  });
});
