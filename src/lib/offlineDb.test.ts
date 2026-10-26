import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppData } from '../domain/sampleData';
import { createSessionFromDay } from '../domain/session';
import { createJsonExport } from '../domain/export';
import { parseJsonImport } from './localData';
import { checksum } from './backupFormat';
import { commitAppData, createRawRecoveryExport, ExerciseTrackerDb, listCheckpoints, readCheckpoint, loadAppData, offlineDb, retainedCheckpointIds, StorageConflictError } from './offlineDb';

const userId = 'local-user';
const key = 'exercise-tracker:data:' + userId;
function fixture() {
  const data = createDefaultAppData(userId);
  const session = createSessionFromDay(data.template.days[0]);
  const completedAt = new Date(Date.parse(session.startedAt) + 60_000).toISOString();
  data.sessions = [{ ...session, completedAt, sets: session.sets.map((set) => ({ ...set, completedAt })) }];
  data.activeWorkout = { session: createSessionFromDay(data.template.days[1]) };
  data.template.name = 'Synthetic recovery fixture';
  return data;
}
async function ready() {
  const result = await loadAppData(userId);
  if (result.kind !== 'ready') throw new Error('Expected ready: ' + result.kind);
  return result.snapshot;
}

describe('revisioned canonical storage and recovery', () => {
  beforeEach(async () => { localStorage.clear(); await offlineDb.delete(); await offlineDb.open(); });
  afterEach(() => { vi.restoreAllMocks(); offlineDb.close(); });

  it('never seeds defaults into an empty database', async () => {
    expect(await loadAppData(userId)).toEqual({ kind: 'empty' });
    expect(await offlineDb.appData.count()).toBe(0);
  });
  it('does not make canonical saves depend on obsolete localStorage access', async () => {
    const first = await commitAppData(fixture(), null);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Synthetic policy', 'SecurityError'); });
    expect((await loadAppData(userId)).kind).toBe('ready');
    const next = await commitAppData({ ...first.data, settings: { hideRestTimes: true } }, 1);
    expect(next.revision).toBe(2);
    const restored = await commitAppData(fixture(), 2, 'restore');
    expect(restored.revision).toBe(3);
    expect(JSON.parse(await createRawRecoveryExport(userId)).legacy).toEqual({ unavailable: true });
    get.mockRestore();
  });
  it('reports recovery rather than seeding when legacy storage is inaccessible and there is no head', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Synthetic policy', 'SecurityError'); });
    expect((await loadAppData(userId)).kind).toBe('recovery_required');
    expect(await offlineDb.appData.count()).toBe(0);
  });
  it('round trips every part of a snapshot and saves a checksum and revision', async () => {
    const data = fixture();
    const saved = await commitAppData(data, null, 'initialise');
    expect(saved.revision).toBe(1);
    expect((await ready()).data).toEqual(data);
    expect(saved.checksum).toBe(checksum(data));
  });
  it.each(['{not-json', '', JSON.stringify({ ...fixture(), sessions: 'bad' }), JSON.stringify({ ...fixture(), template: { ...fixture().template, name: '' } })])('preserves unreadable legacy input instead of replacing it (%#)', async (raw) => {
    localStorage.setItem(key, raw);
    expect((await loadAppData(userId)).kind).toBe('recovery_required');
    expect(localStorage.getItem(key)).toBe(raw);
    expect(await offlineDb.appData.count()).toBe(0);
  });
  it('migrates valid legacy data once while keeping its original source', async () => {
    const data = fixture();
    const raw = JSON.stringify({ ...data, settings: { theme: 'dark' } });
    localStorage.setItem(key, raw);
    const first = await ready();
    expect(first.data.sessions).toEqual(data.sessions);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(await offlineDb.recoverySources.count()).toBeGreaterThan(0);
    expect((await ready()).snapshotId).toBe(first.snapshotId);
  });
  it('preserves an invalid canonical record and permits a confirmed restore without clearing the database', async () => {
    const invalid = { ...fixture(), sessions: 'recover-me' };
    await offlineDb.appData.put({ userId, updatedAt: new Date().toISOString(), revision: 3, snapshotId: 'bad', checksum: 'bad', data: invalid as never });
    expect(await loadAppData(userId)).toMatchObject({ kind: 'recovery_required', revision: 3 });
    const saved = await commitAppData(fixture(), 3, 'restore');
    expect(saved.revision).toBe(4);
    expect(JSON.stringify(await offlineDb.recoverySources.toArray())).toContain('recover-me');
  });
  it('rejects invalid saves without changing committed data', async () => {
    const saved = await commitAppData(fixture(), null);
    await expect(commitAppData({ ...saved.data, sessions: 'bad' } as never, 1)).rejects.toThrow('validation');
    expect((await ready()).snapshotId).toBe(saved.snapshotId);
  });
  it('detects checksum corruption instead of loading silently changed history', async () => {
    const saved = await commitAppData(fixture(), null);
    await offlineDb.appData.put({ ...saved, data: { ...saved.data, sessions: [] } });
    expect((await loadAppData(userId)).kind).toBe('recovery_required');
    expect((await offlineDb.appData.get(userId))?.data.sessions).toEqual([]);
  });
  it('rejects stale writes from an independent database connection', async () => {
    const saved = await commitAppData(fixture(), null);
    const other = new ExerciseTrackerDb();
    await other.open();
    const stale = structuredClone((await other.appData.get(userId))!);
    const newer = await commitAppData({ ...saved.data, template: { ...saved.data.template, name: 'Newer plan' } }, 1);
    await expect(commitAppData({ ...stale.data, settings: { hideRestTimes: true } }, stale.revision!)).rejects.toBeInstanceOf(StorageConflictError);
    expect((await ready()).data).toEqual(newer.data);
    other.close();
  });
  it('only one concurrent initialisation wins', async () => {
    const results = await Promise.allSettled([commitAppData(fixture(), null), commitAppData(createDefaultAppData(userId), null)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await ready()).revision).toBe(1);
  });
  it('rolls back the head, checkpoint and source changes together on quota failure', async () => {
    const saved = await commitAppData(fixture(), null);
    vi.spyOn(offlineDb.checkpoints, 'put').mockRejectedValueOnce(new DOMException('Synthetic quota', 'QuotaExceededError'));
    await expect(commitAppData(createDefaultAppData(userId), 1, 'reset')).rejects.toThrow();
    expect((await ready()).snapshotId).toBe(saved.snapshotId);
    expect(await offlineDb.recoverySources.count()).toBe(0);
  });
  it('keeps reset checkpoints and restores older data with an increasing revision', async () => {
    const first = await commitAppData(fixture(), null);
    await commitAppData(createDefaultAppData(userId), 1, 'reset');
    const checkpoints = await listCheckpoints(userId);
    expect(checkpoints[0].pinned).toBe(true);
    const checkpoint = await readCheckpoint(userId, checkpoints[0].id);
    expect(checkpoint.data).toEqual(first.data);
    const restored = await commitAppData(checkpoint.data, 2, 'restore');
    expect(restored.revision).toBe(3);
    expect(restored.data).toEqual(first.data);
    expect(await offlineDb.recoverySources.count()).toBe(2);
  });
  it('pauses remote publishing on import, restore and reset without deleting backups', async () => {
    await offlineDb.preferences.put({ key: 'remote-approved', value: true });
    await commitAppData(fixture(), null, 'import');
    expect((await offlineDb.preferences.get('remote-approved'))?.value).toBe(false);
  });
  it('does not touch other users during reset or checkpoint pruning', async () => {
    await commitAppData(createDefaultAppData('other-user'), null);
    await commitAppData(fixture(), null);
    await commitAppData(createDefaultAppData(userId), 1, 'reset');
    expect((await offlineDb.appData.get('other-user'))?.revision).toBe(1);
    expect((await listCheckpoints('other-user'))).toHaveLength(0);
  });
  it('restores after complete synthetic database and localStorage loss, then reopens', async () => {
    const original = await commitAppData(fixture(), null);
    const file = createJsonExport(original.data, { snapshotId: original.snapshotId, revision: original.revision, savedAt: original.updatedAt });
    await offlineDb.delete(); localStorage.clear(); await offlineDb.open();
    expect((await loadAppData(userId)).kind).toBe('empty');
    const parsed = parseJsonImport(file, userId);
    if (!parsed.ok) throw new Error(parsed.error);
    await commitAppData(parsed.data, null, 'import');
    offlineDb.close(); await offlineDb.open();
    expect((await ready()).data).toEqual(original.data);
  });
  it('retains 20 recent plus 30 daily versions and every protected version', () => {
    const records = Array.from({ length: 80 }, (_, index) => ({ id: String(index), createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), pinned: index === 0 }));
    const retained = retainedCheckpointIds(records);
    expect(retained.size).toBe(31);
    expect(retained.has('0')).toBe(true);
    expect(retained.has('79')).toBe(true);
  });
});

