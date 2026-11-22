import { createJsonExport } from '../domain/export';
import { createId } from '../domain/ids';
import { APP_DATA_EXPORT_VERSION } from '../domain/dataVersion';
import { checksum } from './backupFormat';
import { restoreJsonExport } from './localData';
import { offlineDb, retainedCheckpointIds, type AppSnapshot } from './offlineDb';

export interface BackupFile {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}
export interface BackupDirectory {
  kind: 'directory';
  getFileHandle(name: string, options?: { create: boolean }): Promise<BackupFile>;
  entries(): AsyncIterableIterator<[string, BackupFile | { kind: 'directory' }]>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}
export interface VerifiedFileBackup { snapshotId: string; revision: number; savedAt: string; verifiedAt: string }
const prefix = 'exercise-tracker-';
let tail: Promise<unknown> = Promise.resolve();
export function folderBackupFilename(snapshot: AppSnapshot, pinned = false): string {
  return prefix + (pinned ? 'protected-' : '') + snapshot.revision + '-' + Date.parse(snapshot.updatedAt) + '-' + snapshot.snapshotId + '.json';
}

export function supportsFolderBackup() {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}
export async function selectBackupFolder(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: (options: { mode: string }) => Promise<BackupDirectory> }).showDirectoryPicker;
  const directory = await picker.call(window, { mode: 'readwrite' });
  if (typeof directory.getFileHandle !== 'function' || typeof directory.entries !== 'function') throw new Error('Folder writing is unavailable.');
  await offlineDb.preferences.put({ key: 'backup-directory', value: directory });
  window.dispatchEvent(new Event('backup-target-changed'));
}
export async function disconnectBackupFolder(): Promise<void> {
  await offlineDb.preferences.delete('backup-directory');
  // The files remain on disk. A previous verification is not a connected target.
  window.dispatchEvent(new Event('backup-target-changed'));
}

export async function verifyBackupFile(raw: string, expected?: AppSnapshot): Promise<VerifiedFileBackup> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('The backup file could not be verified.'); }
  const result = restoreJsonExport(parsed, expected?.userId ?? 'local-user');
  if (!result.ok) throw new Error('The backup file could not be verified.');
  const envelope = parsed as { version: number; backup?: { snapshotId: string; revision: number; savedAt: string } };
  if ((envelope.version !== 5 && envelope.version !== APP_DATA_EXPORT_VERSION) || !envelope.backup) throw new Error('This older backup can be restored, but cannot identify a current saved revision.');
  if (expected && (envelope.backup.snapshotId !== expected.snapshotId || envelope.backup.revision !== expected.revision ||
    envelope.backup.savedAt !== expected.updatedAt || checksum(result.data) !== expected.checksum)) throw new Error('The file does not match the saved revision.');
  return { ...envelope.backup, verifiedAt: new Date().toISOString() };
}

export async function requireFolderPermission(directory: BackupDirectory) {
  if (directory.queryPermission && await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('Reconnect the backup folder to grant file access again.');
  }
}

export async function writeSnapshotFile(handle: BackupFile, snapshot: AppSnapshot): Promise<VerifiedFileBackup> {
  const writer = await handle.createWritable();
  try {
    await writer.write(createJsonExport(snapshot.data, { snapshotId: snapshot.snapshotId, revision: snapshot.revision, savedAt: snapshot.updatedAt }));
    await writer.close();
  } catch (error) { await writer.abort?.().catch(() => undefined); throw error; }
  return verifyBackupFile(await (await handle.getFile()).text(), snapshot);
}

async function writeVerified(directory: BackupDirectory, snapshot: AppSnapshot, pinned: boolean) {
  await requireFolderPermission(directory);
  let name = folderBackupFilename(snapshot, pinned);
  let handle: BackupFile | undefined;
  try {
    handle = await directory.getFileHandle(name);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
  }
  if (handle) {
    const raw = await (await handle.getFile()).text();
    try { return { verified: await verifyBackupFile(raw, snapshot), name }; }
    catch {
      // Keep an interrupted/damaged copy untouched, and retry to a new file.
      name = name.slice(0, -5) + '.attempt-' + createId('attempt') + '.json';
      handle = undefined;
    }
  }
  handle ??= await directory.getFileHandle(name, { create: true });
  return { verified: await writeSnapshotFile(handle, snapshot), name };
}

async function prune(directory: BackupDirectory, newlyVerifiedName: string) {
  const owned: { id: string; createdAt: string; pinned: boolean; revision: number; snapshotId: string; handle: BackupFile }[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file') continue;
    const match = /^exercise-tracker-(protected-)?(\d+)-(\d+)-(snapshot_[a-zA-Z0-9_-]+)(?:\.attempt-[a-zA-Z0-9_-]+)?\.json$/.exec(name);
    if (!match || !Number.isSafeInteger(Number(match[2])) || !Number.isFinite(new Date(Number(match[3])).getTime())) continue;
    owned.push({ id: name, createdAt: new Date(Number(match[3])).toISOString(), pinned: Boolean(match[1]), revision: Number(match[2]), snapshotId: match[4], handle });
  }
  const keep = retainedCheckpointIds(owned);
  // A clock change/new installation must never prune the copy just verified.
  keep.add(newlyVerifiedName);
  for (const item of owned) if (!keep.has(item.id)) {
    try {
      // Read/validate only deletion candidates, rather than dozens of complete
      // history files on every save. Never delete an unverified/unknown file.
      const verified = await verifyBackupFile(await (await item.handle.getFile()).text());
      if (verified.snapshotId === item.snapshotId && verified.revision === item.revision && verified.savedAt === item.createdAt) await directory.removeEntry(item.id);
    } catch { /* Unknown, invalid and interrupted files are never deleted. */ }
  }
}

/** Serialized independently of local commits. A failed backup never blocks offline saves. */
export function backupToFolder(snapshot: AppSnapshot, pinned = false): Promise<VerifiedFileBackup | null> {
  const operation = tail.catch(() => undefined).then(async () => {
    const directory = (await offlineDb.preferences.get('backup-directory'))?.value as BackupDirectory | undefined;
    if (!directory) return null;
    const { verified, name } = await writeVerified(directory, snapshot, pinned);
    await offlineDb.preferences.put({ key: 'last-file-backup', value: verified });
    window.dispatchEvent(new Event('file-backup-updated'));
    // Retention only runs after a newly verified copy exists. Failed cleanup does
    // not invalidate that backup and is safe to retry on the next save.
    await prune(directory, name).catch(() => undefined);
    return verified;
  });
  tail = operation;
  return operation;
}
