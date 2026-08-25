import type { AppData, WorkoutSession } from './types';
import { APP_DATA_EXPORT_VERSION } from './dataVersion';

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

export function createJsonExport(data: AppData): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: APP_DATA_EXPORT_VERSION,
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
    ],
  ];

  for (const session of sessions) {
    for (const set of session.sets) {
      const rest = session.restEvents.find((event) => event.afterSessionSetId === set.id);
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
  URL.revokeObjectURL(url);
}
