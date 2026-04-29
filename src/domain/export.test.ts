import { describe, expect, it } from 'vitest';
import { createCsvExport, createJsonExport } from './export';
import { createDefaultAppData } from './sampleData';

describe('exports', () => {
  it('creates a versioned JSON export', () => {
    const parsed = JSON.parse(createJsonExport(createDefaultAppData('user-1')));
    expect(parsed.version).toBe(1);
    expect(parsed.data.userId).toBe('user-1');
  });

  it('creates a CSV header for sessions', () => {
    expect(createCsvExport([])).toContain('session_id,date,day,exercise,set,mode');
  });
});
