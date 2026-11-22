import { useId, useState } from 'react';
import { MAX_NOTE_LENGTH } from '../domain/modifiers';

export function ExerciseNotes({ notes, onSave }: { notes?: string; onSave: (notes?: string) => Promise<boolean> }) {
  const id = useId();
  const saved = notes ?? '';
  const [previous, setPrevious] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  if (saved !== previous) {
    setPrevious(saved);
    setDraft(saved);
  }
  async function save() {
    setSaving(true);
    try {
      if (!await onSave(draft.trim() ? draft : undefined)) return;
      if (!draft.trim()) setDraft('');
    } finally { setSaving(false); }
  }
  return (
    <div className="exercise-notes">
      <label htmlFor={id}>Notes</label>
      <textarea id={id} rows={3} maxLength={MAX_NOTE_LENGTH} value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
      <button className="small-button" type="button" disabled={saving || draft === saved} onClick={() => void save()}>Save notes</button>
    </div>
  );
}
