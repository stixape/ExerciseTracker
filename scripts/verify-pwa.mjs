import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';

const host = '127.0.0.1';
const port = 4175;
const appUrl = `http://${host}:${port}/ExerciseTracker/`;
const manifestUrl = new URL('manifest.webmanifest', appUrl).href;
const previewEntry = resolve('node_modules', 'vite', 'bin', 'vite.js');
const index = readFileSync(resolve('dist', 'index.html'), 'utf8');
const fallback = readFileSync(resolve('dist', '404.html'), 'utf8');
const serviceWorker = readFileSync(resolve('dist', 'service-worker.js'), 'utf8');
const output = [];

if (index !== fallback) {
  throw new Error('dist/404.html is not an exact copy of the built index.html.');
}

if (serviceWorker.includes('__EXERCISE_TRACKER_')) {
  throw new Error('dist/service-worker.js was not finalized by the Pages build.');
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

const distDirectory = resolve('dist');
const expectedPrecacheUrls = listFiles(distDirectory)
  .map((path) => relative(distDirectory, path).split(sep).join('/'))
  .filter((path) => path !== '404.html' && path !== 'service-worker.js')
  .map((path) => new URL(path, appUrl).href);

const preview = spawn(process.execPath, [previewEntry, 'preview', '--host', host, '--port', String(port), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let previewError;
preview.on('error', (error) => {
  previewError = error;
  output.push(`${error.stack ?? error.message}\n`);
});
preview.stdout.on('data', (chunk) => output.push(chunk.toString()));
preview.stderr.on('data', (chunk) => output.push(chunk.toString()));

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (previewError) throw new Error(`Preview could not start.\n${output.join('')}`);
    if (preview.exitCode !== null) throw new Error(`Preview exited early.\n${output.join('')}`);
    try {
      const response = await fetch(appUrl);
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for preview.\n${output.join('')}`);
}

let browser;
try {
  await waitForPreview();
  const launchOptions = process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {};
  browser = await chromium.launch({ ...launchOptions, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserDiagnostics = [];
  page.on('console', (message) => browserDiagnostics.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => browserDiagnostics.push(`pageerror: ${error.stack ?? error.message}`));
  page.on('requestfailed', (request) => {
    browserDiagnostics.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
  });

  await page.goto(manifestUrl);
  await page.evaluate(async () => {
    const unrelatedCache = await globalThis.caches.open('unrelated-app-cache');
    await unrelatedCache.put('/unrelated-cache-sentinel', new Response('keep'));
    const staleAppCache = await globalThis.caches.open('exercise-tracker-stale-regression');
    await staleAppCache.put('/stale-exercise-tracker-cache', new Response('remove'));
  });

  await page.goto(appUrl, { waitUntil: 'load' });
  await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolvePromise, reject) => {
      const timeout = globalThis.setTimeout(() => reject(new Error('Service worker did not claim the page.')), 10_000);
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          globalThis.clearTimeout(timeout);
          resolvePromise(undefined);
        },
        { once: true },
      );
    });
  });

  const cacheState = await page.evaluate(async () => {
    const cacheNames = await globalThis.caches.keys();
    const appCacheName = cacheNames.find((name) => name.startsWith('exercise-tracker-'));
    if (!appCacheName) return { cacheNames, cachedUrls: [] };
    const appCache = await globalThis.caches.open(appCacheName);
    return { cacheNames, cachedUrls: (await appCache.keys()).map((request) => request.url) };
  });

  const missingFiles = expectedPrecacheUrls.filter((url) => !cacheState.cachedUrls.includes(url));
  if (missingFiles.length) throw new Error(`Service worker did not precache: ${missingFiles.join(', ')}`);
  if (!cacheState.cacheNames.includes('unrelated-app-cache')) throw new Error('Activation deleted an unrelated origin cache.');
  if (cacheState.cacheNames.includes('exercise-tracker-stale-regression')) {
    throw new Error('Activation did not delete a stale ExerciseTracker cache.');
  }

  const browserSession = await context.newCDPSession(page);
  await browserSession.send('Network.enable');
  await browserSession.send('Network.setCacheDisabled', { cacheDisabled: true });
  await context.setOffline(true);

  const offlineAssetProbe = await page.evaluate(async (assetUrl) => {
    const cached = Boolean(await globalThis.caches.match(assetUrl));
    try {
      const response = await fetch(assetUrl);
      return {
        cached,
        controlled: Boolean(navigator.serviceWorker.controller),
        fetchOk: response.ok,
        fetchStatus: response.status,
      };
    } catch (error) {
      return {
        cached,
        controlled: Boolean(navigator.serviceWorker.controller),
        fetchError: error instanceof Error ? error.message : String(error),
      };
    }
  }, expectedPrecacheUrls.find((url) => url.includes('/assets/')));
  if (!offlineAssetProbe.cached || !offlineAssetProbe.fetchOk) {
    throw new Error(`The active worker could not serve a precached asset offline: ${JSON.stringify(offlineAssetProbe)}`);
  }

  const offlineNavigation = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  await page.evaluate(() => {
    globalThis.setTimeout(() => globalThis.location.reload(), 0);
  });
  await offlineNavigation;
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible', timeout: 10_000 });
  } catch (error) {
    const pageText = await page.locator('body').innerText().catch(() => '<unavailable>');
    throw new Error(
      `The built app did not render after its first offline reload. Body: ${JSON.stringify(pageText)}\n${browserDiagnostics.join('\n')}`,
      { cause: error },
    );
  }

  console.log(`PWA offline verification passed with ${cacheState.cachedUrls.length} cached URLs.`);
  await context.close();
} finally {
  await browser?.close();
  if (preview.exitCode === null) {
    const exited = new Promise((resolvePromise) => preview.once('exit', resolvePromise));
    preview.kill();
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
  }
}
