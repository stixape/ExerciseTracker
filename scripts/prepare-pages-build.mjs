import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const distDirectory = resolve('dist');
const indexPath = resolve(distDirectory, 'index.html');
const fallbackPath = resolve(distDirectory, '404.html');
const serviceWorkerTemplatePath = resolve('public', 'service-worker.js');
const generatedServiceWorkerPath = resolve(distDirectory, 'service-worker.js');

for (const requiredPath of [indexPath, serviceWorkerTemplatePath]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Cannot prepare the Pages build because ${requiredPath} does not exist.`);
  }
}

copyFileSync(indexPath, fallbackPath);

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

const excludedFiles = new Set(['404.html', 'service-worker.js']);
const precachePaths = listFiles(distDirectory)
  .filter((path) => statSync(path).isFile())
  .map((path) => relative(distDirectory, path).split(sep).join('/'))
  .filter((path) => !excludedFiles.has(path))
  .sort();

if (!precachePaths.includes('index.html') || !precachePaths.some((path) => path.startsWith('assets/'))) {
  throw new Error('The Pages build is missing index.html or its generated Vite assets.');
}

const serviceWorkerTemplate = readFileSync(serviceWorkerTemplatePath, 'utf8');
for (const placeholder of [
  '__EXERCISE_TRACKER_BUILD_ID__',
  '/* __EXERCISE_TRACKER_PRECACHE_PATHS__ */ []',
]) {
  if (!serviceWorkerTemplate.includes(placeholder)) {
    throw new Error(`The service-worker template is missing ${placeholder}.`);
  }
}

const buildHash = createHash('sha256').update(serviceWorkerTemplate);
for (const path of precachePaths) {
  buildHash.update('\0').update(path).update('\0').update(readFileSync(resolve(distDirectory, path)));
}
const buildId = buildHash.digest('hex').slice(0, 16);

const generatedServiceWorker = serviceWorkerTemplate
  .replace('__EXERCISE_TRACKER_BUILD_ID__', buildId)
  .replace('/* __EXERCISE_TRACKER_PRECACHE_PATHS__ */ []', JSON.stringify(precachePaths, null, 2));

if (generatedServiceWorker.includes('__EXERCISE_TRACKER_')) {
  throw new Error('The service-worker template still contains an unreplaced build placeholder.');
}

writeFileSync(generatedServiceWorkerPath, generatedServiceWorker, 'utf8');
console.log(`Prepared Pages build ${buildId} with ${precachePaths.length} precached files.`);
