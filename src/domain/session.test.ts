import { describe, expect, it } from 'vitest';
import { createDefaultTemplate } from './sampleData';
import { completeSessionIfDone, completeSet, createActiveRest, createSessionFromDay, logRestEvent, uncompleteSet } from './session';

describe('workout sessions', () => {
  it('creates a session snapshot from a template day', () => {
    const day = createDefaultTemplate().days[0];
    const session = createSessionFromDay(day);

    expect(session.label).toBe(day.label);
    expect(session.sets).toHaveLength(15);
    expect(session.snapshot).not.toBe(day);
    expect(session.sets[0].actual).toEqual(session.sets[0].target);
  });

  it('completes, rests after, and uncompletes a set', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);
    const firstSet = session.sets[0];
    const completed = completeSet(session, firstSet.id, { weightKg: 62.5, reps: 5 });
    const rest = createActiveRest(completed, firstSet.id);

    expect(completed.sets[0].completedAt).toBeDefined();
    expect(rest?.durationSeconds).toBe(180);
    expect(rest?.nextSetId).toBe(completed.sets[1].id);

    const withRestEvent = logRestEvent(completed, rest!, true);
    expect(withRestEvent.restEvents).toHaveLength(1);
    expect(withRestEvent.restEvents[0].skipped).toBe(true);

    const undone = uncompleteSet(withRestEvent, firstSet.id);
    expect(undone.sets[0].completedAt).toBeUndefined();
    expect(undone.restEvents).toEqual([]);
  });

  it('marks the session complete only after every set is complete', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);
    const completedSession = session.sets.reduce((current, set) => completeSet(current, set.id, set.actual), session);

    expect(completeSessionIfDone(session).completedAt).toBeUndefined();
    expect(completeSessionIfDone(completedSession).completedAt).toBeDefined();
    expect(createActiveRest(completedSession, completedSession.sets.at(-1)!.id)).toBeUndefined();
  });
});
