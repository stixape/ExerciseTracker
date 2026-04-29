import type { AppData, WorkoutSession } from './types';

function csvEscape(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function createJsonExport(data: AppData): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: 1,
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
        new Date(session.startedAt).toISOString().slice(0, 10),
        session.label,
        set.exerciseName,
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
