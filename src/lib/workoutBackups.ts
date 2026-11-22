import { requireFolderPermission, supportsFolderBackup, verifyBackupFile, writeSnapshotFile, type BackupDirectory, type BackupFile, type VerifiedFileBackup } from './fileBackups';
import { offlineDb, readWorkoutBackup, retainPendingWorkoutBackups, workoutBackupKeys, type AppSnapshot } from './offlineDb';

const namePattern = /^exercise-tracker-workout-(\d+)-(\d+)-(snapshot_[a-zA-Z0-9_-]+)\.json$/;

interface WorkoutFile {
  name: string;
  handle: BackupFile;
  sequence: number;
  revision: number;
  snapshotId: string;
}

async function listFiles(directory: BackupDirectory): Promise<WorkoutFile[]> {
  const files: WorkoutFile[] = [];
  for await (const [name, handle] of directory.entries()) {
    const match = namePattern.exec(name);
    if (handle.kind !== 'file' || !match) continue;
    const sequence = Number(match[1]);
    const revision = Number(match[2]);
    if (Number.isSafeInteger(sequence) && Number.isSafeInteger(revision)) {
      files.push({ name, handle, sequence, revision, snapshotId: match[3] });
    }
  }
  return files.sort((a, b) => b.sequence - a.sequence || b.name.localeCompare(a.name));
}

async function verifyOwnedFile(file: WorkoutFile, snapshot?: AppSnapshot): Promise<VerifiedFileBackup | undefined> {
  const raw = await (await file.handle.getFile()).text();
  try {
    const verified = await verifyBackupFile(raw, snapshot);
    return verified.snapshotId === file.snapshotId && verified.revision === file.revision ? verified : undefined;
  } catch { return undefined; }
}

async function rotate(directory: BackupDirectory, snapshot: AppSnapshot) {
  await requireFolderPermission(directory);
  const files = await listFiles(directory);
  let newName: string | undefined;
  let verified: VerifiedFileBackup | undefined;
  for (const file of files) {
    if (file.snapshotId !== snapshot.snapshotId || file.revision !== snapshot.revision) continue;
    verified = await verifyOwnedFile(file, snapshot);
    if (verified) { newName = file.name; break; }
  }
  if (!verified) {
    const sequence = (files[0]?.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error('The backup sequence is exhausted.');
    newName = `exercise-tracker-workout-${sequence}-${snapshot.revision}-${snapshot.snapshotId}.json`;
    const handle = await directory.getFileHandle(newName, { create: true });
    verified = await writeSnapshotFile(handle, snapshot);
    files.unshift({ name: newName, handle, sequence, revision: snapshot.revision, snapshotId: snapshot.snapshotId });
  }
  await offlineDb.preferences.put({ key: 'last-workout-backup', value: verified });
  window.dispatchEvent(new Event('file-backup-updated'));

  try {
    let retained = 0;
    for (const file of files) {
      if (file.name !== newName && !await verifyOwnedFile(file)) continue;
      if (++retained <= 2) continue;
      await directory.removeEntry(file.name);
    }
  } catch { return false; }
  return true;
}

export type WorkoutBackupResult = 'idle' | 'verified' | 'folder-needed' | 'unsupported' | 'reconnect' | 'failed' | 'cleanup';

/** Read pending work only on a workout commit, startup, or folder reconnection. */
export async function flushWorkoutBackups(userId: string): Promise<WorkoutBackupResult> {
  async function pending(result: WorkoutBackupResult) {
    await retainPendingWorkoutBackups(userId);
    return result;
  }
  if (!navigator.locks) return (await workoutBackupKeys(userId)).length ? pending('unsupported') : 'idle';
  return navigator.locks.request('exercise-tracker-workout-backups', async () => {
    const keys = await workoutBackupKeys(userId);
    if (!keys.length) return 'idle';
    const directory = (await offlineDb.preferences.get('backup-directory'))?.value as BackupDirectory | undefined;
    if (!directory) return pending(supportsFolderBackup() ? 'folder-needed' : 'unsupported');
    try { await requireFolderPermission(directory); }
    catch { return pending('reconnect'); }
    try {
      for (const key of keys) {
        const snapshot = await readWorkoutBackup(userId, key);
        if (!snapshot) continue;
        if (!await rotate(directory, snapshot)) return pending('cleanup');
        await offlineDb.workoutBackupJobs.delete(key);
      }
      return 'verified';
    } catch { return pending('failed'); }
  });
}

export function workoutBackupMessage(result: WorkoutBackupResult): string {
  switch (result) {
    case 'verified': return 'Workout backup verified.';
    case 'folder-needed': return 'Workout backup pending. Choose a backup folder in Settings.';
    case 'unsupported': return 'Automatic workout backups are unavailable in this browser. Download a JSON backup in Settings.';
    case 'reconnect': return 'Workout backup pending. Reconnect the backup folder in Settings.';
    case 'failed': return 'Workout backup could not be verified. Try reconnecting the backup folder in Settings.';
    case 'cleanup': return 'Workout backup verified. Removing the oldest copy will retry.';
    default: return '';
  }
}
