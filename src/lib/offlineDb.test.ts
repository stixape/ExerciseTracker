import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTemplate } from '../domain/sampleData';
import { createSessionFromDay } from '../domain/session';
import { clearActiveWorkout, listQueuedSessions, loadActiveWorkout, offlineDb, queueCompletedSession, resetOfflineData, saveActiveWorkout } from './offlineDb';

const userId = 'local-user';

describe('offline IndexedDB storage', () => {
  beforeEach(async () => {
    await offlineDb.delete();
    await offlineDb.open();
  });

  afterEach(() => {
    offlineDb.close();
  });

  it('saves and clears an active workout', async () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);

    await saveActiveWorkout(userId, { session });
    expect((await loadActiveWorkout(userId))?.session.id).toBe(session.id);

    await clearActiveWorkout(userId);
    expect(await loadActiveWorkout(userId)).toBeUndefined();
  });

  it('queues completed sessions and resets local offline records for one user', async () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);

    await saveActiveWorkout(userId, { session });
    await queueCompletedSession({
      id: 'sync-local',
      userId,
      createdAt: '2026-01-01T10:00:00.000Z',
      type: 'session_completed',
      payload: session,
    });
    await queueCompletedSession({
      id: 'sync-other',
      userId: 'other-user',
      createdAt: '2026-01-01T10:00:00.000Z',
      type: 'session_completed',
      payload: session,
    });

    expect(await listQueuedSessions(userId)).toHaveLength(1);

    await resetOfflineData(userId);

    expect(await loadActiveWorkout(userId)).toBeUndefined();
    expect(await listQueuedSessions(userId)).toEqual([]);
    expect(await listQueuedSessions('other-user')).toHaveLength(1);
  });
});
