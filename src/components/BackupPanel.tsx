import { useEffect, useState } from 'react';
import { useTracker } from '../app/TrackerContext';
import { createJsonExport, downloadTextFile } from '../domain/export';
import { backupToFolder, disconnectBackupFolder, selectBackupFolder, supportsFolderBackup, verifyBackupFile, type VerifiedFileBackup } from '../lib/fileBackups';
import { createRawRecoveryExport, listCheckpoints, offlineDb, readCheckpoint, type CheckpointSummary } from '../lib/offlineDb';
import { readPersistence, requestPersistence, type PersistenceState } from '../lib/storageProtection';
import { ImportBackup } from './ImportBackup';
import { RemoteBackupPanel } from './RemoteBackupPanel';
import type { AppData } from '../domain/types';

export function CheckpointBrowser({ onRestore }: { onRestore: (data: AppData) => Promise<boolean> }) {
  const [records, setRecords] = useState<CheckpointSummary[]>([]);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  async function refresh() {
    try { setRecords(await listCheckpoints('local-user')); setMessage(''); }
    catch { setMessage('Checkpoints could not be opened. Original sources can still be exported.'); }
  }
  return <details className="checkpoint-browser" onToggle={(event) => { if (event.currentTarget.open) void refresh(); }}>
    <summary>Device recovery checkpoints</summary>
    <p>These copies help undo mistakes, but disappear if this browser’s storage is cleared. They are not independent backups.</p>
    <button type="button" onClick={() => void refresh()}>Refresh checkpoints</button>
    {!records.length && <p>No checkpoints are available.</p>}
    {records.map((record) => <details key={record.id}>
      <summary>Revision {record.revision} · {new Date(record.createdAt).toLocaleString()} · {record.reason}{record.pinned ? ' · protected' : ''}</summary>
      <p>{record.planName} · {record.sessionCount} saved sessions</p>
      <button type="button" disabled={working} onClick={async () => {
        if (!window.confirm('Restore this plan and ' + record.sessionCount + ' sessions? Current records will be checkpointed.')) return;
        setWorking(true);
        try {
          const checkpoint = await readCheckpoint('local-user', record.id);
          setMessage(await onRestore(checkpoint.data) ? 'Checkpoint restored as a new revision.' : 'Restore failed. Original records remain.');
        } catch { setMessage('This checkpoint failed validation. No saved data was changed.'); }
        finally { setWorking(false); }
      }}>Restore checkpoint</button>
      <button type="button" onClick={async () => {
        try {
          const checkpoint = await readCheckpoint('local-user', record.id);
          downloadTextFile('exercise-tracker-checkpoint-' + checkpoint.snapshotId + '.json', createJsonExport(checkpoint.data, { snapshotId: checkpoint.snapshotId, revision: checkpoint.revision, savedAt: checkpoint.updatedAt }), 'application/json');
        } catch { setMessage('This checkpoint could not be exported as a valid backup.'); }
      }}>Download checkpoint</button>
    </details>)}
    {message && <p role="status">{message}</p>}
  </details>;
}

