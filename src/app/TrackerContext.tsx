import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createDefaultAppData } from '../domain/sampleData';
import type { AppData } from '../domain/types';
import { createJsonExport, downloadTextFile } from '../domain/export';
import { validateAppData } from '../lib/appDataSchema';
import { commitAppData, createRawRecoveryExport, loadAppData, offlineDb, StorageConflictError, type AppSnapshot, type CheckpointReason, type LoadResult } from '../lib/offlineDb';
import { ImportBackup } from '../components/ImportBackup';
import { CheckpointBrowser } from '../components/BackupPanel';
import { RemoteBackupPanel } from '../components/RemoteBackupPanel';
import { backupToFolder } from '../lib/fileBackups';
import { backupToRemote, remoteConfiguration } from '../lib/remoteBackups';

export const LOCAL_USER_ID = 'local-user';
type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict';
interface TrackerContextValue {
  data: AppData;
  snapshot?: AppSnapshot;
  status: SaveStatus;
  busy: boolean;
  saveData: (updater: (current: AppData) => AppData, reason?: CheckpointReason) => Promise<boolean>;
  replaceData: (data: AppData, reason?: CheckpointReason) => Promise<boolean>;
  getBackupJson: (rescue?: boolean) => Promise<string>;
  retrySave: () => Promise<boolean>;
}
const TrackerContext = createContext<TrackerContextValue | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export function useTracker(): TrackerContextValue {
  const value = useContext(TrackerContext);
  if (!value) throw new Error('useTracker must be used inside TrackerContext');
  return value;
}

