import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAppData, createDefaultTemplate } from '../domain/sampleData';
import { createSessionFromDay } from '../domain/session';
import type { WorkoutSession } from '../domain/types';
import { hasLegacyLocalData } from './localData';
import {
  clearAppData,
  loadAppData,
  offlineDb,
  resetAppData,
  saveAppData,
} from './offlineDb';

const userId = 'local-user';

function storeLegacy(data: unknown, targetUserId = userId): void {
  localStorage.setItem(`exercise-tracker:data:${targetUserId}`, JSON.stringify(data));
}

function completedSession(id = 'session'): WorkoutSession {
  const session = createSessionFromDay(createDefaultTemplate().days[0]);
  const completedAt = '2026-01-01T10:30:00.000Z';
  return {
    ...session,
    id,
    startedAt: '2026-01-01T10:00:00.000Z',
    completedAt,
    sets: session.sets.map((set) => ({ ...set, completedAt })),
  };
}

describe('canonical offline IndexedDB repository', () => {
  beforeEach(async () => {
    localStorage.clear();
    await offlineDb.delete();
    await offlineDb.open();
  });

  afterEach(() => {
    offlineDb.close();
  });

  it('round-trips the complete app snapshot, including active selection', async () => {
    const data = createDefaultAppData(userId);
    const session = createSessionFromDay(data.template.days[0]);
    data.sessions = [completedSession()];
    data.activeWorkout = {
      session,
      selectedExerciseId: session.sets[1].exerciseId,
      selectedSetId: session.sets[1].id,
    };

    await saveAppData(data);
    const loaded = await loadAppData(userId);

    expect(loaded.sessions[0].id).toBe('session');
    expect(loaded.activeWorkout?.selectedSetId).toBe(session.sets[1].id);
    expect(offlineDb.tables.map((table) => table.name)).toEqual(['appData']);
  });

  it('migrates a valid legacy localStorage snapshot exactly once', async () => {
    const legacy = createDefaultAppData(userId) as unknown as Record<string, unknown>;
    legacy.settings = { theme: 'dark' };
    const typedLegacy = legacy as unknown as ReturnType<typeof createDefaultAppData>;
    typedLegacy.template.days[0].exercises[0].sets[0].target.reps = 8;
    storeLegacy(legacy);

    const loaded = await loadAppData(userId);

    expect(loaded.settings.hideRestTimes).toBe(false);
    expect(loaded.template.days[0].exercises[0].sets[0].target.reps).toBe(8);
    expect(hasLegacyLocalData(userId)).toBe(false);
    expect((await offlineDb.appData.get(userId))?.data.settings).toEqual({ hideRestTimes: false });
  });

  it('upgrades version-1 active workout data and removes both legacy tables', async () => {
    offlineDb.close();
    await Dexie.delete('ExerciseTracker');

    const legacyData = createDefaultAppData(userId);
    storeLegacy(legacyData);
    const activeWorkout = { session: createSessionFromDay(legacyData.template.days[0]) };
    const legacyDb = new Dexie('ExerciseTracker');
    legacyDb.version(1).stores({
      activeWorkouts: 'id, userId, updatedAt',
      syncQueue: 'id, userId, createdAt, type',
    });
    await legacyDb.open();
    await legacyDb.table('activeWorkouts').put({
      id: userId,
      userId,
      updatedAt: '2026-01-01T10:00:00.000Z',
      activeWorkout,
    });
    await legacyDb.table('syncQueue').put({
      id: 'obsolete',
      userId,
      createdAt: '2026-01-01T10:00:00.000Z',
      type: 'session_completed',
      payload: completedSession(),
    });
    legacyDb.close();

    await offlineDb.open();
    const loaded = await loadAppData(userId);

    expect(loaded.activeWorkout?.session.id).toBe(activeWorkout.session.id);
    expect(offlineDb.tables.map((table) => table.name)).toEqual(['appData']);
  });

  it('upgrades version-3 side-specific reps into the canonical single reps value', async () => {
    offlineDb.close();
    await Dexie.delete('ExerciseTracker');

    const legacyData = createDefaultAppData(userId);
    const session = completedSession();
    const legacyExercise = legacyData.template.days[0].exercises[0] as unknown as Record<string, unknown>;
    const legacySet = session.sets[0] as unknown as Record<string, unknown>;
    legacyExercise.tracksSides = true;
    legacySet.tracksSides = true;
    legacySet.actual = { ...(legacySet.actual as object), reps: 8, leftReps: 8, rightReps: 7 };
    legacyData.sessions = [session];

    const legacyDb = new Dexie('ExerciseTracker');
    legacyDb.version(3).stores({ appData: '&userId, updatedAt' });
    await legacyDb.open();
    await legacyDb.table('appData').put({ userId, updatedAt: '2026-01-01T11:00:00.000Z', data: legacyData });
    legacyDb.close();

    await offlineDb.open();
    const loaded = await loadAppData(userId);
    const stored = await offlineDb.appData.get(userId);

    expect(loaded.sessions[0].sets[0].actual.reps).toBe(7);
    expect(loaded.template.days[0].exercises[0]).not.toHaveProperty('tracksSides');
    expect(loaded.sessions[0].sets[0]).not.toHaveProperty('tracksSides');
    expect(loaded.sessions[0].sets[0].actual).not.toHaveProperty('leftReps');
    expect(stored?.data.sessions[0].sets[0].actual).not.toHaveProperty('rightReps');
  });

  it('serializes rapid saves so the last requested snapshot wins', async () => {
    const first = createDefaultAppData(userId);
    first.settings.hideRestTimes = false;
    const second = structuredClone(first);
    second.settings.hideRestTimes = true;

    await Promise.all([saveAppData(first), saveAppData(second)]);

    expect((await loadAppData(userId)).settings.hideRestTimes).toBe(true);
  });

  it('rejects invalid data rather than replacing the canonical snapshot', async () => {
    const valid = createDefaultAppData(userId);
    valid.settings.hideRestTimes = true;
    await saveAppData(valid);
    const invalid = { ...valid, sessions: 'bad' };

    await expect(saveAppData(invalid as never)).rejects.toThrow('data.sessions must be an array');
    expect((await loadAppData(userId)).settings.hideRestTimes).toBe(true);
  });

  it('leaves a schema-invalid canonical record untouched and reports the load error', async () => {
    const invalid = { ...createDefaultAppData(userId), sessions: 'recover-me' };
    await offlineDb.appData.put({
      userId,
      updatedAt: '2026-01-01T10:00:00.000Z',
      data: invalid as never,
    });

    await expect(loadAppData(userId)).rejects.toThrow('was left untouched: data.sessions must be an array');

    const retained = await offlineDb.appData.get(userId);
    expect((retained?.data as unknown as { sessions: unknown }).sessions).toBe('recover-me');
  });

  it('keeps reset and clear scoped to one user', async () => {
    const local = createDefaultAppData(userId);
    local.settings.hideRestTimes = true;
    const other = createDefaultAppData('other-user');
    other.settings.hideRestTimes = true;
    await saveAppData(local);
    await saveAppData(other);

    expect((await resetAppData(userId)).settings.hideRestTimes).toBe(false);
    expect((await loadAppData('other-user')).settings.hideRestTimes).toBe(true);

    await clearAppData(userId);
    expect(await offlineDb.appData.get(userId)).toBeUndefined();
    expect(await offlineDb.appData.get('other-user')).toBeDefined();
  });

});
