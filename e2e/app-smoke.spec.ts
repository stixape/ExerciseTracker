import { expect, test, type Page } from '@playwright/test';

type ExerciseFixture = {
  id: string;
  name: string;
  mode: 'weighted_reps' | 'timed_hold' | 'band_reps';
  target: { weightKg?: number; reps?: number; seconds?: number; bandColourIds?: string[] };
};

const bands = [
  { id: 'band_red', name: 'Red', hex: '#d64242' },
  { id: 'band_green', name: 'Green', hex: '#2f9e60' },
  { id: 'band_blue', name: 'Blue', hex: '#2d6cdf' },
];

async function openApp(page: Page) {
  await page.goto('/ExerciseTracker/');
  await expect(page.getByRole('link', { name: /ExerciseTracker home/i })).toBeVisible();
}

async function importWorkout(page: Page, label: string, exercises: ExerciseFixture[]) {
  await openApp(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Import JSON export').setInputFiles({
    name: 'workout-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-08-24T10:00:00.000Z',
        data: {
          userId: 'local-user',
          template: {
            id: 'template_test',
            name: 'Test plan',
            days: [
              {
                id: 'day_test',
                weekday: 1,
                label,
                exercises: exercises.map((exercise, exerciseIndex) => ({
                  id: exercise.id,
                  name: exercise.name,
                  mode: exercise.mode,
                  sets: [
                    {
                      id: `template_set_${exerciseIndex + 1}`,
                      setNumber: 1,
                      target: exercise.target,
                    },
                  ],
                })),
              },
            ],
          },
          bandColours: bands,
          sessions: [],
          settings: { hideRestTimes: false },
        },
      }),
    ),
  });
  await expect(page.getByText('JSON import restored.')).toBeVisible();
  await page.goto('/ExerciseTracker/workout/day_test');
}

function acceptNextDialog(page: Page) {
  page.once('dialog', (dialog) => dialog.accept());
}

test('loads direct routes and exposes semantic primary navigation', async ({ page }) => {
  await openApp(page);

  await page.goto('/ExerciseTracker/plan');
  await expect(page.getByRole('heading', { name: 'Weekly workouts' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Workout days' })).toBeVisible();

  await page.reload();
  await expect(page).toHaveTitle(/Plan \| ExerciseTracker/);
  await expect(page.getByRole('heading', { name: 'Weekly workouts' })).toBeFocused();

  for (const label of ['Home', 'Plan', 'Workout', 'Progress', 'Settings']) {
    await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
});

test('the single default appearance has a persistent hide-rest setting', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Light' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveCount(0);
  const hideRestTimes = page.getByRole('checkbox', { name: /Hide rest times/ });
  await expect(hideRestTimes).not.toBeChecked();
  await hideRestTimes.check();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Hide rest times/ })).toBeChecked();
});

test('hide rest times goes straight to the next set', async ({ page }) => {
  await importWorkout(page, 'No-rest test', [
    { id: 'exercise_one', name: 'First Move', mode: 'weighted_reps', target: { weightKg: 10, reps: 5 } },
    { id: 'exercise_two', name: 'Second Move', mode: 'weighted_reps', target: { weightKg: 20, reps: 5 } },
  ]);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('checkbox', { name: /Hide rest times/ }).check();
  await page.goto('/ExerciseTracker/workout/day_test');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Complete set' }).click();

  await expect(page.getByRole('heading', { name: 'Second Move' })).toBeVisible();
  await expect(page.getByText('Rest period')).toHaveCount(0);
});

