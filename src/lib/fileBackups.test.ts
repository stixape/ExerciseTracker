import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppData } from '../domain/sampleData';
import { createJsonExport } from '../domain/export';
import { parseJsonImport } from './localData';
import { commitAppData, offlineDb, workoutBackupKeys } from './offlineDb';
import { backupToFolder, folderBackupFilename, verifyBackupFile, type BackupDirectory, type BackupFile } from './fileBackups';
import { flushWorkoutBackups } from './workoutBackups';
import { completeSessionIfDone, completeSet, createSessionFromDay } from '../domain/session';
import type { AppSnapshot } from './offlineDb';

function directoryFixture() {
  const files = new Map<string, string>();
  let allowed = true;
  let failClose = false;
  let failRemove = false;
  const directory: BackupDirectory = {
    kind: 'directory',
    queryPermission: async () => allowed ? 'granted' : 'denied',
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('Not found', 'NotFoundError');
        files.set(name, '');
      }
      return {
        kind: 'file',
        getFile: async () => ({ text: async () => files.get(name)! } as File),
        createWritable: async () => {
          let pending = '';
          return { write: async (data: string) => { pending = data; }, close: async () => { if (failClose) throw new Error('Synthetic disk failure'); files.set(name, pending); }, abort: async () => undefined };
        },
      };
    },
    async *entries() { for (const name of files.keys()) yield [name, await directory.getFileHandle(name)] as [string, BackupFile]; },
    async removeEntry(name) { if (failRemove) throw new Error('Read-only file'); files.delete(name); },
  };
  return { files, directory, deny: () => { allowed = false; }, fail: () => { failClose = true; },
    failRemove: () => { failRemove = true; }, repair: () => { allowed = true; failClose = false; failRemove = false; } };
}
beforeEach(async () => { localStorage.clear(); await offlineDb.delete(); await offlineDb.open(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); offlineDb.close(); });

describe('independent folder files', () => {
  it('reads back, validates and records the exact committed revision', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    const result = await backupToFolder(saved);
    expect(result?.snapshotId).toBe(saved.snapshotId);
    expect(mock.files.size).toBe(1);
    expect((await offlineDb.preferences.toArray()).find((item) => item.key === 'last-file-backup')?.value).toEqual(result);
    await backupToFolder(saved);
    expect(mock.files.size).toBe(1);
  });
  it('does not claim success after disk failure or delete the previous copy', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const first = await commitAppData(createDefaultAppData('local-user'), null);
    await backupToFolder(first);
    const original = [...mock.files.values()][0];
    mock.fail();
    const next = await commitAppData({ ...first.data, settings: { hideRestTimes: true } }, 1);
    await expect(backupToFolder(next)).rejects.toThrow();
    expect([...mock.files.values()]).toContain(original);
    const status = (await offlineDb.preferences.toArray()).find((item) => item.key === 'last-file-backup')?.value;
    expect(status).toMatchObject({ snapshotId: first.snapshotId });
  });
  it('preserves files when folder permission is revoked', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    await backupToFolder(saved);
    mock.deny();
    await expect(backupToFolder(saved)).rejects.toThrow('Reconnect');
    expect(mock.files.size).toBe(1);
  });
  it('never overwrites an invalid existing file or deletes unrelated files', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    const name = folderBackupFilename(saved);
    mock.files.set(name, 'interrupted original');
    mock.files.set('unrelated.json', 'keep');
    expect((await backupToFolder(saved))?.snapshotId).toBe(saved.snapshotId);
    expect(mock.files.get(name)).toBe('interrupted original');
    expect(mock.files.get('unrelated.json')).toBe('keep');
    expect([...mock.files.keys()].some((key) => key.includes('.attempt-'))).toBe(true);
  });
  it('keeps the newly verified file even when older files have future timestamps', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    for (let index = 0; index < 40; index++) {
      const future = { ...saved, snapshotId: 'snapshot_future_' + index, revision: index + 20, updatedAt: new Date(Date.UTC(2030, 0, index + 1)).toISOString() };
      mock.files.set(folderBackupFilename(future), createJsonExport(future.data, { snapshotId: future.snapshotId, revision: future.revision, savedAt: future.updatedAt }));
    }
    await backupToFolder(saved);
    expect(await verifyBackupFile(mock.files.get(folderBackupFilename(saved))!, saved)).toMatchObject({ snapshotId: saved.snapshotId });
  });
  it('keeps the external file restorable after all synthetic browser data is lost', async () => {
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    const file = createJsonExport(saved.data, { snapshotId: saved.snapshotId, revision: saved.revision, savedAt: saved.updatedAt });
    await offlineDb.delete(); localStorage.clear(); await offlineDb.open();
    const verified = await verifyBackupFile(file);
    expect(verified.snapshotId).toBe(saved.snapshotId);
    const parsed = parseJsonImport(file, 'local-user');
    if (!parsed.ok) throw new Error(parsed.error);
    const restored = await commitAppData(parsed.data, null, 'restore');
    expect(restored.data).toEqual(saved.data);
  });
});

