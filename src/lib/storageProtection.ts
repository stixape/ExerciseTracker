export type PersistenceState = 'unknown' | 'granted' | 'not_granted' | 'unavailable';
export async function readPersistence(): Promise<PersistenceState> {
  if (!navigator.storage?.persisted) return 'unavailable';
  try { return await navigator.storage.persisted() ? 'granted' : 'not_granted'; } catch { return 'unavailable'; }
}
export async function requestPersistence(): Promise<PersistenceState> {
  if (!navigator.storage?.persist) return 'unavailable';
  try { return await navigator.storage.persist() ? 'granted' : 'not_granted'; } catch { return 'unavailable'; }
}
