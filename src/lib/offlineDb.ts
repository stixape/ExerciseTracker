import Dexie, { type EntityTable, type Transaction } from 'dexie';
import { createDefaultAppData } from '../domain/sampleData';
import type { ActiveWorkout, AppData } from '../domain/types';
import { validateAppData, validateActiveWorkoutData } from './appDataSchema';
import { clearLegacyLocalData, hasLegacyLocalData, readLegacyLocalData, restoreAppData } from './localData';

interface AppDataRecord {
  userId: string;
  updatedAt: string;
  data: AppData;
}

interface LegacyActiveWorkoutRecord {
  id: string;
  userId: string;
  updatedAt: string;
  activeWorkout: ActiveWorkout;
}

class ExerciseTrackerDb extends Dexie {
  appData!: EntityTable<AppDataRecord, 'userId'>;

  constructor() {
    super('ExerciseTracker');

    // Historical schema retained so Dexie can upgrade existing installations.
    this.version(1).stores({
      activeWorkouts: 'id, userId, updatedAt',
      syncQueue: 'id, userId, createdAt, type',
    });

    // Copy a legacy active workout into the canonical snapshot and remove the
    // unused sync queue. The localStorage snapshot remains until a verified read.
    this.version(2)
      .stores({
        appData: '&userId, updatedAt',
        activeWorkouts: 'id, userId, updatedAt',
        syncQueue: null,
      })
      .upgrade((transaction) => migrateVersionOne(transaction));

    // appData is now the only source of truth.
    this.version(3).stores({
      appData: '&userId, updatedAt',
      activeWorkouts: null,
    });

    // Remove the retired left/right repetition shape from every canonical
    // snapshot while preserving workouts, set counts, and recorded rests.
    this.version(4)
      .stores({
        appData: '&userId, updatedAt',
      })
      .upgrade((transaction) => migrateVersionThree(transaction));

    // Replace the retired light/dark preference with the workout rest setting.
    this.version(5)
      .stores({
        appData: '&userId, updatedAt',
      })
      .upgrade((transaction) => migrateVersionFour(transaction));
  }
}

async function migrateVersionOne(transaction: Transaction): Promise<void> {
  const activeRecords = await transaction.table<LegacyActiveWorkoutRecord>('activeWorkouts').toArray();
  const appDataTable = transaction.table<AppDataRecord>('appData');

  for (const record of activeRecords) {
    const legacyData = readLegacyLocalData(record.userId);
    const baseData = legacyData ?? createDefaultAppData(record.userId);
    const candidate =
      baseData.activeWorkout || !validateActiveWorkoutData(record.activeWorkout, baseData.bandColours)
        ? baseData
        : { ...baseData, activeWorkout: record.activeWorkout };
    const restored = restoreAppData(candidate, record.userId);
    if (!restored.ok) continue;

    await appDataTable.put({
      userId: record.userId,
      updatedAt: record.updatedAt,
      data: restored.data,
    });
  }
}

async function migrateVersionThree(transaction: Transaction): Promise<void> {
  const appDataTable = transaction.table<AppDataRecord>('appData');
  const records = await appDataTable.toArray();

  for (const record of records) {
    const restored = restoreAppData(record.data, record.userId, false);
    if (!restored.ok) throw new Error(`Stored ExerciseTracker data could not be upgraded: ${restored.error}`);
    await appDataTable.put({ ...record, data: restored.data });
  }
}

async function migrateVersionFour(transaction: Transaction): Promise<void> {
  const appDataTable = transaction.table<AppDataRecord>('appData');
  const records = await appDataTable.toArray();

  for (const record of records) {
    const restored = restoreAppData(record.data, record.userId, false, false, true);
    if (!restored.ok) throw new Error(`Stored ExerciseTracker settings could not be upgraded: ${restored.error}`);
    await appDataTable.put({ ...record, data: restored.data });
  }
}

export const offlineDb = new ExerciseTrackerDb();

const writeTails = new Map<string, Promise<void>>();

function afterPendingWrite(userId: string): Promise<void> {
  return writeTails.get(userId)?.catch(() => undefined) ?? Promise.resolve();
}

function enqueueWrite(userId: string, write: () => Promise<void>): Promise<void> {
  const previous = afterPendingWrite(userId);
  const operation = previous.then(write);
  writeTails.set(userId, operation);
  operation.then(
    () => {
      if (writeTails.get(userId) === operation) writeTails.delete(userId);
    },
    () => {
      if (writeTails.get(userId) === operation) writeTails.delete(userId);
    },
  );
  return operation;
}

/** Loads the sole canonical snapshot, migrating legacy localStorage once. */
export async function loadAppData(userId: string): Promise<AppData> {
  await afterPendingWrite(userId);
  const record = await offlineDb.appData.get(userId);
  if (record) {
    const restored = restoreAppData(record.data, userId, false);
    if (restored.ok) {
      if (hasLegacyLocalData(userId)) clearLegacyLocalData(userId);
      return restored.data;
    }
    throw new Error(`Stored ExerciseTracker data is invalid and was left untouched: ${restored.error}`);
  }

  const hadLegacyRecord = hasLegacyLocalData(userId);
  const legacyData = readLegacyLocalData(userId);
  const data = legacyData ?? createDefaultAppData(userId);
  await saveAppData(data);
  if (hadLegacyRecord) clearLegacyLocalData(userId);
  return data;
}

/** Serializes writes per user so rapid React updates cannot complete out of order. */
export async function saveAppData(data: AppData): Promise<void> {
  const validation = validateAppData(data);
  if (!validation.ok) throw new TypeError(`ExerciseTracker data could not be saved: ${validation.error}`);
  const snapshot = structuredClone(validation.data);

  await enqueueWrite(data.userId, async () => {
    await offlineDb.appData.put({
      userId: data.userId,
      updatedAt: new Date().toISOString(),
      data: snapshot,
    });
  });
}

export async function resetAppData(userId: string): Promise<AppData> {
  const data = createDefaultAppData(userId);
  await saveAppData(data);
  clearLegacyLocalData(userId);
  return data;
}

export async function clearAppData(userId: string): Promise<void> {
  await enqueueWrite(userId, () => offlineDb.appData.delete(userId));
  clearLegacyLocalData(userId);
}