export function TrackerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>();
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [loadState, setLoadState] = useState<LoadResult>();
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [independentlyBacked, setIndependentlyBacked] = useState(false);
  const [backupTick, setBackupTick] = useState(0);
  const reasonRef = useRef<CheckpointReason>('edit');
  const dataRef = useRef<AppData | undefined>(undefined);
  const committedRef = useRef<AppSnapshot | undefined>(undefined);
  const revisionRef = useRef<number | null>(null);
  const tail = useRef<Promise<boolean>>(Promise.resolve(true));
  const blocked = useRef(false);
  const conflicted = useRef(false);
  const exclusive = useRef(false);
  const pending = useRef(0);
  const channel = useRef<BroadcastChannel | undefined>(undefined);
  const initialLoad = useRef<Promise<LoadResult> | undefined>(undefined);

  const acceptLoad = useCallback((result: LoadResult) => {
    setLoadState(result);
    if (result.kind === 'ready') {
      committedRef.current = result.snapshot;
      revisionRef.current = result.snapshot.revision;
      dataRef.current = result.snapshot.data;
      setSnapshot(result.snapshot);
      setData(result.snapshot.data);
    } else revisionRef.current = result.kind === 'empty' ? null : result.revision;
  }, []);

  useEffect(() => {
    let cancelled = false;
    initialLoad.current ??= loadAppData(LOCAL_USER_ID);
    void initialLoad.current.then((result) => { if (!cancelled) acceptLoad(result); });
    return () => { cancelled = true; };
  }, [acceptLoad]);

  useEffect(() => {
    function stale() {
      blocked.current = true;
      conflicted.current = true;
      setStatus('conflict');
      setError('Saved data changed in another window or was removed. Export your unsaved changes before reloading the saved record.');
    }
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('exercise-tracker-revisions');
      channel.current.onmessage = (event: MessageEvent<{ revision?: number; snapshotId?: string }>) => {
        if (committedRef.current && event.data.snapshotId && event.data.snapshotId !== committedRef.current.snapshotId &&
          (event.data.revision ?? 0) >= committedRef.current.revision) stale();
      };
    }
    async function checkRevision() {
      if (!committedRef.current || pending.current || exclusive.current || document.visibilityState === 'hidden') return;
      try {
        const record = await offlineDb.appData.get(LOCAL_USER_ID);
        if (record?.snapshotId !== committedRef.current?.snapshotId) stale();
      } catch { /* The next explicit save reports an unavailable database. */ }
    }
    window.addEventListener('focus', checkRevision);
    document.addEventListener('visibilitychange', checkRevision);
    return () => { channel.current?.close(); channel.current = undefined; window.removeEventListener('focus', checkRevision); document.removeEventListener('visibilitychange', checkRevision); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshProtection() {
      const [file, remote] = await Promise.all([offlineDb.preferences.get('last-file-backup'), offlineDb.preferences.get('last-remote-backup')]);
      const matches = (value: unknown) => Boolean(value && typeof value === 'object' && 'snapshotId' in value && value.snapshotId === snapshot?.snapshotId);
      if (!cancelled) setIndependentlyBacked(Boolean(snapshot && (matches(file?.value) || matches(remote?.value))));
    }
    const trigger = () => setBackupTick((tick) => tick + 1);
    const refresh = () => { void refreshProtection().catch(() => undefined); };
    void refreshProtection().catch(() => undefined);
    window.addEventListener('file-backup-updated', refresh);
    window.addEventListener('backup-target-changed', trigger);
    window.addEventListener('online', trigger);
    const timer = snapshot ? window.setTimeout(async () => {
      const results = await Promise.allSettled([backupToFolder(snapshot), backupToRemote(snapshot)]);
      if (!cancelled) setBackupError(results.some((result) => result.status === 'rejected') ? 'An independent backup could not be verified. Your local save is intact. Reconnect your backup folder or remote account in Settings.' : '');
      await refreshProtection().catch(() => undefined);
    }, reasonRef.current === 'set' || reasonRef.current === 'workout' ? 0 : 1_000) : undefined;
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('file-backup-updated', refresh);
      window.removeEventListener('backup-target-changed', trigger);
      window.removeEventListener('online', trigger);
    };
  }, [snapshot, backupTick]);

  const persist = useCallback((next: AppData, reason: CheckpointReason): Promise<boolean> => {
    pending.current++;
    setStatus('saving');
    const operation = tail.current.then(async () => {
      if (blocked.current) return false;
      try {
        const saved = await commitAppData(next, revisionRef.current, reason);
        reasonRef.current = reason;
        committedRef.current = saved;
        revisionRef.current = saved.revision;
        setSnapshot(saved);
        channel.current?.postMessage({ revision: saved.revision, snapshotId: saved.snapshotId });
        setError('');
        return true;
      } catch (failure) {
        blocked.current = true;
        conflicted.current = failure instanceof StorageConflictError;
        setStatus(conflicted.current ? 'conflict' : 'error');
        setError(failure instanceof StorageConflictError ? failure.message : 'Changes are unsaved. Keep this page open, retry saving, or export a rescue backup. The previous saved record is intact.');
        return false;
      }
    }).finally(() => { pending.current--; if (!pending.current && !blocked.current) setStatus('saved'); });
    tail.current = operation;
    return operation;
  }, []);

  const saveData = useCallback((updater: (current: AppData) => AppData, reason: CheckpointReason = 'edit') => {
    if (!dataRef.current || exclusive.current || blocked.current) return Promise.resolve(false);
    const next = updater(dataRef.current);
    if (next === dataRef.current) return tail.current;
    if (!validateAppData(next).ok) {
      setError('This edit is incomplete or invalid. Correct the highlighted field; the saved data was not changed.');
      return Promise.resolve(false);
    }
    dataRef.current = next;
    setData(next);
    return persist(structuredClone(next), reason);
  }, [persist]);

  const replaceData = useCallback(async (replacement: AppData, reason: CheckpointReason = 'import') => {
    if (exclusive.current || !validateAppData(replacement).ok) return false;
    exclusive.current = true;
    setBusy(true);
    try {
      const pendingSaved = await tail.current;
      if (!pendingSaved && dataRef.current) {
        setError('Pending changes could not be saved. Export a rescue backup and reload saved data before attempting replacement.');
        return false;
      }
      if (conflicted.current) return false;
      if (committedRef.current) {
        await backupToFolder(committedRef.current, true).catch(() => setBackupError('The pre-replacement file backup failed. The original record will still be protected in device recovery sources.'));
        await backupToRemote(committedRef.current, true).catch(() => setBackupError('The pre-replacement remote copy could not be verified. Device recovery sources remain protected; remote uploads will pause.'));
      }
      const saved = await commitAppData(structuredClone(replacement), revisionRef.current, reason);
      reasonRef.current = reason;
      committedRef.current = saved;
      revisionRef.current = saved.revision;
      dataRef.current = saved.data;
      setData(saved.data);
      setSnapshot(saved);
      setLoadState({ kind: 'ready', snapshot: saved });
      blocked.current = false;
      setStatus('saved');
      setError('');
      channel.current?.postMessage({ revision: saved.revision, snapshotId: saved.snapshotId });
      window.dispatchEvent(new Event('backup-stream-reset'));
      return true;
    } catch (failure) {
      blocked.current = true;
      conflicted.current = failure instanceof StorageConflictError;
      setStatus(conflicted.current ? 'conflict' : 'error');
      setError('Replacement failed. Existing records and recovery sources were preserved.');
      return false;
    } finally { exclusive.current = false; setBusy(false); }
  }, []);

  const getBackupJson = useCallback(async (rescue = false) => {
    if (rescue) {
      if (!dataRef.current) throw new Error('No in-memory data is available.');
      return createJsonExport(dataRef.current);
    }
    await tail.current;
    if (blocked.current || !committedRef.current) throw new Error('Save failed. Use Export unsaved changes for a rescue copy.');
    const saved = committedRef.current;
    return createJsonExport(saved.data, { snapshotId: saved.snapshotId, revision: saved.revision, savedAt: saved.updatedAt });
  }, []);

  const retrySave = useCallback(async () => {
    if (!dataRef.current || exclusive.current || conflicted.current) return false;
    await tail.current;
    blocked.current = false;
    return persist(structuredClone(dataRef.current), 'edit');
  }, [persist]);

  if (!loadState) return <main className="loading-screen" aria-busy="true"><h1>Loading ExerciseTracker</h1></main>;
  if (loadState.kind !== 'ready' || !data) return <main className="recovery-screen page-stack">
    <h1>{loadState.kind === 'empty' ? 'Restore or start ExerciseTracker' : 'Your saved data needs recovery'}</h1>
    <p>{loadState.kind === 'empty' ? 'No saved data was found in this browser. Browser storage may have been cleared. Restore a backup, or explicitly create a starter plan.' : loadState.kind === 'recovery_required' ? loadState.reason : 'Saved data is opening.'}</p>
    <p>Nothing will be replaced until you confirm a restore or create a starter plan.</p>
    {error && <p role="alert">{error}</p>}
    <ImportBackup onRestore={(replacement) => replaceData(replacement, 'import')} disabled={busy} />
    <CheckpointBrowser onRestore={(replacement) => replaceData(replacement, 'restore')} />
    {remoteConfiguration() && <RemoteBackupPanel onRestore={(replacement) => replaceData(replacement, 'restore')} />}
    {loadState.kind === 'empty' && <button type="button" className="secondary-button" disabled={busy} onClick={() => void replaceData(createDefaultAppData(LOCAL_USER_ID), 'initialise')}>Create starter plan</button>}
    <button type="button" className="ghost-button" disabled={busy} onClick={async () => {
      try { downloadTextFile('exercise-tracker-raw-recovery.json', await createRawRecoveryExport(LOCAL_USER_ID), 'application/json'); }
      catch { setError('Original records could not be opened. Do not clear browser storage; try reopening the app.'); }
    }}>Export original recovery sources</button>
    <button type="button" className="ghost-button" onClick={() => window.location.reload()}>Try reopening saved data</button>
  </main>;

  return <TrackerContext.Provider value={{ data, snapshot, status, busy, saveData, replaceData, getBackupJson, retrySave }}>
    <div className="save-status" role="status">{status === 'saved' ? 'Saved on this device · revision ' + snapshot?.revision : status === 'saving' ? 'Saving on this device…' : 'Changes are not saved'}</div>
    {!independentlyBacked && <div className="backup-reminder">Independent backup needed. Keep a verified JSON file outside browser storage; backup controls are in Settings.</div>}
    {backupError && <div className="backup-reminder" role="status">{backupError}</div>}
    {error && <div className="storage-error-banner" role="alert">{error}
      {status === 'error' && <button type="button" onClick={() => void retrySave()}>Retry save</button>}
      {(status === 'error' || status === 'conflict') && <>
        <button type="button" onClick={async () => { try { downloadTextFile('exercise-tracker-rescue-' + Date.now() + '.json', await getBackupJson(true), 'application/json'); } catch { setError('The pending data is invalid and cannot be exported as a restorable backup.'); } }}>Export unsaved changes</button>
        <button type="button" onClick={() => { if (window.confirm('Reload saved data? Export unsaved changes first if you want to keep them.')) window.location.reload(); }}>Reload saved data</button>
      </>}
    </div>}
    <fieldset className="app-interaction" disabled={busy || status === 'conflict' || status === 'error'} aria-busy={busy}>{children}</fieldset>
  </TrackerContext.Provider>;
}
