import { preview } from 'vite';

const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4174;

export default async function startPreviewServer() {
  const server = await preview({
    logLevel: 'warn',
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
