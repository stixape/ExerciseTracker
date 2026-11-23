import Dexie, { type EntityTable, type Transaction } from 'dexie';
import { createId } from '../domain/ids';
import { unifyLivePlan } from '../domain/plan';
import type { ActiveWorkout, AppData } from '../domain/types';
import { validateAppData, validateActiveWorkoutData } from './appDataSchema';
import { readLegacyLocalData, readLegacyRaw, restoreAppData } from './localData';
import { checksum } from './backupFormat';

export interface AppSnapshot {
  userId: string;
  updatedAt: string;
  revision: number;
  snapshotId: string;
  checksum: string;
  data: AppData;
}
interface StoredRecord extends Partial<Omit<AppSnapshot, 'userId' | 'updatedAt' | 'data'>> {
  userId: string;
  updatedAt: string;
  data: AppData;
}
export type CheckpointReason = 'edit' | 'workout' | 'set' | 'import' | 'reset' | 'restore' | 'migration' | 'initialise';
export interface Checkpoint extends AppSnapshot {
  id: string;
  reason: CheckpointReason;
  createdAt: string;
  pinned: boolean;
}
export interface CheckpointSummary {
  id: string; userId: string; revision: number; createdAt: string;
  pinned: boolean; reason: CheckpointReason; planName: string; sessionCount: number;
}
interface RecoverySource { id: string; userId: string; createdAt: string; source: string; raw: unknown }
export interface Preference { key: string; value: unknown }
export interface WorkoutBackupJob {
  snapshotId: string;
  userId: string;
  revision: number;
  /** The canonical record supplies the payload until another revision replaces it. */
  snapshot?: AppSnapshot;
}
export type LoadResult = { kind: 'ready'; snapshot: AppSnapshot } | { kind: 'empty' } |
  { kind: 'recovery_required'; reason: string; revision: number | null };

export class StorageConflictError extends Error {
  constructor() { super('Another window changed the saved data. Your unsaved changes have been kept. Reload and review before saving.'); this.name = 'StorageConflictError'; }
}

const sourceSchema = 'id, userId, createdAt';
export class ExerciseTrackerDb extends Dexie {
  appData!: EntityTable<StoredRecord, 'userId'>;
  checkpoints!: EntityTable<Checkpoint, 'id'>;
  checkpointIndex!: EntityTable<CheckpointSummary, 'id'>;
  recoverySources!: EntityTable<RecoverySource, 'id'>;
  preferences!: EntityTable<Preference, 'key'>;
  workoutBackupJobs!: EntityTable<WorkoutBackupJob, 'snapshotId'>;

  constructor(name = 'ExerciseTracker') {
    super(name, { chromeTransactionDurability: 'strict' });
    this.version(1).stores({ activeWorkouts: 'id, userId, updatedAt', syncQueue: 'id, userId, createdAt, type' });
    // Dexie removes retired tables AFTER their content upgrade, atomically.
    // Archive the original sources before any historical normalization/removal.
    this.version(2).stores({ appData: '&userId, updatedAt', activeWorkouts: 'id, userId, updatedAt', syncQueue: null, recoverySources: sourceSchema })
      .upgrade(migrateVersionOne);
    this.version(3).stores({ appData: '&userId, updatedAt', activeWorkouts: null });
    this.version(4).stores({ appData: '&userId, updatedAt', recoverySources: sourceSchema }).upgrade(migrateCanonical);
    this.version(5).stores({ appData: '&userId, updatedAt', recoverySources: sourceSchema }).upgrade(migrateCanonical);
    this.version(6).stores({ appData: '&userId, updatedAt', recoverySources: sourceSchema,
      checkpoints: 'id, userId, createdAt', checkpointIndex: 'id, userId, createdAt', preferences: '&key' }).upgrade(async (tx) => {
      const table = tx.table<StoredRecord>('appData');
      for (const record of await table.toArray()) {
        await archive(tx, record.userId, 'schema-v6', record);
        const result = restoreAppData(record.data, record.userId, false);
        // Finish the structural upgrade even for invalid business data so a
        // confirmed restore can run. Its exact source is retained above; no
        // invalid value is normalized into defaults or exposed as ready data.
        await table.put(makeSnapshot(result.ok ? result.data : record.data, 1));
      }
    });
    this.version(7).stores({ workoutBackupJobs: '&snapshotId, [userId+revision]' });
    // Older clients cannot safely open sessions containing Interval.
    this.version(8).stores({});
    this.version(9).stores({}).upgrade(migrateUniformPlan);
  }
}

