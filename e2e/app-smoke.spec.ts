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

  await page.getByRole('link', { name: 'Progress' }).click();
  await expect(page.getByRole('heading', { name: 'Exercise history' })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Bands and data' })).toBeVisible();

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Workout/);

  await page.getByRole('link', { name: 'Workout' }).click();
  await expect(page.getByText('Current set')).toBeVisible();
});

test('workout flow creates rest UI and saves a completed session', async ({ page }) => {
  await page.getByRole('link', { name: 'Workout' }).click();
  await expect(page.getByText('Current set')).toBeVisible();
  await expect(page.getByText('Target reps')).toBeVisible();
  await expect(page.getByLabel('Attained reps')).toBeVisible();
  await expect(page.getByLabel('Attained reps').locator('option')).toHaveCount(6);
  await expect(page.getByLabel('New weight')).toBeVisible();
  await expect(page.getByLabel('Attained weight')).toHaveCount(0);
  const repsBox = await page.getByLabel('Attained reps').boundingBox();
  const newWeightBox = await page.getByLabel('New weight').boundingBox();
  expect(repsBox).not.toBeNull();
  expect(newWeightBox).not.toBeNull();
  expect(newWeightBox!.y).toBeGreaterThan(repsBox!.y);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const reps = document.querySelector('[aria-label="Attained reps"]');
        const newWeight = document.querySelector('[aria-label="New weight"]');
        if (!reps || !newWeight) return false;
        return Boolean(reps.compareDocumentPosition(newWeight) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Exit Workout' }).click();
  await expect(page.locator('main h1')).toHaveText(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Workout/);
  await expect(page.getByText('Workout in progress')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Current set')).toBeVisible();
  await page.getByLabel('New weight').fill('62.5');

  for (let index = 0; index < 15; index += 1) {
    await page.getByRole('button', { name: 'Complete set' }).first().click();

    if (index < 14) {
      if (index === 0) {
        await expect
          .poll(async () =>
            page.evaluate(() => {
              const raw = localStorage.getItem('exercise-tracker:data:local-user');
              if (!raw) return undefined;
              const data = JSON.parse(raw);
              const activeWorkout = data.activeWorkout;
              const completedSet = activeWorkout?.session.sets[0];
              const day = data.template.days.find((item: { id: string }) => item.id === activeWorkout?.session.templateDayId);
              const exercise = day?.exercises.find((item: { id: string }) => item.id === completedSet?.exerciseId);
              const templateSet = exercise?.sets.find((item: { id: string }) => item.id === completedSet?.templateSetId);
              return templateSet?.target.weightKg;
            }),
          )
          .toBe(62.5);
      }

      await expect(page.getByText('Rest period')).toBeVisible();
      await expect(page.getByText('Next up')).toBeVisible();
      await expect(page.getByText(/^Target:/)).toBeVisible();
      await page.getByRole('button', { name: 'Skip' }).click();
      await expect(page.getByText('Current set')).toBeVisible();
    }
  }

  await expect(page.locator('main h1')).toHaveText(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Workout/);
  await page.getByRole('link', { name: 'Progress' }).click();
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

test('settings adds custom band colours with visible validation', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Enter a band name.')).toBeVisible();

  await page.getByLabel('Name').fill('Purple');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByText('Purple added.')).toBeVisible();
  await expect(page.getByText('Purple', { exact: true })).toBeVisible();
});

test('plan numeric target fields can be cleared before entering new values', async ({ page }) => {
  await page.getByRole('link', { name: 'Plan' }).click();

  const kgInput = page.getByLabel('Kg').first();
  await kgInput.fill('');
  await expect(kgInput).toHaveValue('');
  await kgInput.fill('12.5');
  await expect(kgInput).toHaveValue('12.5');

  const repsInput = page.getByLabel('Reps').first();
  await repsInput.fill('');
  await expect(repsInput).toHaveValue('');
  await repsInput.fill('8');
  await expect(repsInput).toHaveValue('8');
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
