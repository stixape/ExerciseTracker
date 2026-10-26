import { expect, test, type Download, type Page } from '@playwright/test';
import { createDefaultAppData } from '../src/domain/sampleData';
import { createSessionFromDay } from '../src/domain/session';

function fixture() {
  const data = createDefaultAppData('local-user');
  data.template.name = 'Recovery verification plan';
  const session = createSessionFromDay(data.template.days[0]);
  const completedAt = new Date(Date.parse(session.startedAt) + 60_000).toISOString();
  data.sessions = [{ ...session, completedAt, sets: session.sets.map((set) => ({ ...set, completedAt })) }];
  data.activeWorkout = { session: createSessionFromDay(data.template.days[1]) };
  data.settings.hideRestTimes = true;
  data.bandColours.push({ id: 'recovery-band', name: 'Recovery band', hex: '#123456', archived: true });
  return data;
}
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('ExerciseTracker'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try {
      return await new Promise<{ data: unknown; revision: number; snapshotId: string }>((resolve, reject) => {
        const req = db.transaction('appData').objectStore('appData').get('local-user'); req.onsuccess = () => resolve(JSON.parse(JSON.stringify(req.result))); req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  });
}
async function importFixture(page: Page) {
  await page.goto('/ExerciseTracker/');
  await page.getByLabel('Import JSON export').setInputFiles({ name: 'synthetic-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 4, data: fixture() })) });
  await expect(page.getByRole('button', { name: 'Restore this backup' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore this backup' }).click();
  await expect(page.getByRole('link', { name: /ExerciseTracker home/i })).toBeVisible();
}
async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function offlineReady(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('an empty origin offers recovery and never writes defaults without consent', async ({ page }) => {
  await page.goto('/ExerciseTracker/');
  await expect(page.getByRole('heading', { name: 'Restore or start ExerciseTracker' })).toBeVisible();
  expect(await page.evaluate(async () => {
    const req = indexedDB.open('ExerciseTracker');
    const db = await new Promise<IDBDatabase>((resolve) => { req.onsuccess = () => resolve(req.result); });
    const count = await new Promise<number>((resolve) => { const get = db.transaction('appData').objectStore('appData').count(); get.onsuccess = () => resolve(get.result); }); db.close(); return count;
  })).toBe(0);
});

test('a verified JSON file restores all records after complete origin storage loss and works offline', async ({ page, context, baseURL }) => {
  await importFixture(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON backup' }).click();
  const file = await downloadBytes(await downloadPromise);
  const expected = JSON.parse(file.toString()).data;
  await page.getByLabel('Verify saved backup').setInputFiles({ name: 'verified.json', mimeType: 'application/json', buffer: file });
  await expect(page.getByText('Saved backup verified against the current revision.')).toBeVisible();
  await offlineReady(page);
  await page.close();
  const diagnostic = await context.newPage();
  await diagnostic.goto('/ExerciseTracker/manifest.webmanifest');
  const cdp = await context.newCDPSession(diagnostic);
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(baseURL!).origin, storageTypes: 'all' });
  expect(await diagnostic.evaluate(async () => ({ databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length, workers: (await navigator.serviceWorker.getRegistrations()).length, local: localStorage.length }))).toEqual({ databases: 0, caches: 0, workers: 0, local: 0 });
  await diagnostic.close();
  const restored = await context.newPage();
  // The shell must be reacquired online after its caches and worker are lost.
  await restored.goto('/ExerciseTracker/');
  await expect(restored.getByRole('heading', { name: 'Restore or start ExerciseTracker' })).toBeVisible();
  await offlineReady(restored);
  await context.setOffline(true);
  await restored.getByLabel('Import JSON export').setInputFiles({ name: 'verified.json', mimeType: 'application/json', buffer: file });
  await restored.getByRole('button', { name: 'Restore this backup' }).click();
  await expect(restored.getByRole('link', { name: /ExerciseTracker home/i })).toBeVisible();
  expect((await record(restored)).data).toEqual(expected);
  await restored.reload();
  await expect(restored.getByRole('link', { name: /ExerciseTracker home/i })).toBeVisible();
  expect((await record(restored)).data).toEqual(expected);
});

test('stale suspended windows cannot overwrite another window’s imported records', async ({ page, context }) => {
  await importFixture(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const stale = await context.newPage();
  await stale.goto('/ExerciseTracker/settings');
  await expect(stale.getByRole('heading', { name: 'Workout, bands and data' })).toBeVisible();
  const updated = fixture(); updated.template.name = 'Newer plan from another window';
  await page.getByLabel('Import JSON export').setInputFiles({ name: 'new.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 4, data: updated })) });
  await page.getByRole('button', { name: 'Restore this backup' }).click();
  await expect(page.getByText('JSON import restored.')).toBeVisible();
  const newer = await record(page);
  await stale.bringToFront();
  await stale.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(stale.getByRole('alert')).toContainText('another window');
  await expect(stale.getByRole('checkbox', { name: /Hide rest times/ })).toBeDisabled();
  expect(await record(stale)).toEqual(newer);
});

test('unfinished editor fields do not poison unrelated saves or backups', async ({ page }) => {
  await importFixture(page);
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  const card = page.locator('details.plan-exercise-card').first();
  await card.locator('summary').click();
  const name = card.getByLabel('Exercise 1 name');
  const previous = await name.inputValue();
  await name.fill('');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: /Hide rest times/ }).uncheck();
  await expect(page.locator('.save-status')).toContainText('Saved on this device');
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await page.locator('details.plan-exercise-card').first().locator('summary').click();
  await expect(page.getByLabel('Exercise 1 name')).toHaveValue(previous);
});

test('schema v5 and an old worker cache upgrade without losing workout records', async ({ page }) => {
  await page.goto('/ExerciseTracker/manifest.webmanifest');
  const data = fixture();
  await page.evaluate(async (original) => {
    const request = indexedDB.open('ExerciseTracker', 50);
    request.onupgradeneeded = () => request.result.createObjectStore('appData', { keyPath: 'userId' });
    const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('appData', 'readwrite'); tx.objectStore('appData').put({ userId: 'local-user', updatedAt: new Date().toISOString(), data: original }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    await navigator.serviceWorker.register('/ExerciseTracker/previous-worker.js', { scope: '/ExerciseTracker/' });
    await navigator.serviceWorker.ready;
  }, data);
  await page.goto('/ExerciseTracker/');
  await expect(page.getByRole('link', { name: /ExerciseTracker home/i })).toBeVisible();
  await offlineReady(page);
  expect((await record(page)).data).toEqual(data);
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('exercise-tracker-previous-release');
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('link', { name: /ExerciseTracker home/i })).toBeVisible();
  expect((await record(page)).data).toEqual(data);
});