async function archive(tx: Transaction, userId: string, source: string, raw: unknown) {
  await tx.table<RecoverySource>('recoverySources').put({ id: createId('source'), userId, source, raw, createdAt: new Date().toISOString() });
}

async function migrateVersionOne(tx: Transaction) {
  for (const queued of await tx.table<{ userId: string }>('syncQueue').toArray()) await archive(tx, queued.userId, 'legacy-sync-queue', queued);
  const activeRecords = await tx.table<{ userId: string; activeWorkout: ActiveWorkout }>('activeWorkouts').toArray();
  for (const record of activeRecords) {
    await archive(tx, record.userId, 'legacy-active-workout', record);
    let legacy: ReturnType<typeof readLegacyLocalData>;
    try { legacy = readLegacyLocalData(record.userId); }
    catch { await archive(tx, record.userId, 'unconverted-active-workout', record); continue; }
    if (legacy.kind === 'invalid') { await archive(tx, record.userId, 'unconverted-localStorage', legacy.raw); continue; }
    if (legacy.kind === 'absent') { await archive(tx, record.userId, 'unconverted-active-workout', record); continue; }
    const base = legacy.data;
    await archive(tx, record.userId, 'legacy-localStorage', legacy.raw);
    if (!validateActiveWorkoutData(record.activeWorkout, base.bandColours)) { await archive(tx, record.userId, 'unconverted-active-workout', record); continue; }
    const candidate = base.activeWorkout ? base : { ...base, activeWorkout: record.activeWorkout };
    const restored = restoreAppData(candidate, record.userId);
    if (!restored.ok) { await archive(tx, record.userId, 'unconverted-active-workout', record); continue; }
    await tx.table<StoredRecord>('appData').put({ userId: record.userId, updatedAt: new Date().toISOString(), data: restored.data });
  }
}

async function migrateCanonical(tx: Transaction) {
  const table = tx.table<StoredRecord>('appData');
  for (const record of await table.toArray()) {
    await archive(tx, record.userId, 'historical-schema', record);
    const restored = restoreAppData(record.data, record.userId, false);
    if (restored.ok) await table.put({ ...record, data: restored.data });
  }
}

async function migrateUniformPlan(tx: Transaction) {
  const table = tx.table<StoredRecord>('appData');
  const jobs = tx.table<WorkoutBackupJob>('workoutBackupJobs');
  for (const record of await table.toArray()) {
    if (!record.snapshotId || !Number.isSafeInteger(record.revision) || record.revision! < 1 ||
      record.checksum !== checksum(record.data) || !validateAppData(record.data).ok) continue;
    const data = unifyLivePlan(record.data);
    if (data === record.data) continue;
    await archive(tx, record.userId, 'before-uniform-plan', record);
    const job = await jobs.get(record.snapshotId);
    if (job && !job.snapshot) await jobs.put({ ...job, snapshot: record as AppSnapshot });
    await table.put(makeSnapshot(data, record.revision! + 1));
  }
}

function makeSnapshot(data: AppData, revision: number): AppSnapshot {
  return { userId: data.userId, revision, data: structuredClone(data), updatedAt: new Date().toISOString(),
    snapshotId: createId('snapshot'), checksum: checksum(data) };
}
function revisionOf(record: StoredRecord | undefined): number | null {
  return record ? Number.isSafeInteger(record.revision) && record.revision! >= 0 ? record.revision! : 0 : null;
}
function isPinned(reason: CheckpointReason) { return ['import', 'reset', 'restore', 'migration'].includes(reason); }

/** Shared retention rule for local checkpoints and independently verified files. */
export function retainedCheckpointIds(records: { id: string; createdAt: string; pinned: boolean; revision?: number }[]): Set<string> {
  const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.revision ?? 0) - (a.revision ?? 0) || b.id.localeCompare(a.id));
  const keep = new Set(sorted.slice(0, 20).map((item) => item.id));
  const days = new Set<string>();
  for (const record of sorted) {
    const day = record.createdAt.slice(0, 10);
    if (record.pinned || (!days.has(day) && days.size < 30)) keep.add(record.id);
    days.add(day);
  }
  return keep;
}

