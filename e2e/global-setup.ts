import { preview } from 'vite';

const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4174;

export default async function startPreviewServer() {
  const server = await preview({
    logLevel: 'warn',
    plugins: [{ name: 'previous-release-test-worker', configurePreviewServer(previewServer) {
      previewServer.middlewares.use((request, response, next) => {
        if (request.url !== '/ExerciseTracker/previous-worker.js') return next();
        response.setHeader('Content-Type', 'application/javascript');
        response.end("self.addEventListener('install',e=>e.waitUntil(caches.open('exercise-tracker-previous-release').then(c=>c.put('/old-release',new Response('old shell'))).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));");
      });
    } }],
    preview: {
      host: PREVIEW_HOST,
      port: PREVIEW_PORT,
      strictPort: true,
    },
  });

  return async () => {
    await server.close();
  };
}
