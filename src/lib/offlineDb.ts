import Dexie, { type EntityTable } from 'dexie';
import type { ActiveWorkout, QueuedSyncItem } from '../domain/types';

interface ActiveWorkoutRecord {
  id: string;
  userId: string;
  updatedAt: string;
  activeWorkout: ActiveWorkout;
}

class ExerciseTrackerDb extends Dexie {
  activeWorkouts!: EntityTable<ActiveWorkoutRecord, 'id'>;
  syncQueue!: EntityTable<QueuedSyncItem, 'id'>;

  constructor() {
    super('ExerciseTracker');
    this.version(1).stores({
      activeWorkouts: 'id, userId, updatedAt',
      syncQueue: 'id, userId, createdAt, type',
    });
  }
}

export const offlineDb = new ExerciseTrackerDb();

export async function saveActiveWorkout(userId: string, activeWorkout: ActiveWorkout): Promise<void> {
  await offlineDb.activeWorkouts.put({
    id: userId,
    userId,
    updatedAt: new Date().toISOString(),
    activeWorkout,
  });
}

export async function loadActiveWorkout(userId: string): Promise<ActiveWorkout | undefined> {
  const record = await offlineDb.activeWorkouts.get(userId);
  return record?.activeWorkout;
}

export async function clearActiveWorkout(userId: string): Promise<void> {
  await offlineDb.activeWorkouts.delete(userId);
}

export async function queueCompletedSession(item: QueuedSyncItem): Promise<void> {
  await offlineDb.syncQueue.put(item);
}

export async function listQueuedSessions(userId: string): Promise<QueuedSyncItem[]> {
  return offlineDb.syncQueue.where('userId').equals(userId).toArray();
}
