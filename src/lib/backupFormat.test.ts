import { describe, expect, it } from 'vitest';
import { createJsonExport } from '../domain/export';
import { createDefaultAppData } from '../domain/sampleData';
import { parseJsonImport } from './localData';
import { canonicalJson } from './backupFormat';

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