describe('historical migrations retain sources', () => {
  beforeEach(async () => { localStorage.clear(); offlineDb.close(); await Dexie.delete('ExerciseTracker'); });
  afterEach(() => offlineDb.close());
  it('does not manufacture a starter plan when only a legacy active workout survives', async () => {
    const data = fixture();
    const db = new Dexie('ExerciseTracker');
    db.version(1).stores({ activeWorkouts: 'id, userId, updatedAt', syncQueue: 'id, userId, createdAt, type' });
    await db.table('activeWorkouts').put({ id: userId, userId, activeWorkout: data.activeWorkout });
    db.close();
    expect((await loadAppData(userId)).kind).toBe('recovery_required');
    expect(await offlineDb.appData.count()).toBe(0);
    expect(await createRawRecoveryExport(userId)).toContain(data.activeWorkout!.session.id);
  });
  it('rolls back an interrupted upgrade and retries without losing original fields', async () => {
    const data = fixture();
    Object.assign(data.sessions[0].sets[0].actual, { leftReps: 8, rightReps: 7, reps: 8 });
    const original = { userId, data, updatedAt: new Date().toISOString() };
    const db = new Dexie('ExerciseTracker');
    db.version(3).stores({ appData: '&userId, updatedAt' });
    await db.table('appData').put(original); db.close();
    const interrupted = new ExerciseTrackerDb();
    interrupted.version(7).stores({}).upgrade(() => { throw new Error('Synthetic interruption after v6 changes'); });
    await expect(interrupted.open()).rejects.toThrow('Synthetic interruption');
    interrupted.close();
    const raw = new Dexie('ExerciseTracker'); await raw.open();
    expect(raw.verno).toBe(3);
    expect(await raw.table('appData').get(userId)).toEqual(original);
    raw.close();
    await offlineDb.open();
    expect((await ready()).data.sessions[0].sets[0].actual.reps).toBe(7);
    expect(await createRawRecoveryExport(userId)).toContain('rightReps');
  });
  it.each([2, 3, 4, 5])('upgrades installed schema v%i without changing history', async (version) => {
    const data = fixture();
    const db = new Dexie('ExerciseTracker');
    db.version(version).stores({ appData: '&userId, updatedAt' });
    await db.table('appData').put({ userId, data, updatedAt: new Date().toISOString() });
    db.close();
    await offlineDb.open();
    expect((await ready()).data).toEqual(data);
    expect(await offlineDb.recoverySources.count()).toBeGreaterThan(0);
  });
  it('preserves side-specific originals before normalising v3 data', async () => {
    const data = fixture();
    Object.assign(data.sessions[0].sets[0].actual, { leftReps: 8, rightReps: 7, reps: 8 });
    const db = new Dexie('ExerciseTracker');
    db.version(3).stores({ appData: '&userId, updatedAt' });
    await db.table('appData').put({ userId, data, updatedAt: new Date().toISOString() }); db.close();
    expect((await ready()).data.sessions[0].sets[0].actual.reps).toBe(7);
    expect(await createRawRecoveryExport(userId)).toContain('rightReps');
  });
  it.each([1, 3, 5])('invalid v%i sources remain recoverable and a valid import can replace the head', async (version) => {
    const db = new Dexie('ExerciseTracker');
    const raw = JSON.stringify({ ...fixture(), sessions: 'invalid-original' });
    if (version === 1) {
      db.version(1).stores({ activeWorkouts: 'id, userId, updatedAt', syncQueue: 'id, userId, createdAt, type' });
      await db.table('activeWorkouts').put({ id: userId, userId, activeWorkout: fixture().activeWorkout });
      localStorage.setItem(key, raw);
    } else {
      db.version(version).stores({ appData: '&userId, updatedAt' });
      await db.table('appData').put({ userId, data: JSON.parse(raw), updatedAt: new Date().toISOString() });
    }
    db.close();
    const result = await loadAppData(userId);
    expect(result.kind).toBe('recovery_required');
    expect(await createRawRecoveryExport(userId)).toContain('invalid-original');
    if (result.kind !== 'recovery_required') throw new Error('Expected recovery');
    await commitAppData(fixture(), result.revision, 'import');
    expect((await ready()).data.sessions).toHaveLength(1);
    expect(await createRawRecoveryExport(userId)).toContain('invalid-original');
  });
  it('archives legacy active workouts and the retired queue before removing their tables', async () => {
    const data = fixture();
    localStorage.setItem(key, JSON.stringify(data));
    const db = new Dexie('ExerciseTracker');
    db.version(1).stores({ activeWorkouts: 'id, userId, updatedAt', syncQueue: 'id, userId, createdAt, type' });
    await db.table('activeWorkouts').put({ id: userId, userId, activeWorkout: data.activeWorkout });
    await db.table('syncQueue').put({ id: 'old-queued', userId, payload: data.sessions[0] });
    db.close();
    expect((await ready()).data.activeWorkout).toEqual(data.activeWorkout);
    const raw = await createRawRecoveryExport(userId);
    expect(raw).toContain('old-queued');
    expect(raw).toContain('legacy-active-workout');
    expect(offlineDb.tables.map((table) => table.name)).not.toContain('syncQueue');
  });
});
