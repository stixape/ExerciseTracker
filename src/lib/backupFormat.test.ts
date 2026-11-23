import { describe, expect, it } from 'vitest';
import { createCsvExport, createJsonExport } from '../domain/export';
import { createDefaultAppData } from '../domain/sampleData';
import { completeSessionIfDone, completeSet, createSessionFromDay } from '../domain/session';
import { parseJsonImport } from './localData';
import { backupChecksum, canonicalJson } from './backupFormat';
import { verifyBackupFile } from './fileBackups';

describe('portable recovery format', () => {
  it.each([1, 2, 3, 4])('keeps v%i exports restorable', (version) => {
    const data = createDefaultAppData('local-user');
    const parsed = parseJsonImport(JSON.stringify({ version, data }), 'local-user');
    expect(parsed.ok && parsed.data).toEqual(data);
  });
  it('makes retries for the same committed revision byte-identical', () => {
    const data = createDefaultAppData('local-user');
    const identity = { snapshotId: 'snapshot-example', revision: 2, savedAt: '2026-10-26T10:00:00.000Z' };
    expect(createJsonExport(data, identity)).toBe(createJsonExport(data, identity));
    expect(canonicalJson({ z: 1, a: 2 })).toBe(canonicalJson({ a: 2, z: 1 }));
  });
  it.each([5, 6, 7])('verifies the original v%i checksum and rejects a relabelled envelope', async (version) => {
    const data = createDefaultAppData('local-user');
    const backup = { snapshotId: 'snapshot_v5', revision: 7, savedAt: '2026-10-26T10:00:00.000Z' };
    const envelope = { version, data, backup, checksum: backupChecksum(data, backup, version) };
    expect(parseJsonImport(JSON.stringify(envelope), 'local-user')).toEqual({ ok: true, data });
    await expect(verifyBackupFile(JSON.stringify(envelope))).resolves.toMatchObject(backup);
    expect(parseJsonImport(JSON.stringify({ ...envelope, version: 8 }), 'local-user').ok).toBe(false);
  });
  it('round trips notes and modifiers with recorded definitions, and includes targets and results in CSV', () => {
    const data = createDefaultAppData('local-user');
    const day = data.template.days[0];
    day.exercises = [{
      ...day.exercises[0], mode: 'other', notes: 'Use a mat.\nSteady pace.', restSeconds: 90,
      modifiers: [{ id: 'field', label: 'Grip', type: 'text' }],
      sets: [{ ...day.exercises[0].sets[0], target: { modifiers: { field: 'Wide' } } }],
    }];
    const session = createSessionFromDay(day);
    data.sessions = [completeSessionIfDone(completeSet(session, session.sets[0].id, { modifiers: { field: 'Neutral' } }))];
    day.exercises[0].modifiers = [];
    day.exercises[0].sets[0].target = {};
    const raw = createJsonExport(data);
    expect(parseJsonImport(raw, 'local-user')).toEqual({ ok: true, data });
    const csv = createCsvExport(data.sessions);
    expect(csv).toContain('Grip,Wide,Neutral');
  });
  it('round trips planned ranges and keeps recorded exports numeric', () => {
    const data = createDefaultAppData('local-user');
    const day = data.template.days[0];
    day.exercises = [day.exercises[0]];
    day.exercises[0].sets = [{ ...day.exercises[0].sets[0], target: { weightKg: 45, reps: 3 }, rangeMax: 5 }];
    const session = createSessionFromDay(day);
    data.sessions = [completeSessionIfDone(completeSet(session, session.sets[0].id, { weightKg: 45, reps: 4 }))];
    const roundTrip = parseJsonImport(createJsonExport(data), 'local-user');
    expect(roundTrip).toEqual({ ok: true, data });
    expect(createCsvExport(data.sessions).split('\n')[1].split(',')[8]).toBe('4');
    day.exercises[0].sets[0].rangeMax = 2;
    expect(() => createJsonExport(data)).toThrow('valid workout data');
  });
  it.each(['data', 'backup', 'checksum'])('rejects altered %s without accepting a replacement', (part) => {
    const envelope = JSON.parse(createJsonExport(createDefaultAppData('local-user')));
    if (part === 'data') envelope.data.sessions.push({});
    else if (part === 'backup') envelope.backup.revision++;
    else envelope.checksum = '0'.repeat(64);
    expect(parseJsonImport(JSON.stringify(envelope), 'local-user').ok).toBe(false);
  });
  it('refuses to create an un-restorable backup from invalid drafts', () => {
    const data = createDefaultAppData('local-user');
    data.template.days[0].exercises[0].sets[0].target.reps = undefined;
    expect(() => createJsonExport(data)).toThrow('valid workout data');
  });
  it('round trips a valid export exceeding the old 25 MB UI limit', () => {
    const data = { ...createDefaultAppData('local-user'), retainedLegacyNote: 'x'.repeat(26 * 1024 * 1024) };
    const file = createJsonExport(data);
    expect(file.length).toBeGreaterThan(25 * 1024 * 1024);
    const parsed = parseJsonImport(file, 'local-user');
    expect(parsed.ok && (parsed.data as typeof data).retainedLegacyNote.length).toBe(data.retainedLegacyNote.length);
  }, 20_000);
});