function connect(directory: BackupDirectory) {
  vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: directory });
  let lock: Promise<unknown> = Promise.resolve();
  vi.stubGlobal('navigator', { locks: { request: (_name: string, operation: () => Promise<unknown>) => {
    const result = lock.then(operation);
    lock = result.catch(() => undefined);
    return result;
  } } });
}

async function saveWorkout(previous: AppSnapshot) {
  const session = createSessionFromDay(previous.data.template.days[0]);
  const completed = completeSessionIfDone(session.sets.reduce((current, set) => completeSet(current, set.id, set.actual), session));
  return commitAppData({ ...previous.data, sessions: [completed, ...previous.data.sessions] }, previous.revision, 'workout');
}

describe('automatic workout backup rotation', () => {
  it('backs up exact commits in order across clock changes and serializes concurrent retries', async () => {
    const mock = directoryFixture();
    connect(mock.directory);
    mock.files.set('manual.json', 'untouched');
    const initial = await commitAppData(createDefaultAppData('local-user'), null);
    expect(await flushWorkoutBackups('local-user')).toBe('idle');
    const first = await saveWorkout(initial);
    const second = await saveWorkout(first);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-01-01T10:00:00Z'));
    let third;
    try { third = await saveWorkout(second); }
    finally { vi.useRealTimers(); }
    const later = await commitAppData({ ...third.data, settings: { hideRestTimes: true } }, third.revision);
    expect(await Promise.all([flushWorkoutBackups('local-user'), flushWorkoutBackups('local-user')])).toEqual(['verified', 'idle']);
    expect(mock.files.get('manual.json')).toBe('untouched');
    expect(mock.files.size).toBe(3);
    const newest = [...mock.files.values()].find((raw) => raw.includes(third.snapshotId))!;
    expect(await verifyBackupFile(newest, third)).toMatchObject({ snapshotId: third.snapshotId });
    expect(parseJsonImport(newest, 'local-user')).toEqual({ ok: true, data: third.data });
    expect(later.data.settings.hideRestTimes).toBe(true);
    expect([...mock.files.values()].some((raw) => raw.includes(first.snapshotId))).toBe(false);
    expect([...mock.files.values()].some((raw) => raw.includes(second.snapshotId))).toBe(true);
    await offlineDb.delete();
    await offlineDb.open();
    const restored = parseJsonImport(newest, 'local-user');
    expect(restored.ok && (await commitAppData(restored.data, null, 'restore')).data.sessions).toEqual(third.data.sessions);
  });

  it('keeps the newest pending versions while permission is revoked and retries on reconnection', async () => {
    const mock = directoryFixture();
    connect(mock.directory);
    const initial = await commitAppData(createDefaultAppData('local-user'), null);
    mock.deny();
    const first = await saveWorkout(initial);
    const second = await saveWorkout(first);
    const third = await saveWorkout(second);
    expect(await flushWorkoutBackups('local-user')).toBe('reconnect');
    expect(await workoutBackupKeys('local-user')).toEqual([second.snapshotId, third.snapshotId]);
    expect(mock.files.size).toBe(0);
    mock.repair();
    expect(await flushWorkoutBackups('local-user')).toBe('verified');
    expect(await workoutBackupKeys('local-user')).toEqual([]);
    expect(mock.files.size).toBe(2);
  });

  it('preserves the previous backups across write and cleanup failures and safely retries both', async () => {
    const mock = directoryFixture();
    connect(mock.directory);
    const initial = await commitAppData(createDefaultAppData('local-user'), null);
    const first = await saveWorkout(initial);
    const second = await saveWorkout(first);
    expect(await flushWorkoutBackups('local-user')).toBe('verified');
    const previousFiles = [...mock.files.keys()];
    const third = await saveWorkout(second);
    mock.fail();
    expect(await flushWorkoutBackups('local-user')).toBe('failed');
    expect(previousFiles.every((file) => mock.files.has(file))).toBe(true);
    expect(await workoutBackupKeys('local-user')).toEqual([third.snapshotId]);
    mock.repair();
    mock.failRemove();
    expect(await flushWorkoutBackups('local-user')).toBe('cleanup');
    expect(previousFiles.every((file) => mock.files.has(file))).toBe(true);
    const afterWrite = mock.files.size;
    mock.repair();
    expect(await flushWorkoutBackups('local-user')).toBe('verified');
    expect(mock.files.size).toBe(afterWrite - 1);
    expect(previousFiles.filter((file) => mock.files.has(file))).toHaveLength(1);
    expect([...mock.files.values()].filter((raw) => raw.includes(third.snapshotId))).toHaveLength(1);
  });
});