test('used band colours can be reordered and removed everywhere', async ({ page }) => {
  await importWorkout(page, 'Band settings test', [
    { id: 'exercise_band', name: 'Band Row', mode: 'band_reps', target: { reps: 10, bandColourIds: ['band_red'] } },
  ]);

  await page.getByRole('link', { name: 'Settings' }).click();
  const blueHandle = page.getByRole('button', { name: /Reorder Blue/ });
  await blueHandle.dragTo(page.locator('.band-row[data-band-id="band_red"]'));
  await expect(page.locator('.band-row strong')).toHaveText(['Blue', 'Red', 'Green']);

  await page.reload();
  await expect(page.locator('.band-row strong')).toHaveText(['Blue', 'Red', 'Green']);

  acceptNextDialog(page);
  await page.getByRole('button', { name: 'Remove Red' }).click();
  await expect(page.getByText('Red removed from band colours, plans, and workouts.')).toBeVisible();
  await expect(page.locator('.band-row strong')).toHaveText(['Blue', 'Green']);

  await page.getByRole('link', { name: 'Plan' }).click();
  const bandCard = page.locator('details.plan-exercise-card').filter({ hasText: 'Band Row' });
  await bandCard.locator('summary').click();
  expect(await bandCard.locator('.band-picker button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual([
    'Blue band',
    'Green band',
  ]);

  await page.goto('/ExerciseTracker/workout/day_test');
  await page.getByRole('button', { name: 'Start workout' }).click();
  expect(
    await page
      .locator('.band-fieldset')
      .first()
      .locator('.band-picker button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
  ).toEqual(['Blue for Performed bands', 'Green for Performed bands']);
});

test('workout preview does not start a session and active entries survive reload', async ({ page }) => {
  await importWorkout(page, 'Strength test', [
    { id: 'exercise_weight', name: 'Test Squat', mode: 'weighted_reps', target: { weightKg: 60, reps: 5 } },
  ]);

  await expect(page.getByText('Workout preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
  await expect(page.getByText('Current set')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Workout preview')).toBeVisible();

  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByText('Current set')).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Performed weight' }).fill('62.5');
  await page.getByRole('spinbutton', { name: 'Performed reps' }).fill('8');
  await expect(page.getByRole('spinbutton', { name: 'Performed reps' })).toHaveValue('8');

  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Performed weight' })).toHaveValue('62.5');
  await expect(page.getByRole('spinbutton', { name: 'Performed reps' })).toHaveValue('8');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume workout' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await expect(page.getByRole('heading', { name: 'Test Squat' })).toBeVisible();
});

test('manual selection returns to the earliest incomplete set and supports undo, restart, and discard', async ({ page }) => {
  await importWorkout(page, 'Choice test', [
    { id: 'exercise_one', name: 'First Move', mode: 'weighted_reps', target: { weightKg: 10, reps: 5 } },
    { id: 'exercise_two', name: 'Second Move', mode: 'weighted_reps', target: { weightKg: 20, reps: 5 } },
  ]);
  await page.getByRole('button', { name: 'Start workout' }).click();

  const secondExercise = page.getByRole('button', { name: /Second Move, 0 of 1 sets complete/ });
  await expect(secondExercise).toHaveAttribute('aria-pressed', 'false');
  await secondExercise.click();
  await expect(page.getByRole('heading', { name: 'Second Move' })).toBeVisible();
  await expect(secondExercise).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByText('Rest period')).toBeVisible();
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await expect(page.getByRole('heading', { name: 'First Move' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo last set' }).click();
  await expect(page.getByRole('heading', { name: 'Second Move' })).toBeVisible();

  acceptNextDialog(page);
  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByRole('heading', { name: 'First Move' })).toBeVisible();
  await expect(page.getByLabel('Workout progress')).toHaveAttribute('value', '0');

  acceptNextDialog(page);
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('button', { name: 'Resume workout' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
});

test('performed bands and over-target reps stay separate from reviewed next targets', async ({ page }) => {
  await importWorkout(page, 'Band test', [
    { id: 'exercise_band', name: 'Band Row', mode: 'band_reps', target: { reps: 10, bandColourIds: ['band_red'] } },
  ]);
  await page.getByRole('button', { name: 'Start workout' }).click();

  await page.getByRole('button', { name: 'Green for Performed bands' }).click();
  await page.getByRole('button', { name: 'Red for Performed bands' }).click();
  await page.getByRole('spinbutton', { name: 'Performed reps' }).fill('18');

  await page.getByText('Next time', { exact: false }).click();
  await page.getByRole('button', { name: 'Blue for Next target bands' }).click();
  await page.getByRole('button', { name: 'Red for Next target bands' }).click();
  await page.getByRole('spinbutton', { name: 'Next target reps' }).fill('20');

  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByText('Review before saving')).toBeVisible();
  await expect(page.locator('.summary-set-row').getByText('Green x 18', { exact: true })).toBeVisible();
  await expect(page.getByText(/Next time: Blue.*20 reps/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Save workout' })).toBeVisible();
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('heading', { name: 'Exercise history' })).toBeVisible();
  await expect(page.locator('.history-row').getByText('Green x 18', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Plan' }).click();
  const bandCard = page.locator('details.plan-exercise-card').filter({ hasText: 'Band Row' });
  await bandCard.locator('summary').click();
  const selectedBand = bandCard.getByRole('button', { name: 'Blue band' });
  await expect(selectedBand).toHaveAttribute('aria-pressed', 'true');
  await expect(selectedBand).toHaveCSS('box-shadow', /6px/);
  await expect(bandCard.getByLabel('Reps')).toHaveValue('20');
});

test('completion review can undo a finished set before saving', async ({ page }) => {
  await importWorkout(page, 'Review test', [
    { id: 'exercise_hold', name: 'Long Hold', mode: 'timed_hold', target: { seconds: 30 } },
  ]);
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('spinbutton', { name: 'Performed seconds' }).fill('45');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('heading', { name: 'Review test complete' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo Long Hold set 1' }).click();
  await expect(page.getByRole('heading', { name: 'Long Hold' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Performed seconds' })).toHaveValue('45');
});

test('empty planned days cannot create dead-end workouts', async ({ page }) => {
  await importWorkout(page, 'Empty test', []);

  await expect(page.getByText('This workout is empty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit plan' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly workouts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
});

test('Sunday is a rest day instead of falling back to Monday', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-30T10:00:00') });
  await openApp(page);

  await expect(page.getByRole('heading', { name: 'Rest day' })).toBeVisible();
  await expect(page.getByText('Nothing is scheduled today')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout' })).toHaveCount(0);
});

test('plan editors are collapsed, labelled, and expose selected state', async ({ page }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Plan' }).click();

  const firstCard = page.locator('details.plan-exercise-card').first();
  await expect(firstCard).not.toHaveAttribute('open', '');
  await firstCard.locator('summary').click();
  await expect(firstCard.getByLabel('Exercise 1 name')).toBeVisible();
  await expect(firstCard.getByRole('button', { name: 'Weight' })).toHaveAttribute('aria-pressed', 'true');
  await expect(firstCard.getByText('Left/right reps')).toHaveCount(0);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();
});

test('mobile navigation and the sticky workout action remain inside the viewport', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width > 500, 'Mobile viewport check only.');

  await importWorkout(page, 'Mobile test', [
    { id: 'exercise_mobile', name: 'Mobile Press', mode: 'weighted_reps', target: { weightKg: 20, reps: 5 } },
  ]);
  await page.getByRole('button', { name: 'Start workout' }).click();

  const completeButton = page.getByRole('button', { name: 'Complete set' });
  await expect(completeButton).toBeVisible();
  const completeBox = await completeButton.boundingBox();
  expect(completeBox).not.toBeNull();
  expect((completeBox?.x ?? 0) + (completeBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);

  await page.getByRole('button', { name: 'Pause' }).click();
  const navBox = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
  expect(navBox).not.toBeNull();
  expect((navBox?.x ?? 0) + (navBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
});