export const offlineDb = new ExerciseTrackerDb();

export async function loadAppData(userId: string): Promise<LoadResult> {
  try {
    if (!offlineDb.isOpen()) await offlineDb.open();
    const record = await offlineDb.appData.get(userId);
    if (record) {
      const restored = restoreAppData(record.data, userId, false);
      if (!restored.ok || !Number.isSafeInteger(record.revision) || record.revision! < 1 ||
        !record.snapshotId || record.checksum !== checksum(record.data) || (restored.ok && record.checksum !== checksum(restored.data))) {
        return { kind: 'recovery_required', reason: 'Saved data failed validation. The original record has been left untouched.', revision: revisionOf(record) };
      }
      return { kind: 'ready', snapshot: { ...record, data: restored.data } as AppSnapshot };
    }
    const legacy = readLegacyLocalData(userId);
    const sources = await offlineDb.recoverySources.where('userId').equals(userId).toArray();
    if (sources.some((source) => source.source.startsWith('unconverted-'))) return { kind: 'recovery_required', reason: 'Original legacy records are retained but need recovery. No starter plan was written.', revision: null };
    if (legacy.kind === 'invalid') return { kind: 'recovery_required', reason: 'Legacy data could not be read. Its original contents have been preserved.', revision: null };
    if (legacy.kind === 'valid') return { kind: 'ready', snapshot: await commitAppData(unifyLivePlan(legacy.data), null, 'migration') };
    return { kind: 'empty' };
  } catch {
    return { kind: 'recovery_required', reason: 'Saved data could not be opened. No starter plan was written. Export the original records or try reopening the app.', revision: null };
  }
}

/** A cross-window compare-and-replace transaction, never an unconditional put. */
export async function commitAppData(data: AppData, expectedRevision: number | null, reason: CheckpointReason = 'edit'): Promise<AppSnapshot> {
  const validation = validateAppData(data);
  if (!validation.ok) throw new TypeError('Data validation failed; the saved record was not changed.');
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER)) throw new TypeError('Invalid revision.');
  const next = makeSnapshot(data, (expectedRevision ?? 0) + 1);
  await offlineDb.transaction('rw', [offlineDb.appData, offlineDb.checkpoints, offlineDb.checkpointIndex, offlineDb.recoverySources, offlineDb.preferences, offlineDb.workoutBackupJobs], async (tx) => {
    const previous = await offlineDb.appData.get(data.userId);
    if (revisionOf(previous) !== expectedRevision) throw new StorageConflictError();
    if (previous && isPinned(reason)) await archive(tx, data.userId, `before-${reason}`, previous);
    if (isPinned(reason)) {
      let legacyRaw: string | null = null;
      try { legacyRaw = readLegacyRaw(data.userId); } catch { /* Inaccessible legacy storage is never changed or cleared. */ }
      if (legacyRaw !== null) await archive(tx, data.userId, `legacy-before-${reason}`, legacyRaw);
    }
    // Enumerate only small summaries during ordinary saves. Reading dozens of
    // full-history snapshots on every keystroke is prohibitively expensive.
    const records = await offlineDb.checkpointIndex.where('userId').equals(data.userId).toArray();
    const lastEdit = records.filter((item) => item.reason === 'edit' && typeof item.createdAt === 'string').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const checkpointDue = reason !== 'edit' || !lastEdit || Date.parse(next.updatedAt) - Date.parse(lastEdit.createdAt) >= 1_000;
    if (previous?.revision && checkpointDue && validateAppData(previous.data).ok && previous.checksum === checksum(previous.data)) {
      await offlineDb.checkpoints.put({ ...previous, id: previous.snapshotId!, revision: previous.revision,
        snapshotId: previous.snapshotId!, checksum: previous.checksum!, createdAt: previous.updatedAt, pinned: isPinned(reason), reason });
      await offlineDb.checkpointIndex.put({ id: previous.snapshotId!, userId: previous.userId, revision: previous.revision,
        createdAt: previous.updatedAt, pinned: isPinned(reason), reason, planName: previous.data.template.name, sessionCount: previous.data.sessions.length });
    }
    if (previous?.snapshotId) {
      const job = await offlineDb.workoutBackupJobs.get(previous.snapshotId);
      if (job) await offlineDb.workoutBackupJobs.put({ ...job, snapshot: previous as AppSnapshot });
    }
    await offlineDb.appData.put(next);
    if (reason === 'workout') {
      await offlineDb.workoutBackupJobs.put({ snapshotId: next.snapshotId, userId: next.userId, revision: next.revision });
    }
    if (['initialise', 'import', 'reset', 'restore'].includes(reason)) {
      await offlineDb.preferences.put({ key: 'remote-approved', value: false });
      // A new restore/reset lineage cannot prune the previous installation's
      // remote stream, even if it happened offline before a protected upload.
      await offlineDb.preferences.delete('backup-device-id');
    }
    const currentRecords = (await offlineDb.checkpointIndex.where('userId').equals(data.userId).toArray())
      .filter((item) => typeof item.id === 'string' && typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt)));
    const keep = retainedCheckpointIds(currentRecords);
    for (const item of currentRecords.filter((record) => !keep.has(record.id))) {
      const payload = await offlineDb.checkpoints.get(item.id);
      if (payload && !isValidCheckpoint(payload)) { await offlineDb.checkpointIndex.put({ ...item, pinned: true }); continue; }
      await offlineDb.checkpoints.delete(item.id);
      await offlineDb.checkpointIndex.delete(item.id);
    }
  });
  return next;
}

