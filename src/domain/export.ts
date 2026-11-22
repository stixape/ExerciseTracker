import type { AppData, WorkoutSession } from './types';
import { APP_DATA_EXPORT_VERSION } from './dataVersion';
import { createId } from './ids';
import { validateAppData } from '../lib/appDataSchema';
import { backupChecksum, type BackupIdentity } from '../lib/backupFormat';
import { modifierValue } from './modifiers';

function csvEscape(value: string | number | undefined): string {
  const rawText = value === undefined ? '' : String(value);
  // Spreadsheet programs may execute cells beginning with these characters as formulas.
  const text = /^\s*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function formatLocalCalendarDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createJsonExport(data: AppData, identity?: BackupIdentity): string {
  const validation = validateAppData(data);
  if (!validation.ok) throw new TypeError('Only valid workout data can be backed up. Correct the unfinished edit first.');
  const backup = identity ?? { snapshotId: createId('backup'), revision: 0, savedAt: new Date().toISOString() };
  return JSON.stringify(
    {
      exportedAt: backup.savedAt,
      version: APP_DATA_EXPORT_VERSION,
      backup,
      checksum: backupChecksum(data, backup),
      data,
    },
    null,
    2,
  );
}

export function createCsvExport(sessions: WorkoutSession[]): string {
  const rows = [
    [
      'session_id',
      'date',
      'day',
      'exercise',
      'exercise_id',
      'set',
      'mode',
      'weight_kg',
      'reps',
      'seconds',
      'band_colour_ids',
      'completed_at',
      'rest_seconds_after',
      'rest_skipped',
      'modifier_1_label',
      'modifier_1_target',
      'modifier_1_actual',
      'modifier_2_label',
      'modifier_2_target',
      'modifier_2_actual',
    ],
  ];

  for (const session of sessions) {
    const rests = new Map(session.restEvents.map((rest) => [rest.afterSessionSetId, rest]));
    for (const set of session.sets) {
      const rest = rests.get(set.id);
      const fields = set.mode === 'other' ? session.snapshot.exercises[set.exerciseIndex]?.modifiers : undefined;
      rows.push([
        session.id,
        formatLocalCalendarDate(session.startedAt),
        session.label,
        set.exerciseName,
        set.exerciseId,
        String(set.setNumber),
        set.mode,
        String(set.actual.weightKg ?? ''),
        String(set.actual.reps ?? ''),
        String(set.actual.seconds ?? ''),
        (set.actual.bandColourIds ?? []).join('|'),
        set.completedAt ?? '',
        String(rest?.durationSeconds ?? ''),
        rest ? String(rest.skipped) : '',
        ...[fields?.[0], fields?.[1]].flatMap((field) => field
          ? [field.label, String(modifierValue(set.target.modifiers, field.id) ?? ''), String(modifierValue(set.actual.modifiers, field.id) ?? '')]
          : ['', '', '']),
      ]);
    }
  }

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
