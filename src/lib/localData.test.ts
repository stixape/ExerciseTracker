import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAppData } from '../domain/sampleData';
import { clearLocalData, loadLocalData, parseJsonImport, resetLocalData, saveLocalData } from './localData';

const userId = 'local-user';

describe('local data import and reset', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('imports a versioned JSON export and normalizes missing weekdays', () => {
    const exportedData = createDefaultAppData('exported-user');
    exportedData.template.days = exportedData.template.days.slice(0, 1);

    const result = parseJsonImport(JSON.stringify({ version: 1, data: exportedData }), userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userId).toBe(userId);
    expect(result.data.template.days).toHaveLength(6);
    expect(result.data.template.days.map((day) => day.label)).toContain('Saturday');
  });

  it('rejects invalid JSON imports', () => {
    expect(parseJsonImport('{not-json', userId)).toEqual({ ok: false, error: 'Import file is not valid JSON.' });
  });

  it('rejects unsupported JSON export versions', () => {
    expect(parseJsonImport(JSON.stringify({ version: 2, data: createDefaultAppData(userId) }), userId)).toEqual({
      ok: false,
      error: 'Import file must be an ExerciseTracker JSON export version 1.',
    });
  });

  it('resets local data to the default plan without an active workout', () => {
    const dirtyData = createDefaultAppData(userId);
    dirtyData.sessions = [
      {
        id: 'session',
        templateDayId: 'day',
        label: 'Old session',
        startedAt: '2026-01-01T10:00:00.000Z',
        completedAt: '2026-01-01T10:30:00.000Z',
        snapshot: dirtyData.template.days[0],
        sets: [],
        restEvents: [],
      },
    ];
    dirtyData.activeWorkout = {
      session: {
        id: 'active',
        templateDayId: dirtyData.template.days[0].id,
        label: dirtyData.template.days[0].label,
        startedAt: '2026-01-02T10:00:00.000Z',
        snapshot: dirtyData.template.days[0],
        sets: [],
        restEvents: [],
      },
    };

    saveLocalData(dirtyData);
    const resetData = resetLocalData(userId);
    const loadedData = loadLocalData(userId);

    expect(resetData.sessions).toEqual([]);
    expect(resetData.activeWorkout).toBeUndefined();
    expect(loadedData.sessions).toEqual([]);
    expect(loadedData.activeWorkout).toBeUndefined();
    expect(loadedData.template.days.map((day) => day.label)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  });

  it('loads defaults after local storage is cleared', () => {
    saveLocalData(createDefaultAppData(userId));
    clearLocalData(userId);

    const loadedData = loadLocalData(userId);
    expect(loadedData.sessions).toEqual([]);
    expect(loadedData.template.days).toHaveLength(6);
  });
});
