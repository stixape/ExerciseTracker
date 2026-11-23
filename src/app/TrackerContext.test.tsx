import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppData } from '../domain/sampleData';
import { hasSavedWorkoutOn } from '../domain/calendar';
import { completeSessionIfDone, completeSet, createSessionFromDay } from '../domain/session';
import { parseJsonImport } from '../lib/localData';
import { commitAppData, loadAppData, offlineDb } from '../lib/offlineDb';
import * as repository from '../lib/offlineDb';
import { TrackerProvider, useTracker } from './TrackerContext';

let context: ReturnType<typeof useTracker>;
function Probe() { const value = useTracker(); useLayoutEffect(() => { context = value; }, [value]); return <span data-testid="plan">{value.data.template.name}</span>; }
async function mount() {
  render(<TrackerProvider><Probe /></TrackerProvider>);
  await screen.findByTestId('plan');
}
beforeEach(async () => {
  localStorage.clear(); await offlineDb.delete(); await offlineDb.open();
  await commitAppData(createDefaultAppData('local-user'), null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); offlineDb.close(); });

describe('saving and exclusive replacements', () => {
  it('blocks ordinary edits and duplicate imports while a replacement waits on pending writes', async () => {
    await mount();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = repository.commitAppData;
    const put = vi.spyOn(repository, 'commitAppData').mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    let first!: Promise<boolean>;
    act(() => { first = context.saveData((data) => ({ ...data, template: { ...data.template, name: 'Old dataset edit' } })); });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const imported = createDefaultAppData('local-user'); imported.template.name = 'Imported dataset';
    let replacement!: Promise<boolean>;
    act(() => { replacement = context.replaceData(imported); });
    let blockedEdit = true;
    await act(async () => { blockedEdit = await context.saveData((data) => ({ ...data, settings: { hideRestTimes: true } })); });
    expect(blockedEdit).toBe(false);
    expect(await context.replaceData(imported)).toBe(false);
    await act(async () => { release(); await first; expect(await replacement).toBe(true); });
    expect(context.data).toEqual(imported);
    const saved = await loadAppData('local-user');
    expect(saved.kind === 'ready' && saved.snapshot.data).toEqual(imported);
  });
  it('retains unsaved changes for rescue export and supports explicit retry after a quota failure', async () => {
    await mount();
    vi.spyOn(offlineDb.appData, 'put').mockRejectedValueOnce(new DOMException('Synthetic quota', 'QuotaExceededError'));
    await act(async () => {
      expect(await context.saveData((data) => ({ ...data, template: { ...data.template, name: 'Unsaved plan' } }))).toBe(false);
    });
    expect(context.status).toBe('error');
    await expect(context.getBackupJson()).rejects.toThrow('Save failed');
    const rescue = parseJsonImport(await context.getBackupJson(true), 'local-user');
    expect(rescue.ok && rescue.data.template.name).toBe('Unsaved plan');
    const previous = await loadAppData('local-user');
    expect(previous.kind === 'ready' && previous.snapshot.data.template.name).not.toBe('Unsaved plan');
    await act(async () => { expect(await context.retrySave()).toBe(true); });
    expect(context.status).toBe('saved');
    const saved = await loadAppData('local-user');
    expect(saved.kind === 'ready' && saved.snapshot.data.template.name).toBe('Unsaved plan');
  });
  it('does not let an incomplete edit poison unrelated saves', async () => {
    await mount();
    const originalName = context.data.template.name;
    await act(async () => { expect(await context.saveData((data) => ({ ...data, template: { ...data.template, name: '' } }))).toBe(false); });
    expect(context.data.template.name).toBe(originalName);
    await act(async () => { expect(await context.saveData((data) => ({ ...data, settings: { hideRestTimes: true } }))).toBe(true); });
    expect(context.status).toBe('saved');
    expect(parseJsonImport(await context.getBackupJson(), 'local-user').ok).toBe(true);
  });
  it('keeps completion visible and retries the workout atomically if backup queue insertion fails', async () => {
    await mount();
    const session = createSessionFromDay(context.data.template.days[0]);
    const completed = completeSessionIfDone(session.sets.reduce((current, set) => completeSet(current, set.id, set.actual), session));
    await act(async () => { expect(await context.saveData((data) => ({ ...data, activeWorkout: { session: completed } }))).toBe(true); });
    vi.spyOn(offlineDb.workoutBackupJobs, 'put').mockRejectedValueOnce(new DOMException('Synthetic quota', 'QuotaExceededError'));
    await act(async () => {
      expect(await context.saveData((data) => ({ ...data, sessions: [completed], activeWorkout: undefined }), 'workout')).toBe(false);
    });
    expect(context.data.activeWorkout?.session.id).toBe(completed.id);
    expect(hasSavedWorkoutOn(context.data.sessions, new Date(completed.startedAt))).toBe(false);
    expect(await offlineDb.workoutBackupJobs.count()).toBe(0);
    await act(async () => { expect(await context.retrySave()).toBe(true); });
    expect(context.data.activeWorkout).toBeUndefined();
    expect(context.data.sessions.map((item) => item.id)).toEqual([completed.id]);
    expect(hasSavedWorkoutOn(context.data.sessions, new Date(completed.startedAt))).toBe(true);
    expect(await repository.workoutBackupKeys('local-user')).toEqual([context.snapshot?.snapshotId]);
  });

  it('restores a mixed plan with shared targets while preserving the imported workout', async () => {
    const imported = createDefaultAppData('local-user');
    const day = imported.template.days[0];
    day.exercises[0].sets[1].target.weightKg = 25;
    imported.activeWorkout = { session: createSessionFromDay(day) };
    await mount();
    await act(async () => { expect(await context.replaceData(imported, 'restore')).toBe(true); });
    expect(context.data.template.days[0].exercises[0].sets.map((set) => set.target.weightKg)).toEqual([60, 60, 60]);
    expect(context.data.activeWorkout).toEqual(imported.activeWorkout);
    expect(imported.template.days[0].exercises[0].sets[1].target.weightKg).toBe(25);
  });
});
