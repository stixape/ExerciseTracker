import { expect, test, type Page } from '@playwright/test';

type ExerciseFixture = {
  id: string;
  name: string;
  mode: 'weighted_reps' | 'timed_hold' | 'band_reps' | 'interval';
  target: { weightKg?: number; reps?: number; seconds?: number; bandColourIds?: string[] };
  setCount?: number;
  restSeconds?: number;
};

const bands = [
  { id: 'band_red', name: 'Red', hex: '#d64242' },
  { id: 'band_green', name: 'Green', hex: '#2f9e60' },
  { id: 'band_blue', name: 'Blue', hex: '#2d6cdf' },
];

async function openApp(page: Page) {
  await page.goto('/ExerciseTracker/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Create starter plan' })).toBeVisible();
  await page.getByRole('button', { name: 'Create starter plan' }).click();
  await expect(page.getByRole('link', { name: 'Workout', exact: true })).toBeVisible();
}

async function importWorkout(page: Page, label: string, exercises: ExerciseFixture[], options?: { hideRestTimes?: boolean; runningClock?: boolean }) {
  const monday = new Date('2026-11-23T10:00:00');
  if (options?.runningClock) {
    await page.clock.install({ time: monday });
    await page.clock.pauseAt(new Date(monday.getTime() + 1000));
  } else {
    await page.clock.setFixedTime(monday);
  }
  await page.goto('/ExerciseTracker/', { waitUntil: 'domcontentloaded' });
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
                  restSeconds: exercise.restSeconds,
                  sets: Array.from({ length: exercise.setCount ?? 1 }, (_, index) => ({
                    id: `template_set_${exerciseIndex + 1}_${index + 1}`,
                    setNumber: index + 1,
                    target: exercise.target,
                  })),
                })),
              },
            ],
          },
          bandColours: bands,
          sessions: [],
          settings: { hideRestTimes: options?.hideRestTimes ?? false },
        },
      }),
    ),
  });
  await page.getByRole('button', { name: 'Restore this backup' }).click();
  await expect(page.getByRole('link', { name: 'Workout', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/workout$/);
}

function acceptNextDialog(page: Page) {
  page.once('dialog', (dialog) => dialog.accept());
}

async function trackIntervalAudio(page: Page) {
  await page.addInitScript(() => {
    const audioWindow = window as Window & { intervalCues: string[] };
    audioWindow.intervalCues = [];
    class TestAudioContext {
      state = 'running';
      destination = {};
      async decodeAudioData(bytes: ArrayBuffer) {
        // MP3 frame sync distinguishes the supplied bell from the RIFF workout alarm.
        return new Uint8Array(bytes)[0] === 0xff ? 'bell' : 'finish';
      }
      createBufferSource() {
        return {
          buffer: '',
          connect() {},
          stop() {},
          start() { audioWindow.intervalCues.push(this.buffer); },
        };
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: TestAudioContext });
  });
  return () => page.evaluate(() => (window as Window & { intervalCues?: string[] }).intervalCues);
}

test('interval work and rest run with ordered cues, pause, resume and skip', async ({ page }) => {
  const cues = await trackIntervalAudio(page);
  await importWorkout(page, 'Circuit day', [
    { id: 'circuit', name: 'Circuit', mode: 'interval', target: { seconds: 3 }, setCount: 3, restSeconds: 4 },
    { id: 'next', name: 'Next exercise', mode: 'weighted_reps', target: { weightKg: 10, reps: 5 } },
  ], { runningClock: true, hideRestTimes: true });
  await expect(page.getByText('3x0:03')).toBeVisible();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Start interval' }).click();

  const timer = page.getByRole('timer');
  const panel = page.getByRole('article', { name: 'Interval timer' });
  const pause = panel.getByRole('button', { name: 'Pause interval' });
  const resume = panel.getByRole('button', { name: 'Resume interval' });
  const skip = panel.getByRole('button', { name: 'Skip rest' });
  await expect(pause).toBeEnabled();
  await expect(timer).toHaveText('0:03');
  await page.clock.runFor(1000);
  await pause.click();
  await expect(resume).toBeEnabled();
  await page.clock.runFor(10_000);
  await expect(timer).toHaveText('0:02');
  await resume.click();
  await expect(pause).toBeEnabled();
  await page.clock.runFor(2000);
  await expect(skip).toBeEnabled();
  await expect(timer).toHaveText('0:04');
  await expect.poll(cues).toEqual(['bell']);
  await page.clock.runFor(4000);
  await expect(panel.getByText('Set 2 of 3')).toBeVisible();
  await expect(pause).toBeEnabled();
  await expect.poll(cues).toEqual(['bell', 'bell']);
  await page.clock.runFor(3000);
  await expect(skip).toBeEnabled();
  await page.clock.runFor(1000);
  await pause.click();
  await expect(resume).toBeEnabled();
  await page.clock.runFor(10_000);
  await expect(timer).toHaveText('0:03');
  await skip.click();
  await expect(panel.getByText('Set 3 of 3')).toBeVisible();
  await expect(pause).toBeEnabled();
  await expect.poll(cues).toEqual(['bell', 'bell', 'bell', 'bell']);
  await page.clock.runFor(3000);
  await expect(page.getByRole('heading', { name: 'Next exercise' })).toBeVisible();
  await expect.poll(cues).toEqual(['bell', 'bell', 'bell', 'bell', 'finish']);
});

test('interval reload catches up once, then a saved workout shows recorded seconds', async ({ page }) => {
  const cues = await trackIntervalAudio(page);
  await importWorkout(page, 'Circuit restore', [
    { id: 'circuit', name: 'Circuit', mode: 'interval', target: { seconds: 3 }, setCount: 2, restSeconds: 4 },
  ], { runningClock: true });
  await page.getByRole('link', { name: 'Plan' }).click();
  const card = page.locator('details.plan-exercise-card').first();
  await card.locator('summary').click();
  const time = card.getByRole('spinbutton', { name: 'Work Time (minutes)', exact: true });
  await expect(time).toHaveValue('0.05');
  const sets = card.getByRole('spinbutton', { name: 'Sets', exact: true });
  await sets.fill('3');
  await sets.press('Enter');
  await time.fill('0.075');
  await time.press('Enter');
  await expect(time).toHaveValue('0.0833');
  await page.getByRole('link', { name: 'Workout', exact: true }).click();
  await expect(page.getByText('3x0:05')).toBeVisible();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Start interval' }).click();
  const pause = page.getByRole('button', { name: 'Pause interval' });
  const save = page.getByRole('button', { name: 'Save workout' });
  await expect(pause).toBeEnabled();
  await page.clock.setSystemTime(new Date('2026-11-23T10:00:45'));
  await page.reload();
  // A real focus or pageshow event can finish catch-up before the synthetic signals.
  await expect(pause.or(save)).toBeEnabled();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(50);
  await expect(save).toBeEnabled();
  await expect.poll(cues).toEqual(['finish']);
  await page.reload();
  await expect(save).toBeEnabled();
  await expect.poll(cues).toEqual([]);
  const reviewRows = page.locator('.summary-set-row');
  await expect(reviewRows.nth(1).locator('.next-target-panel')).toHaveCount(0);
  await reviewRows.last().locator('.next-target-panel summary').click();
  const nextWork = page.getByRole('spinbutton', { name: 'Next time Work Time (minutes)' });
  await nextWork.fill('0.1');
  await nextWork.press('Enter');
  await expect(reviewRows.last().getByText('Next time: 6s')).toBeVisible();
  await save.click();
  await expect(page.getByRole('heading', { name: 'Session history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Circuit 3 completed sets' })).toBeVisible();
  await expect(page.getByText('5s | 5s | 5s', { exact: true })).toBeVisible();
  await page.getByText('View recorded sets', { exact: true }).click();
  await expect(page.getByText('Set 3: 5s', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Workout', exact: true }).click();
  await expect(page.getByText('3x0:06')).toBeVisible();
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await card.locator('summary').click();
  await time.fill('0.0833');
  await time.press('Enter');
  await page.clock.setSystemTime(new Date('2026-11-30T10:00:00'));
  await page.getByRole('link', { name: 'Workout', exact: true }).click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Start interval' }).click();
  await expect(page.getByRole('article', { name: 'Interval timer' }).getByRole('region', { name: 'Previous' })).toContainText('5s');
});

test('loads direct routes and exposes semantic primary navigation', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveURL(/\/workout$/);
  await expect(page.getByText('Local-first', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Weekly Template', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Saved on this device|Independent backup needed/)).toHaveCount(0);

  await page.goto('/ExerciseTracker/plan');
  await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Workout days' })).toBeVisible();

  await page.reload();
  await expect(page).toHaveTitle(/Plan \| ExerciseTracker/);
  await expect(page.getByRole('heading', { name: 'Plan' })).toBeFocused();

  for (const label of ['Workout', 'Plan', 'Progress', 'Settings']) {
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
  await expect(page.locator('.app-interaction')).toHaveAttribute('aria-busy', 'false');
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
  await expect(page.locator('.app-interaction')).toHaveAttribute('aria-busy', 'false');
  await page.goto('/ExerciseTracker/workout/day_test');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Complete set' }).click();

  await expect(page.getByRole('heading', { name: 'Second Move' })).toBeVisible();
  await expect(page.getByText('Rest period')).toHaveCount(0);
});

test('used band colours can be reordered and archived without rewriting records', async ({ page }) => {
  await importWorkout(page, 'Band settings test', [
    { id: 'exercise_band', name: 'Band Row', mode: 'band_reps', target: { reps: 10, bandColourIds: ['band_red'] } },
  ]);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeFocused();
  const blueHandle = page.getByRole('button', { name: /Reorder Blue/ });
  await expect(blueHandle).toBeEnabled();
  await blueHandle.focus();
  await expect(blueHandle).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.band-row strong')).toHaveText(['Red', 'Blue', 'Green']);
  await blueHandle.focus();
  await expect(blueHandle).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.band-row strong')).toHaveText(['Blue', 'Red', 'Green']);
  await expect(page.locator('.app-interaction')).toHaveAttribute('aria-busy', 'false');

  await page.reload();
  await expect(page.locator('.band-row strong')).toHaveText(['Blue', 'Red', 'Green']);

  acceptNextDialog(page);
  await page.getByRole('button', { name: 'Archive Red' }).click();
  await expect(page.getByText('Red archived. Existing records were preserved.')).toBeVisible();
  await expect(page.locator('.band-row strong')).toHaveText(['Blue', 'Green']);

  await page.getByRole('link', { name: 'Plan' }).click();
  const bandCard = page.locator('details.plan-exercise-card').filter({ hasText: 'Band Row' });
  await bandCard.locator('summary').click();
  expect(await bandCard.locator('.band-picker button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual([
    'Blue band',
    'Red band',
    'Green band',
  ]);

  await page.goto('/ExerciseTracker/workout/day_test');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByRole('heading', { name: 'Band Row', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Target', exact: true })).toContainText('Red');
  await expect(page.getByRole('group', { name: 'Performed bands' })).toHaveCount(0);
  await page.locator('.next-target-panel summary').click();
  const nextBands = page.locator('.band-fieldset').getByRole('button');
  await expect(nextBands).toHaveCount(3);
  expect(await nextBands.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))))
    .toEqual(['Blue for Next target bands', 'Red for Next target bands', 'Green for Next target bands']);
});

test('workout preview does not start a session and active entries survive reload', async ({ page }) => {
  await importWorkout(page, 'Strength test', [
    { id: 'exercise_weight', name: 'Test Squat', mode: 'weighted_reps', target: { weightKg: 60, reps: 5 } },
  ]);

  await expect(page.getByText('Today', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
  await expect(page.getByText('Current set')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Today', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByText('Current set')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Performed weight' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Target', exact: true })).toContainText('60 kg');
  await page.getByRole('spinbutton', { name: 'Performed reps' }).fill('8');
  await expect(page.getByRole('spinbutton', { name: 'Performed reps' })).toHaveValue('8');
  await expect(page.locator('.app-interaction')).toHaveAttribute('aria-busy', 'false');

  await page.reload();
  await expect(page.getByRole('region', { name: 'Target', exact: true })).toContainText('60 kg');
  await expect(page.getByRole('spinbutton', { name: 'Performed reps' })).toHaveValue('8');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume workout' })).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-11-24T10:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await expect(page.getByRole('heading', { name: 'Test Squat' })).toBeVisible();
  acceptNextDialog(page);
  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Performed reps' })).toHaveValue('5');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await page.getByRole('link', { name: 'Workout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
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

test('fixed bands and over-target reps stay separate from shared next targets', async ({ page }) => {
  await importWorkout(page, 'Band test', [
    { id: 'exercise_band', name: 'Band Row', mode: 'band_reps', target: { reps: 10, bandColourIds: ['band_red'] }, setCount: 2 },
  ], { hideRestTimes: true });
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.locator('.next-target-panel')).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Performed reps' }).fill('12');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByText('Set 2 of 2', { exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Performed reps' }).fill('18');

  await page.getByText('Next time', { exact: false }).click();
  await page.getByRole('button', { name: 'Blue for Next target bands' }).click();
  await page.getByRole('button', { name: 'Red for Next target bands' }).click();
  await page.getByRole('spinbutton', { name: 'Next target reps' }).fill('20');

  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByText('Review before saving')).toBeVisible();
  await expect(page.locator('.summary-set-row').getByText('Red x 18', { exact: true })).toBeVisible();
  await expect(page.getByText(/Next time: Blue.*20 reps/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save workout' })).toBeEnabled();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Save workout' })).toBeVisible();
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('heading', { name: 'Exercise history' })).toBeVisible();
  await expect(page.locator('.history-row').getByText('Red x 12 | Red x 18', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Workout', exact: true }).click();
  await expect(page.getByText('Blue - 2x20', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Plan' }).click();
  const bandCard = page.locator('details.plan-exercise-card').filter({ hasText: 'Band Row' });
  await bandCard.locator('summary').click();
  const selectedBand = bandCard.getByRole('button', { name: 'Blue band' });
  await expect(selectedBand).toHaveAttribute('aria-pressed', 'true');
  await expect(selectedBand).toHaveCSS('box-shadow', /6px/);
  await expect(bandCard.getByLabel('Repetitions')).toHaveValue('20');
});

test('completion review can undo a finished set before saving', async ({ page }) => {
  await importWorkout(page, 'Review test', [
    { id: 'exercise_hold', name: 'Long Hold', mode: 'timed_hold', target: { seconds: 30 } },
  ]);
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('spinbutton', { name: 'Performed seconds' }).fill('45');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('heading', { name: 'Monday complete' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo Long Hold set 1' }).click();
  await expect(page.getByRole('heading', { name: 'Long Hold' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Performed seconds' })).toHaveValue('45');
});

test('saved workouts lock the local day after reload and release automatically at midnight', async ({ page }) => {
  await importWorkout(page, 'Daily workout', [
    { id: 'hold', name: 'Daily Hold', mode: 'timed_hold', target: { seconds: 30 } },
  ], { runningClock: true });
  await page.clock.setSystemTime(new Date('2026-11-23T23:59:55'));
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Complete set' }).click();
  const save = page.getByRole('button', { name: 'Save workout' });
  await expect(save).toBeEnabled();
  await page.goto('/ExerciseTracker/workout');
  await expect(page.getByText('Workout Completed!', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await save.click();
  await expect(page).toHaveURL(/\/progress$/);
  await page.goto('/ExerciseTracker/workout/active');
  await expect(page.getByText('Workout Completed!', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Workout Completed!', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout' })).toHaveCount(0);
  await page.clock.runFor(6000);
  await expect(page.getByText('Workout Completed!', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Tuesday' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
});

test('final-set changes are independent and Previous can find an older matching set', async ({ page }) => {
  await importWorkout(page, 'Shared targets', [
    { id: 'squat', name: 'Shared Squat', mode: 'weighted_reps', target: { weightKg: 60, reps: 5 }, setCount: 2 },
  ], { hideRestTimes: true });
  const workout = page.getByRole('link', { name: 'Workout', exact: true });
  const start = page.getByRole('button', { name: 'Start workout' });
  const complete = page.getByRole('button', { name: 'Complete set' });
  const save = page.getByRole('button', { name: 'Save workout' });
  const previous = page.getByRole('region', { name: 'Previous', exact: true });
  const performed = page.getByRole('spinbutton', { name: 'Performed reps' });
  await start.click();
  await expect(previous).toHaveCount(0);
  await expect(page.locator('.next-target-panel')).toHaveCount(0);
  await performed.fill('4');
  await complete.click();
  await expect(page.getByText('Set 2 of 2', { exact: true })).toBeVisible();
  await performed.fill('7');
  await page.locator('.next-target-panel summary').click();
  await page.getByRole('spinbutton', { name: 'Next target weight' }).fill('65');
  await page.getByRole('spinbutton', { name: 'Next target reps' }).fill('4');
  await expect(page.getByText(/Weight can only increase/)).toBeVisible();
  await complete.click();
  const last = page.locator('.summary-set-row').last();
  await expect(last).toContainText('Next time: 4 reps');
  await expect(last).toContainText(/Weight can only increase/);
  await save.click();
  await expect(page).toHaveURL(/\/progress$/);
  await workout.click();
  await expect(page.getByText('60 KG - 2x4', { exact: true })).toBeVisible();
  await expect(page.getByText('Workout Completed!', { exact: true })).toBeVisible();

  async function changeWeight(kg: string, nextDate: string) {
    await page.getByRole('link', { name: 'Plan', exact: true }).click();
    const card = page.locator('.plan-exercise-card').filter({ hasText: 'Shared Squat' });
    await card.locator('summary').click();
    await card.getByLabel('KG', { exact: true }).fill(kg);
    await page.clock.setFixedTime(new Date(nextDate));
    await workout.click();
    await start.click();
  }

  await changeWeight('65', '2026-11-30T10:00:00');
  await expect(page.getByRole('region', { name: 'Target', exact: true })).toContainText('65 kg');
  await expect(previous).toHaveCount(0);
  await complete.click();
  await expect(page.getByText('Set 2 of 2', { exact: true })).toBeVisible();
  await complete.click();
  await save.click();
  await expect(page).toHaveURL(/\/progress$/);

  await changeWeight('60', '2026-12-07T10:00:00');
  await expect(previous).toContainText('4 reps');
  await complete.click();
  await expect(previous).toContainText('7 reps');
  await complete.click();
  await save.click();
  await expect(page).toHaveURL(/\/progress$/);
  await workout.click();
  await expect(page.getByText('Workout Completed!', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  acceptNextDialog(page);
  await page.getByRole('button', { name: /^Delete Monday session/ }).first().click();
  await workout.click();
  await expect(start).toBeVisible();
});

test('empty planned days cannot create dead-end workouts', async ({ page }) => {
  await importWorkout(page, 'Empty test', []);

  await expect(page.getByText('Add an exercise to start today’s workout.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Edit plan' }).click();
  await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
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
  await expect(firstCard.getByRole('group', { name: /Metric for/ }).getByRole('button')).toHaveText(['Weight', 'Bands', 'Time', 'Interval', 'Other']);
  await expect(firstCard.getByLabel('KG').first()).toBeVisible();
  await expect(firstCard.getByLabel('Repetitions').first()).toBeVisible();
  await expect(page.getByLabel('Day name')).toHaveCount(0);
  const sets = firstCard.getByRole('spinbutton', { name: 'Sets', exact: true });
  await sets.fill('2');
  await sets.press('Enter');
  await expect(firstCard.locator('summary')).toContainText('2 sets');
  await expect(firstCard.getByLabel('KG')).toHaveCount(1);
  await sets.fill('0');
  await sets.press('Enter');
  await expect(sets).toHaveAttribute('aria-invalid', 'true');
  await expect(firstCard.locator('summary')).toContainText('2 sets');
  acceptNextDialog(page);
  await firstCard.locator('.card-heading').getByRole('button', { name: /^Remove / }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(firstCard.getByText('Left/right reps')).toHaveCount(0);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();
});

test('long plans scroll within Today and leave the start button visible with large text', async ({ page }) => {
  await importWorkout(page, 'Long plan', Array.from({ length: 30 }, (_, index) => ({
    id: 'long-exercise-' + index, name: 'Exercise with a long name ' + (index + 1), mode: 'timed_hold', target: { seconds: 30 },
  })));
  await page.setViewportSize({ width: 350, height: 610 });
  await page.addStyleTag({ content: 'html { font-size: 150%; }' });
  const list = page.getByRole('list', { name: 'Planned exercises' });
  const start = page.getByRole('button', { name: 'Start workout' });
  await expect(page.getByRole('heading', { name: 'Monday' })).toBeFocused();
  await expect(start).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Tab');
  await expect(list).toBeFocused();
  await list.getByText('Exercise with a long name 30').scrollIntoViewIfNeeded();
  await expect(list.getByText('Exercise with a long name 30')).toBeInViewport();
  await expect(start).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > innerWidth,
    vertical: document.documentElement.scrollHeight > innerHeight,
  }))).toEqual({ horizontal: false, vertical: false });
});

test('exercise rest overrides use the completed set across exercises and take effect without reload', async ({ page }) => {
  await importWorkout(page, 'Custom rest', ['First Move', 'Second Move', 'Third Move'].map((name, index) => ({
    id: 'rest-exercise-' + index, name, mode: 'timed_hold', target: { seconds: 30 },
  })));
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  for (const [name, minutes] of [['First Move', '0'], ['Second Move', '1.5']]) {
    const card = page.locator('.plan-exercise-card').filter({ hasText: name });
    await card.locator('summary').click();
    await card.getByLabel('Rest Time (minutes)').fill(minutes);
  }
  await page.getByRole('link', { name: 'Workout', exact: true }).click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('heading', { name: 'Second Move' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('timer')).toHaveText('1:30');
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('button', { name: 'Save workout' })).toBeVisible();
});

test('records numeric and text modifiers, stages changes and saves notes immediately', async ({ page }) => {
  await importWorkout(page, 'Other workout', [
    { id: 'custom_exercise', name: 'Custom Move', mode: 'timed_hold', target: { seconds: 30 }, setCount: 2 },
  ], { hideRestTimes: true });
  const workout = page.getByRole('link', { name: 'Workout', exact: true });
  const plan = page.getByRole('link', { name: 'Plan', exact: true });
  const card = page.locator('.plan-exercise-card').filter({ hasText: 'Custom Move' });
  await plan.click();
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Other', exact: true }).click();
  await card.getByRole('button', { name: 'Add modifier' }).click();
  await card.getByRole('button', { name: 'Add modifier' }).click();
  await expect(card.getByRole('button', { name: 'Add modifier' })).toHaveCount(0);
  await card.getByLabel('Modifier 1 label').fill('Balance');
  await card.getByLabel('Modifier 2 type').selectOption('text');
  await card.getByLabel('Modifier 2 label').fill('Grip');
  await card.getByLabel('Target Balance').fill('2');
  await card.getByLabel('Target Grip').fill('Wide');
  await card.getByLabel('Notes', { exact: true }).fill('Keep shoulders down.\nUse a mat.');
  await card.getByRole('button', { name: 'Save notes' }).click();
  await workout.click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Keep shoulders down.\nUse a mat.');
  await page.getByLabel('Notes', { exact: true }).fill('Use a mat.\nPause at the top.');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.locator('.app-interaction')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Pause' }).click();
  await plan.click();
  await card.locator('summary').click();
  await expect(card.getByLabel('Notes', { exact: true })).toHaveValue('Use a mat.\nPause at the top.');
  await workout.click();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await page.getByLabel('Performed Balance').fill('-1.5');
  await page.getByLabel('Performed Grip').fill('Neutral');
  await expect(page.locator('.next-target-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('region', { name: 'Target', exact: true })).toContainText('Target GripWide');
  await page.getByLabel('Performed Grip').fill('Narrow');
  await page.locator('.next-target-panel summary').click();
  await page.getByRole('button', { name: 'Clear Balance target' }).click();
  await page.getByLabel('Next target Grip').fill('Close');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.locator('.summary-set-row').first()).toContainText('Balance: -1.5 · Grip: Neutral');
  await expect(page.locator('.summary-set-row').last()).toContainText('Balance: Clear target');
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('heading', { name: 'Session history' })).toBeVisible();
  await expect(page.locator('.metric-tile')).toContainText(['Completed sessions1', 'Completed sets2']);
  await page.getByText('View recorded sets').click();
  await expect(page.locator('.recorded-notes')).toHaveText('Use a mat. Pause at the top.');
  await plan.click();
  await card.locator('summary').click();
  await expect(card.getByLabel('Target Balance')).toHaveValue('');
  await expect(card.getByLabel('Target Grip')).toHaveValue('Close');
  await card.getByRole('button', { name: 'Remove modifier Balance' }).click();
  await card.getByRole('button', { name: 'Remove modifier Grip' }).click();
  const setCount = card.getByRole('spinbutton', { name: 'Sets', exact: true });
  await setCount.fill('1');
  await setCount.press('Enter');
  await page.clock.setFixedTime(new Date('2026-11-30T10:00:00'));
  await workout.click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('button', { name: 'Save workout' })).toBeVisible();
});

test('shows planned ranges and records single performed reps and seconds', async ({ page }) => {
  await importWorkout(page, 'Target ranges', [
    { id: 'range_weighted', name: 'Range Squat', mode: 'weighted_reps', target: { weightKg: 45, reps: 5 } },
    { id: 'range_timed', name: 'Range Hold', mode: 'timed_hold', target: { seconds: 40 }, setCount: 2 },
    { id: 'range_band', name: 'Range Row', mode: 'band_reps', target: { bandColourIds: ['band_red'], reps: 10 } },
  ]);
  await expect(page.getByText('45 KG - 1x5', { exact: true })).toBeVisible();
  await expect(page.getByText('2x40s', { exact: true })).toBeVisible();
  await expect(page.getByText('Red - 1x10', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  const weighted = page.locator('.plan-exercise-card').filter({ hasText: 'Range Squat' });
  const timed = page.locator('.plan-exercise-card').filter({ hasText: 'Range Hold' });
  const banded = page.locator('.plan-exercise-card').filter({ hasText: 'Range Row' });
  await weighted.locator('summary').click();
  const reps = weighted.getByLabel('Repetitions', { exact: true });
  await reps.fill('3-5');
  await reps.press('Enter');
  await reps.fill('5-3');
  await reps.press('Tab');
  await expect(reps).toHaveAttribute('aria-invalid', 'true');
  await timed.locator('summary').click();
  await timed.getByLabel('Seconds', { exact: true }).fill('20-60s');
  await banded.locator('summary').click();
  await banded.getByLabel('Repetitions', { exact: true }).fill('7-10');

  await page.getByRole('link', { name: 'Workout', exact: true }).click();
  await expect(page.getByText('45 KG - 1x3-5', { exact: true })).toBeVisible();
  await expect(page.getByText('2x20-60s', { exact: true })).toBeVisible();
  await expect(page.getByText('Red - 1x7-10', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByRole('region', { name: 'Target', exact: true })).toContainText('3-5');
  await expect(page.getByRole('spinbutton', { name: 'Performed reps' })).toHaveValue('3');
  await page.getByRole('spinbutton', { name: 'Performed reps' }).fill('4');
  await page.locator('.next-target-panel summary').click();
  await page.getByRole('spinbutton', { name: 'Next target reps' }).fill('3');

  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByText('20-60 seconds', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await expect(page.getByRole('region', { name: 'Target', exact: true })).toContainText('20-60s');
  await expect(page.getByRole('spinbutton', { name: 'Performed seconds' })).toHaveValue('20');
  await page.getByRole('spinbutton', { name: 'Performed seconds' }).fill('23');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await expect(page.getByRole('region', { name: 'Target', exact: true })).toContainText('20-60s');
  await expect(page.getByRole('spinbutton', { name: 'Performed seconds' })).toHaveValue('20');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Performed reps' })).toHaveValue('7');
  await page.getByRole('spinbutton', { name: 'Performed reps' }).fill('8');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await page.getByText('View recorded sets').click();
  const recorded = page.locator('.recorded-session');
  await expect(recorded).toContainText('45 kg x 4');
  await expect(recorded).toContainText('23s');
  await expect(recorded).toContainText('Red x 8');

  await page.getByRole('link', { name: 'Workout', exact: true }).click();
  await expect(page.getByText('45 KG - 1x3', { exact: true })).toBeVisible();
  await expect(page.getByText('2x20-60s', { exact: true })).toBeVisible();
  await expect(page.getByText('Red - 1x7-10', { exact: true })).toBeVisible();
});

test('keeps the folder across reloads and retries rotation after permission loss', async ({ page, context }) => {
  // Use a real Chromium directory handle backed by a disposable test origin.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: () => navigator.storage.getDirectory() });
    Object.defineProperty(FileSystemDirectoryHandle.prototype, 'queryPermission', {
      configurable: true,
      value: async () => localStorage.getItem('test-folder-denied') ? 'denied' : 'granted',
    });
  });
  await importWorkout(page, 'Backup test', [
    { id: 'backup_exercise', name: 'Backup Move', mode: 'timed_hold', target: { seconds: 30 } },
  ]);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Choose backup folder' }).click();
  await expect(page.getByText(/Folder connected/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reconnect backup folder' })).toBeVisible();
  const copies = () => page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    const revisions = [];
    for await (const [, handle] of (directory as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemFileHandle]>;
    }).entries()) {
      if (handle.kind !== 'file' || !handle.name.startsWith('exercise-tracker-workout-')) continue;
      const raw = await (await handle.getFile()).text();
      if (!raw) continue;
      const envelope = JSON.parse(raw);
      revisions.push(envelope.data.sessions.length as number);
    }
    return revisions.sort((left, right) => left - right);
  });
  expect(await copies()).toEqual([]);
  async function saveWorkout(week: number) {
    await page.clock.setFixedTime(new Date(2026, 10, 23 + week * 7, 10));
    await page.getByRole('link', { name: 'Workout', exact: true }).click();
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.getByRole('button', { name: 'Complete set' }).click();
    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page).toHaveURL(/\/progress$/);
  }
  for (let count = 1; count <= 3; count++) {
    await saveWorkout(count - 1);
    await expect.poll(copies).toEqual(count === 1 ? [1] : [count - 1, count]);
  }
  await expect(page.getByText(/Saved on this device|Independent backup needed/)).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Last verified file: revision/)).toBeVisible();
  await page.getByRole('checkbox', { name: /Hide rest times/ }).check();
  await expect(page.locator('.app-interaction')).toHaveAttribute('aria-busy', 'false');
  const secondTab = await context.newPage();
  await secondTab.clock.setFixedTime(new Date(2026, 11, 7, 10));
  await secondTab.goto('/ExerciseTracker/workout');
  await expect(secondTab.getByText('Workout Completed!', { exact: true })).toBeVisible();
  expect(await copies()).toEqual([2, 3]);
  await secondTab.close();

  await page.evaluate(() => localStorage.setItem('test-folder-denied', 'true'));
  await saveWorkout(3);
  const accessWarning = page.getByText('Workout backup pending. Reconnect the backup folder in Settings.');
  await expect(accessWarning).toBeVisible();
  expect(await copies()).toEqual([2, 3]);
  await page.evaluate(() => localStorage.removeItem('test-folder-denied'));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reconnect backup folder' }).click();
  await expect.poll(copies).toEqual([3, 4]);
  await expect(accessWarning).toHaveCount(0);
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
