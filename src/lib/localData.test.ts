import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAppData } from '../domain/sampleData';
import { createSessionFromDay } from '../domain/session';
import type { AppData, WorkoutSession } from '../domain/types';
import { normalizeLocalData, parseJsonImport, readLegacyLocalData } from './localData';

const userId = 'local-user';

function completedSession(data: AppData, id = 'session'): WorkoutSession {
  const startedAt = '2026-01-01T10:00:00.000Z';
  const completedAt = '2026-01-01T10:30:00.000Z';
  const session = createSessionFromDay(data.template.days[0]);
  return {
    ...session,
    id,
    startedAt,
    completedAt,
    sets: session.sets.map((set) => ({ ...set, completedAt })),
  };
}

describe('local data import, normalization, and legacy fallback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates a version-1 export and normalizes missing weekdays', () => {
    const exportedData = createDefaultAppData('exported-user');
    exportedData.template.days = exportedData.template.days.slice(0, 1);

    const result = parseJsonImport(JSON.stringify({ version: 1, data: exportedData }), userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userId).toBe(userId);
    expect(result.data.template.days).toHaveLength(6);
    expect(result.data.template.days.map((day) => day.label)).toContain('Saturday');
  });

  it('preserves customized rep targets through normalization and import', () => {
    const data = createDefaultAppData(userId);
    data.template.days[0].exercises[0].sets[0].target.reps = 8;

    expect(normalizeLocalData(data, userId).template.days[0].exercises[0].sets[0].target.reps).toBe(8);

    const imported = parseJsonImport(JSON.stringify({ version: 1, data }), userId);
    expect(imported.ok && imported.data.template.days[0].exercises[0].sets[0].target.reps).toBe(8);
  });

  it('migrates version-2 side tracking into one canonical reps value', () => {
    const data = createDefaultAppData('exported-user');
    const session = completedSession(data);
    const templateExercise = data.template.days[0].exercises[0] as unknown as Record<string, unknown>;
    const snapshotExercise = session.snapshot.exercises[0] as unknown as Record<string, unknown>;
    const legacySet = session.sets[0] as unknown as Record<string, unknown>;
    const legacyActual = legacySet.actual as Record<string, unknown>;

    templateExercise.tracksSides = true;
    snapshotExercise.tracksSides = true;
    legacySet.tracksSides = true;
    legacySet.actual = { ...legacyActual, reps: 8, leftReps: 8, rightReps: 7 };
    legacySet.proposedNextTarget = { weightKg: 62.5, leftReps: 9, rightReps: 8 };
    data.sessions = [session];

    const result = parseJsonImport(JSON.stringify({ version: 2, data }), userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions[0].sets[0].actual.reps).toBe(7);
    expect(result.data.sessions[0].sets[0].proposedNextTarget).toEqual({ weightKg: 62.5, reps: 8 });
    expect(result.data.sessions[0].sets[0].actual).not.toHaveProperty('leftReps');
    expect(result.data.sessions[0].sets[0].actual).not.toHaveProperty('rightReps');
    expect(result.data.sessions[0].sets[0]).not.toHaveProperty('tracksSides');
    expect(result.data.sessions[0].snapshot.exercises[0]).not.toHaveProperty('tracksSides');
    expect(result.data.template.days[0].exercises[0]).not.toHaveProperty('tracksSides');
  });

  it('rejects retired side-specific fields in a current version export', () => {
    const data = createDefaultAppData(userId);
    const exercise = data.template.days[0].exercises[0] as unknown as Record<string, unknown>;
    exercise.tracksSides = true;

    const result = parseJsonImport(JSON.stringify({ version: 4, data }), userId);

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('tracksSides is no longer supported');
  });

  it('supplies the legacy rep default only when a version-1 target omitted reps', () => {
    const data = createDefaultAppData(userId);
    delete data.template.days[0].exercises[0].sets[0].target.reps;

    const legacy = parseJsonImport(JSON.stringify({ version: 1, data }), userId);
    const current = parseJsonImport(JSON.stringify({ version: 2, data }), userId);

    expect(legacy.ok && legacy.data.template.days[0].exercises[0].sets[0].target.reps).toBe(5);
    expect(current).toMatchObject({ ok: false });
  });

  it('rejects invalid JSON and unsupported export versions with clear errors', () => {
    expect(parseJsonImport('{not-json', userId)).toEqual({ ok: false, error: 'Import file is not valid JSON.' });
    expect(parseJsonImport(JSON.stringify({ version: 5, data: createDefaultAppData(userId) }), userId)).toEqual({
      ok: false,
      error: 'Import file uses unsupported version 5. Supported versions are 1-4.',
    });
  });

  it('replaces the legacy theme setting with the rest-time preference', () => {
    const data = createDefaultAppData(userId) as unknown as Record<string, unknown>;
    data.settings = { theme: 'dark' };

    const result = parseJsonImport(JSON.stringify({ version: 3, data }), userId);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.settings).toEqual({ hideRestTimes: false });
  });

  it.each([
    ['a non-array sessions value', (data: Record<string, unknown>) => Object.assign(data, { sessions: 'not-an-array' }), 'data.sessions must be an array'],
    [
      'an invalid nested date',
      (data: Record<string, unknown>) => {
        const typed = data as unknown as AppData;
        typed.sessions = [completedSession(typed)];
        typed.sessions[0].startedAt = '2026-02-30T10:00:00.000Z';
      },
      'data.sessions[0].startedAt must be a valid ISO date-time string',
    ],
    [
      'a blank nested ID',
      (data: Record<string, unknown>) => {
        (data as unknown as AppData).template.days[0].exercises[0].sets[0].id = ' ';
      },
      'data.template.days[0].exercises[0].sets[0].id',
    ],
    [
      'an infinite numeric target',
      (data: Record<string, unknown>) => {
        (data as unknown as AppData).template.days[0].exercises[0].sets[0].target.weightKg = Number.POSITIVE_INFINITY;
      },
      'weightKg must be a finite number',
    ],
    [
      'an unknown selected set',
      (data: Record<string, unknown>) => {
        const typed = data as unknown as AppData;
        typed.activeWorkout = { session: createSessionFromDay(typed.template.days[0]), selectedSetId: 'missing-set' };
      },
      'selectedSetId is not present in the active session',
    ],
    [
      'mode-incompatible set values',
      (data: Record<string, unknown>) => {
        (data as unknown as AppData).template.days[0].exercises[0].sets[0].target.seconds = 30;
      },
      'contains values that are not valid for a weighted exercise',
    ],
    [
      'a progression without a recognized target',
      (data: Record<string, unknown>) => {
        const typed = data as unknown as AppData;
        const session = createSessionFromDay(typed.template.days[0]);
        (session.sets[0] as unknown as { proposedNextTarget: Record<string, number> }).proposedNextTarget = { mystery: 1 };
        typed.activeWorkout = { session };
      },
      'mystery is not a supported proposed target',
    ],
  ])('rejects %s without persisting it', (_label, corrupt, expectedError) => {
    const data = createDefaultAppData(userId) as unknown as Record<string, unknown>;
    corrupt(data);

    const result = parseJsonImport(JSON.stringify({ version: 2, data }, (_key, value) => (value === Number.POSITIVE_INFINITY ? 'Infinity' : value)), userId);

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain(expectedError);
    expect(localStorage.length).toBe(0);
  });

  it('rejects duplicate semantic identifiers', () => {
    const data = createDefaultAppData(userId);
    data.template.days[0].exercises[1].id = data.template.days[0].exercises[0].id;

    const result = parseJsonImport(JSON.stringify({ version: 2, data }), userId);

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('duplicate exercise ID');
  });

  it('falls back safely when a legacy localStorage record is corrupt', () => {
    localStorage.setItem(`exercise-tracker:data:${userId}`, JSON.stringify({ userId, sessions: 'bad' }));

    expect(readLegacyLocalData(userId)).toBeUndefined();
  });
});
