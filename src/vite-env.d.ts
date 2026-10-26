/// <reference types="vite/client" />

declare module '*.css';

interface ImportMetaEnv {
  readonly VITE_BACKUP_APP_ORIGIN?: string;
  readonly VITE_BACKUP_SUPABASE_URL?: string;
  readonly VITE_BACKUP_SUPABASE_PUBLISHABLE_KEY?: string;
}
