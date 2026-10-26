import { useEffect, useState } from 'react';
import type { AppData } from '../domain/types';
import { parseJsonImport } from '../lib/localData';
import { offlineDb } from '../lib/offlineDb';
import { enableRemoteStream, listRemoteBackups, readRemoteBackup, pauseRemoteBackup, remoteClient, remoteConfiguration, type RemoteSnapshot } from '../lib/remoteBackups';

export function RemoteBackupPanel({ onRestore }: { onRestore: (data: AppData) => Promise<boolean> }) {
  const [enabled, setEnabled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [email, setEmail] = useState('');
  const [backups, setBackups] = useState<RemoteSnapshot[]>([]);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [more, setMore] = useState(false);
  const configured = Boolean(remoteConfiguration());
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void offlineDb.preferences.get('remote-enabled').then(async (pref) => {
      if (cancelled || !configured || pref?.value !== true) return;
      setEnabled(true);
      const db = await remoteClient();
      const result = await db.auth.getSession();
      if (cancelled) return;
      setSignedIn(Boolean(result.data.session));
      const { data } = db.auth.onAuthStateChange((_event, session) => { if (!cancelled) { setSignedIn(Boolean(session)); setReviewed(false); } });
      unsubscribe = () => data.subscription.unsubscribe();
    }).catch(() => { if (!cancelled) setMessage('Remote settings could not be read.'); });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [configured]);
  useEffect(() => {
    const reset = () => setReviewed(false);
    window.addEventListener('backup-stream-reset', reset);
    return () => window.removeEventListener('backup-stream-reset', reset);
  }, []);
  async function run(action: () => Promise<void>) {
    setWorking(true);
    try { await action(); } catch { setMessage('Remote backup is unavailable. Local workouts and files are unaffected; sign in again or retry when online.'); }
    finally { setWorking(false); }
  }
  return <section className="section-block">
    <h3>Optional remote backup</h3>
    {!configured ? <p>Remote backup has not been set up for this installation. Keep a verified JSON file outside browser storage to protect your records.</p> : <>
      <p>Enabling this sends workout records to your private Supabase account when you start backup. The provider can access the stored records; backups are not end-to-end encrypted. Offline use remains available.</p>
      <label><input type="checkbox" checked={enabled} disabled={working} onChange={(event) => {
        const next = event.target.checked;
        void run(async () => {
          await offlineDb.preferences.put({ key: 'remote-enabled', value: next });
          if (!next) { await pauseRemoteBackup(); await (await remoteClient()).auth.signOut({ scope: 'local' }); setSignedIn(false); }
          setEnabled(next);
          setReviewed(false);
        });
      }} />Enable optional remote backup</label>
      {enabled && !signedIn && <div className="backup-controls">
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <button type="button" disabled={working || !email.trim()} onClick={() => void run(async () => {
          const { error } = await (await remoteClient()).auth.signInWithOtp({ email, options: { emailRedirectTo: new URL(import.meta.env.BASE_URL + 'settings', window.location.origin).href } });
          if (error) throw error;
          setMessage('Check your email for the sign-in link. Open it in this browser.');
        })}>Send sign-in link</button>
        <button type="button" disabled={working} onClick={() => void run(async () => {
          const result = await (await remoteClient()).auth.getUser();
          setSignedIn(Boolean(result.data.user));
        })}>Check sign-in</button>
      </div>}
      {enabled && signedIn && <div className="backup-controls">
        <button type="button" disabled={working} onClick={() => void run(async () => { const records = await listRemoteBackups(); setBackups(records); setMore(records.length === 100); setReviewed(true); setMessage('Review existing versions before starting backup from this device.'); })}>Review remote versions</button>
        {more && <button type="button" disabled={working} onClick={() => void run(async () => { const records = await listRemoteBackups(backups.length); setBackups((previous) => [...previous, ...records.filter((record) => !previous.some((item) => item.id === record.id && item.device_id === record.device_id))]); setMore(records.length === 100); })}>Load older remote versions</button>}
        {reviewed && <button type="button" disabled={working} onClick={() => void run(async () => { await enableRemoteStream(); setMessage('Automatic backup is enabled for this device while the app is open.'); })}>Start backup from this device</button>}
        <button type="button" disabled={working} onClick={() => void run(async () => { await pauseRemoteBackup(); setMessage('Remote uploads paused. Existing remote versions remain.'); })}>Pause remote uploads</button>
        {backups.map((backup) => <details key={backup.device_id + backup.id}>
          <summary>Revision {backup.revision} · {new Date(backup.saved_at).toLocaleString()}{backup.pinned ? ' · protected' : ''}</summary>
          <p>Restore replaces local data after validation and confirmation. Other device streams and remote versions remain.</p>
          <button type="button" disabled={working} onClick={() => void run(async () => {
            const parsed = parseJsonImport(JSON.stringify(await readRemoteBackup(backup.device_id, backup.id)), 'local-user');
            if (!parsed.ok) { setMessage(parsed.error); return; }
            if (!window.confirm('Restore ' + parsed.data.template.name + ' and ' + parsed.data.sessions.length + ' saved sessions from this remote version?')) return;
            const ok = await onRestore(parsed.data);
            setMessage(ok ? 'Remote backup restored. Review versions again before resuming uploads.' : 'Restore failed; the existing records remain.');
            setReviewed(false);
          })}>Restore remote version</button>
        </details>)}
      </div>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
