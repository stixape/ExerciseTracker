/** Portable recovery format. Versions 1–7 remain importable. */
export const APP_DATA_EXPORT_VERSION = 8;

export function isChecksummedBackupVersion(version: number): boolean {
  return version >= 5 && version <= APP_DATA_EXPORT_VERSION;
}
