// Synthetic, process-local IndexedDB only. Never opens a user's browser profile.
import 'fake-indexeddb/auto';
import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
const server = await createServer({ cacheDir: '.npm-cache/benchmark-vite', server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { createDefaultAppData } = await server.ssrLoadModule('/src/domain/sampleData.ts');
  const { createSessionFromDay } = await server.ssrLoadModule('/src/domain/session.ts');
  const { commitAppData, offlineDb } = await server.ssrLoadModule('/src/lib/offlineDb.ts');
  for (const count of [500, 1500]) {
    await offlineDb.delete(); await offlineDb.open();
    const data = createDefaultAppData('synthetic-benchmark');
    data.sessions = Array.from({ length: count }, () => {
      const session = createSessionFromDay(data.template.days[0]);
      const completedAt = new Date(Date.parse(session.startedAt) + 60_000).toISOString();
      return { ...session, completedAt, sets: session.sets.map((set) => ({ ...set, completedAt })) };
    });
    const start = performance.now();
    await commitAppData(data, null);
    const first = performance.now();
    await commitAppData({ ...data, settings: { hideRestTimes: true } }, 1, 'workout');
    console.log(JSON.stringify({ sessions: count, jsonMiB: +(JSON.stringify(data).length / 1048576).toFixed(2), initialCommitMs: +(first - start).toFixed(1), checkpointCommitMs: +(performance.now() - first).toFixed(1) }));
  }
  offlineDb.close();
} finally { await server.close(); }