export function BackupPanel() {
  const { snapshot, status, busy, replaceData, getBackupJson } = useTracker();
  const [fileBackup, setFileBackup] = useState<VerifiedFileBackup>();
  const [remoteBackup, setRemoteBackup] = useState<VerifiedFileBackup>();
  const [folder, setFolder] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceState>('unknown');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [file, remote, directory] = await Promise.all([offlineDb.preferences.get('last-file-backup'), offlineDb.preferences.get('last-remote-backup'), offlineDb.preferences.get('backup-directory')]);
        if (!cancelled) { setFileBackup(file?.value as VerifiedFileBackup | undefined); setRemoteBackup(remote?.value as VerifiedFileBackup | undefined); setFolder(Boolean(directory?.value)); }
      } catch { if (!cancelled) setMessage('Backup status is unavailable.'); }
    }
    void refresh();
    void readPersistence().then((result) => { if (!cancelled) setPersistence(result); });
    window.addEventListener('file-backup-updated', refresh);
    window.addEventListener('backup-target-changed', refresh);
    return () => { cancelled = true; window.removeEventListener('file-backup-updated', refresh); window.removeEventListener('backup-target-changed', refresh); };
  }, []);
  async function run(action: () => Promise<void>) {
    setWorking(true);
    try { await action(); } catch { setMessage('Backup could not be completed or was cancelled. Keep existing copies and retry.'); }
    finally { setWorking(false); }
  }
  const disabled = busy || working || status !== 'saved';
  return <>
    <section className="section-block backup-panel">
      <h2>Backup and recovery</h2>
      <p>Local revision: {snapshot?.revision}. {fileBackup?.snapshotId === snapshot?.snapshotId ? 'This revision has a verified file backup.' : 'Changes since the last verified file backup need protection.'}</p>
      <p>{fileBackup ? 'Last verified file: revision ' + fileBackup.revision + ', ' + new Date(fileBackup.verifiedAt).toLocaleString() : 'No independent file backup has been verified.'}</p>
      <p>{remoteBackup ? 'Last verified remote copy: revision ' + remoteBackup.revision + ', ' + new Date(remoteBackup.verifiedAt).toLocaleString() : 'No remote backup has been verified.'}</p>
      <p>Browser eviction protection: {persistence.replace('_', ' ')}. This cannot protect against cleared browser data or a lost device.</p>
      {folder && <p>Folder retention keeps 20 recent files plus 30 daily files. Protected pre-replacement copies are retained. Unrecognised files are left alone.</p>}
      <div className="backup-controls">
        <button type="button" disabled={disabled} onClick={() => void run(async () => {
          downloadTextFile('exercise-tracker-' + snapshot!.snapshotId + '.json', await getBackupJson(), 'application/json');
          setMessage('Download requested. Keep the file outside browser storage and select it below to verify it.');
        })}>Download JSON backup</button>
        <label className="file-button">Verify saved backup<input type="file" accept="application/json,.json" aria-label="Verify saved backup" disabled={disabled} onChange={(event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
          if (file) void run(async () => {
            const verified = await verifyBackupFile(await file.text(), snapshot);
            await offlineDb.preferences.put({ key: 'last-file-backup', value: verified });
            setFileBackup(verified); setMessage('Saved backup verified against the current revision.');
          });
        }} /></label>
        {supportsFolderBackup() && <button type="button" disabled={disabled} onClick={() => void run(async () => { await selectBackupFolder(); await backupToFolder(snapshot!); setMessage('Folder connected and the current backup verified. Backups run while this app is open.'); })}>{folder ? 'Reconnect backup folder' : 'Choose backup folder'}</button>}
        {folder && <>
          <button type="button" disabled={disabled} onClick={() => void run(async () => { await backupToFolder(snapshot!); setMessage('Folder backup verified.'); })}>Back up to folder now</button>
          <button type="button" disabled={disabled} onClick={() => void run(async () => { await disconnectBackupFolder(); setMessage('Folder disconnected. Existing files were kept.'); })}>Disconnect folder</button>
        </>}
        <button type="button" disabled={disabled} onClick={() => void run(async () => setPersistence(await requestPersistence()))}>Request browser storage protection</button>
      </div>
      {!supportsFolderBackup() && <p>This browser cannot write automatic folder backups. Download and verify a JSON file after saved workouts. Copies inside browser storage are not backups against browser clearing.</p>}
      <ImportBackup onRestore={(replacement) => replaceData(replacement, 'import')} disabled={disabled} />
      <CheckpointBrowser onRestore={(replacement) => replaceData(replacement, 'restore')} />
      <button type="button" disabled={disabled} onClick={() => void run(async () => downloadTextFile('exercise-tracker-raw-recovery.json', await createRawRecoveryExport('local-user'), 'application/json'))}>Export original recovery sources</button>
      {message && <p role="status">{message}</p>}
    </section>
    <RemoteBackupPanel onRestore={(replacement) => replaceData(replacement, 'restore')} />
  </>;
}
