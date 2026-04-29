import { expect, test, type Page } from '@playwright/test';

async function clearAppData(page: Page) {
  await page.goto('/ExerciseTracker/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await clearAppData(page);
});

test('loads from the GitHub Pages base path and refreshes direct app routes', async ({ page }) => {
  await expect(page.getByRole('link', { name: /ExerciseTracker home/i })).toBeVisible();

  await page.goto('/ExerciseTracker/plan');
  await expect(page.getByRole('heading', { name: 'Weekly workouts' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Weekly workouts' })).toBeVisible();
});

test('primary navigation reaches each major view', async ({ page }) => {
  await page.getByRole('link', { name: 'Plan' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly workouts' })).toBeVisible();

  await page.getByRole('link', { name: 'Workout' }).click();
  await expect(page.getByText(/sets completed/i)).toBeVisible();

  await page.getByRole('link', { name: 'Progress' }).click();
  await expect(page.getByRole('heading', { name: 'Exercise history' })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Bands and data' })).toBeVisible();

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Workout/ })).toBeVisible();
});

test('workout flow creates rest UI and saves a completed session', async ({ page }) => {
  await page.getByRole('link', { name: 'Workout' }).click();
  await expect(page.getByText('0 of 15 sets completed')).toBeVisible();

  for (let index = 0; index < 15; index += 1) {
    await page.getByRole('button', { name: 'Complete set' }).first().click();

    if (index < 14) {
      await expect(page.getByText('Recovery')).toBeVisible();
      await page.getByRole('button', { name: 'Skip' }).click();
    }
  }

  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Exercise history' })).toBeVisible();
  await expect(page.getByText(/15 sets/)).toBeVisible();
});

test('data tools expose exports and reject invalid imports without crashing', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeVisible();

  await page.getByLabel('Import JSON export').setInputFiles({
    name: 'bad-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{bad json'),
  });

  await expect(page.getByText('Import file is not valid JSON.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bands and data' })).toBeVisible();
});

test('mobile primary navigation stays inside the viewport', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width > 500, 'Mobile viewport check only.');

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  const navBox = await nav.boundingBox();

  expect(navBox).not.toBeNull();
  expect(navBox?.x).toBeGreaterThanOrEqual(0);
  expect((navBox?.x ?? 0) + (navBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);

  for (const label of ['Home', 'Plan', 'Workout', 'Progress', 'Settings']) {
    await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
});
