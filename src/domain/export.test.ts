import { describe, expect, it } from 'vitest';
import { createCsvExport, createJsonExport, formatLocalCalendarDate } from './export';
import { createDefaultAppData, createDefaultTemplate } from './sampleData';
import { createSessionFromDay } from './session';

describe('exports', () => {
  it('creates a current versioned JSON export', () => {
    const parsed = JSON.parse(createJsonExport(createDefaultAppData('user-1')));
    expect(parsed.version).toBe(2);
    expect(parsed.data.userId).toBe('user-1');
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
  });

  it('includes stable exercise identity in the CSV header', () => {
    expect(createCsvExport([])).toContain('session_id,date,day,exercise,exercise_id,set,mode');
  });

  it('neutralizes spreadsheet formulas in every text field', () => {
    const session = createSessionFromDay(createDefaultTemplate().days[0]);
    session.id = '=malicious-session';
    session.label = ' +malicious-day';
    session.sets = [
      {
        ...session.sets[0],
        exerciseId: '@malicious-id',
        exerciseName: '-malicious-exercise',
      },
    ];

    const csv = createCsvExport([session]);

    expect(csv).toContain("'=malicious-session");
    expect(csv).toContain("' +malicious-day");
    expect(csv).toContain("'-malicious-exercise");
    expect(csv).toContain("'@malicious-id");
  });

  it('formats dates using the local calendar rather than slicing UTC text', () => {
    const localDate = new Date(2026, 6, 5, 0, 30);

    expect(formatLocalCalendarDate(localDate.toISOString())).toBe('2026-07-05');
    expect(formatLocalCalendarDate('not-a-date')).toBe('');
  });
});