export function workoutBackupKeys(userId: string): Promise<string[]> {
  return offlineDb.workoutBackupJobs.where('[userId+revision]').between([userId, 0], [userId, Number.MAX_SAFE_INTEGER], true, true).primaryKeys();
}

export async function retainPendingWorkoutBackups(userId: string): Promise<void> {
  await offlineDb.transaction('rw', offlineDb.workoutBackupJobs, async () => {
    const keys = await workoutBackupKeys(userId);
    await offlineDb.workoutBackupJobs.bulkDelete(keys.slice(0, -2));
  });
}

export async function readWorkoutBackup(userId: string, id: string): Promise<AppSnapshot | undefined> {
  return offlineDb.transaction('r', [offlineDb.appData, offlineDb.workoutBackupJobs], async () => {
    const job = await offlineDb.workoutBackupJobs.get(id);
    if (!job || job.userId !== userId) return undefined;
    const record = job.snapshot ?? await offlineDb.appData.get(userId);
    if (record?.snapshotId !== id || record.revision !== job.revision || !record.checksum) throw new Error('Workout backup revision could not be opened.');
    return record as AppSnapshot;
  });
}

export async function listCheckpoints(userId: string): Promise<CheckpointSummary[]> {
  return (await offlineDb.checkpointIndex.where('userId').equals(userId).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision);
}
export async function readCheckpoint(userId: string, id: string): Promise<Checkpoint> {
  const record = await offlineDb.checkpoints.get(id);
  if (!record || record.userId !== userId || !isValidCheckpoint(record)) throw new Error('This checkpoint cannot be restored. Its original data was preserved.');
  return record;
}

function isValidCheckpoint(record: Checkpoint): boolean {
  return typeof record.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt)) &&
    validateAppData(record.data).ok && checksum(record.data) === record.checksum;
}

/** Versionless read-only access also works after a rolled-back schema upgrade. */
export async function createRawRecoveryExport(userId: string): Promise<string> {
  const rawDb = new Dexie('ExerciseTracker');
  try {
    await rawDb.open();
    const tables: Record<string, unknown> = {};
    for (const table of rawDb.tables.filter((item) => item.name !== 'preferences')) {
      tables[table.name] = (await table.toArray()).filter((item: { userId?: string }) => item.userId === userId);
    }
    let legacy: string | null | { unavailable: true };
    try { legacy = readLegacyRaw(userId); } catch { legacy = { unavailable: true }; }
    return JSON.stringify({ format: 'ExerciseTracker raw recovery sources', exportedAt: new Date().toISOString(), tables, legacy }, null, 2);
  } finally { rawDb.close(); }
}
