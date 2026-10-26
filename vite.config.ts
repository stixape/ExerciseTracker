import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const key = env.VITE_BACKUP_SUPABASE_PUBLISHABLE_KEY;
  if (key && !key.startsWith('sb_publishable_')) throw new Error('Use a Supabase publishable key, never a secret or service-role key.');
  let backupOrigin = '';
  if (key) {
    const app = new URL(env.VITE_BACKUP_APP_ORIGIN);
    const api = new URL(env.VITE_BACKUP_SUPABASE_URL);
    if (app.hostname.endsWith('.github.io') || api.protocol !== 'https:') throw new Error('Remote backups require a dedicated app origin and HTTPS API.');
    backupOrigin = api.origin;
  }
  return {
  base: '/ExerciseTracker/',
  plugins: [react(), { name: 'private-backup-csp', transformIndexHtml(html) {
    return backupOrigin ? html.replace("connect-src 'self'", "connect-src 'self' " + backupOrigin) : html;
  } }],
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    setupFiles: './src/test/setup.ts',
    css: true,
  },
  };
});
