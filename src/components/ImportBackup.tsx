import { useState } from 'react';
import type { AppData } from '../domain/types';
import { parseJsonImport } from '../lib/localData';

export function ImportBackup({ onRestore, disabled = false }: { onRestore: (data: AppData) => Promise<boolean>; disabled?: boolean }) {
  const [preview, setPreview] = useState<AppData>();
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    setPreview(undefined);
    if (!file) return;
    setReading(true);
    setMessage('Reading backup…');
    try {
      const result = parseJsonImport(await file.text(), 'local-user');
      if (result.ok) { setPreview(result.data); setMessage(''); }
      else setMessage(result.error);
    } catch { setMessage('This file could not be read. Existing data was not changed.'); }
    finally { setReading(false); }
  }
  return <div className="backup-import">
    <label className="file-button">Import JSON<input type="file" accept="application/json,.json" aria-label="Import JSON export" disabled={disabled || reading} onChange={(event) => void readFile(event)} /></label>
    {preview && <section className="recovery-preview" aria-label="Backup preview">
      <h3>Review backup before restoring</h3>
      <p>{preview.template.name}: {preview.template.days.length} plan days, {preview.sessions.length} saved sessions, {preview.activeWorkout ? 'an active workout' : 'no active workout'}.</p>
      <p>Restoring replaces the current plan and workouts. The previous device record will be kept as a recovery checkpoint.</p>
      <button type="button" className="secondary-button" disabled={disabled || reading} onClick={async () => {
        setReading(true);
        try {
          const ok = await onRestore(preview);
          setMessage(ok ? 'JSON import restored.' : 'Restore failed. Existing data and the selected backup were preserved.');
          if (ok) setPreview(undefined);
        } finally { setReading(false); }
      }}>Restore this backup</button>
      <button type="button" className="ghost-button" disabled={reading} onClick={() => setPreview(undefined)}>Cancel restore</button>
    </section>}
    {message && <p role="status">{message}</p>}
  </div>;
}
