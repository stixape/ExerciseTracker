import { describe, expect, it } from 'vitest';
import { calculatePersonalBests, detectPlateaus } from './analytics';
import { createCsvExport, createJsonExport } from './export';
import { advanceInterval, pauseInterval, resumeInterval, skipIntervalRest, startInterval } from './interval';
import { createDefaultAppData } from './sampleData';
import { completeSet, createSessionFromDay } from './session';
import type { ActiveWorkout } from './types';
import { parseJsonImport } from '../lib/localData';

function workoutFixture(durations: number[], restSeconds?: number, position = 0) {
  const data = createDefaultAppData('local-user');
  const day = data.template.days[0];
  const exercise = {
    ...day.exercises[0], mode: 'interval' as const, restSeconds,
    sets: durations.map((seconds, index) => ({
      id: 'interval-set-' + index, setNumber: index + 1, target: { seconds },
    })),
  };
  day.exercises = position === 0 ? [exercise] : [day.exercises[1], exercise];
  const session = createSessionFromDay(day);
  const start = Date.parse(session.startedAt);
  const workout: ActiveWorkout = { session };
  return { data, session, workout, exercise, start, running: startInterval(workout, exercise.id, start) };
}

describe('interval exercise timer', () => {
  it('finishes a single set with only the final alarm and records seconds without a personal best or plateau', () => {
    const { running, start } = workoutFixture([3]);
    expect(advanceInterval(running, start + 2999)).toEqual({ workout: running });
    const result = advanceInterval(running, start + 3000, true);
    expect(result.cue).toBe('finish');
    expect(result.workout.activeInterval).toBeUndefined();
    const session = result.workout.session;
    expect(session.completedAt).toBe(new Date(start + 3000).toISOString());
    expect(session.sets[0].actual.seconds).toBe(3);
    expect(session.restEvents).toEqual([]);
    expect(calculatePersonalBests([session])).toEqual([]);
    expect(detectPlateaus([session, session, session])).toEqual([]);
    const [header, row] = createCsvExport([session]).split('\n');
    expect(row.split(',')[header.split(',').indexOf('seconds')]).toBe('3');
  });

  it('rings on both live transitions and skips rest when configured to zero', () => {
    const { running, start } = workoutFixture([2, 4], 3);
    const rest = advanceInterval(running, start + 2000, true);
    expect(rest.cue).toBe('bell');
    expect(rest.workout.activeInterval).toMatchObject({ phase: 'rest', endsAt: new Date(start + 5000).toISOString() });
    const work = advanceInterval(rest.workout, start + 5000, true);
    expect(work.cue).toBe('bell');
    expect(work.workout.activeInterval).toMatchObject({ phase: 'work', setId: running.session.sets[1].id });
    expect(work.workout.session.restEvents).toMatchObject([{ durationSeconds: 3, skipped: false }]);
    expect(advanceInterval(work.workout, start + 9000, true).cue).toBe('finish');

    const withoutRest = workoutFixture([2, 4], 0);
    const next = advanceInterval(withoutRest.running, withoutRest.start + 2000, true);
    expect(next.cue).toBe('bell');
    expect(next.workout.activeInterval).toMatchObject({ phase: 'work', setId: withoutRest.session.sets[1].id });
    expect(next.workout.session.restEvents).toEqual([]);
  });

  it.each([[0, 180], [1, 120]])('uses the default rest for exercise index %i', (position, seconds) => {
    const { running, start } = workoutFixture([2, 4], undefined, position);
    const next = advanceInterval(running, start + 2000, true);
    expect(next.workout.activeInterval?.endsAt).toBe(new Date(start + (2 + seconds) * 1000).toISOString());
  });

  it('freezes work and rest, stores a skipped rest once, and restores paused and running v7 snapshots', () => {
    const { data, running, start } = workoutFixture([2, 4], 8);
    const paused = pauseInterval(running, start + 500);
    expect(paused.activeInterval).toMatchObject({ phase: 'work', remainingMs: 1500 });
    expect(advanceInterval(paused, start + 30_000)).toEqual({ workout: paused });
    const resumed = resumeInterval(paused, start + 30_000);
    const rest = advanceInterval(resumed, start + 31_500, true).workout;
    const pausedRest = pauseInterval(rest, start + 33_000);
    expect(pausedRest.activeInterval).toMatchObject({ phase: 'rest', remainingMs: 6500 });
    const resumedRest = resumeInterval(pausedRest, start + 50_000);
    expect(resumedRest.activeInterval?.endsAt).toBe(new Date(start + 56_500).toISOString());
    for (const activeWorkout of [pausedRest, resumedRest]) {
      const snapshot = { ...data, activeWorkout };
      expect(parseJsonImport(createJsonExport(snapshot), 'local-user')).toEqual({ ok: true, data: snapshot });
    }
    const skipped = skipIntervalRest(resumedRest, start + 51_000);
    expect(skipped.cue).toBe('bell');
    expect(skipped.workout.activeInterval?.phase).toBe('work');
    expect(skipped.workout.session.restEvents).toMatchObject([{ durationSeconds: 8, skipped: true }]);
    expect(skipIntervalRest(skipped.workout, start + 51_000)).toEqual({ workout: skipped.workout });
  });

  it('catches up from the original deadlines without replaying missed bells or duplicating records', () => {
    const { running, start } = workoutFixture([2, 3, 4], 1);
    const middle = advanceInterval(running, start + 4500);
    expect(middle.cue).toBeUndefined();
    expect(middle.workout.activeInterval).toMatchObject({ phase: 'work', endsAt: new Date(start + 6000).toISOString() });
    const result = advanceInterval(middle.workout, start + 60_000);
    expect(result.cue).toBe('finish');
    expect(result.workout.session.sets.map((set) => set.completedAt)).toEqual(
      [2, 6, 11].map((seconds) => new Date(start + seconds * 1000).toISOString()),
    );
    expect(result.workout.session.restEvents).toHaveLength(2);
    expect(advanceInterval(result.workout, start + 60_000)).toEqual({ workout: result.workout });
  });

  it('hands off to the remaining workout immediately after the last interval', () => {
    const { session, workout, exercise, start } = workoutFixture([2], 99, 1);
    const prior = completeSet(session, session.sets[0].id, session.sets[0].target, session.startedAt);
    const running = startInterval({ ...workout, session: prior }, exercise.id, start + 1000);
    const result = advanceInterval(running, start + 3000, true);
    expect(result.cue).toBe('finish');
    expect(result.workout.activeInterval).toBeUndefined();
    expect(result.workout.session.completedAt).toBeUndefined();
    expect(result.workout.session.restEvents).toEqual([]);
  });
});
