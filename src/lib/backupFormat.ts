import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { AppData } from '../domain/types';
import { APP_DATA_EXPORT_VERSION } from '../domain/dataVersion';

export interface BackupIdentity {
  snapshotId: string;
  revision: number;
  savedAt: string;
}

// Sort JSON keys so IndexedDB and portable JSON round trips have the same hash.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return item;
  });
}

export function checksum(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(value))));
}

export function backupChecksum(data: AppData, identity: BackupIdentity, version = APP_DATA_EXPORT_VERSION): string {
  return checksum({ version, data, backup: identity });
}
