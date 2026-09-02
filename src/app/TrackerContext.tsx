import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dumbbell } from 'lucide-react';
import { createDefaultAppData } from '../domain/sampleData';
import type { AppData } from '../domain/types';
import { loadAppData, saveAppData } from '../lib/offlineDb';

export const LOCAL_USER_ID = 'local-user';

interface TrackerContextValue {
  data: AppData;
  saveData: (updater: (current: AppData) => AppData) => void;
  replaceData: (data: AppData) => Promise<boolean>;
}

const TrackerContext = createContext<TrackerContextValue | null>(null);

// The provider and its hook intentionally form one public context API.
// eslint-disable-next-line react-refresh/only-export-components
export function useTracker(): TrackerContextValue {
  const value = useContext(TrackerContext);
  if (!value) throw new Error('useTracker must be used inside TrackerContext');
  return value;
}

export function TrackerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>();
  const [storageError, setStorageError] = useState<string>();
  const dataRef = useRef<AppData | undefined>(undefined);
  const writeTailRef = useRef<Promise<void>>(Promise.resolve());
  const storageBlockedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadAppData(LOCAL_USER_ID)
      .then((loadedData) => {
        if (cancelled) return;
        dataRef.current = loadedData;
        setData(loadedData);
      })
      .catch(() => {
        if (cancelled) return;
        storageBlockedRef.current = true;
        const fallback = createDefaultAppData(LOCAL_USER_ID);
        dataRef.current = fallback;
        setData(fallback);
        setStorageError(
          'Your saved data could not be loaded. ExerciseTracker is using a temporary starter plan. Changes will remain temporary until you reset data or import a valid backup.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveData = useCallback(
    (updater: (current: AppData) => AppData) => {
      const current = dataRef.current;
      if (!current) return;
      const next = updater(current);
      dataRef.current = next;
      setData(next);
      if (storageBlockedRef.current) return;
      const snapshot = structuredClone(next);
      writeTailRef.current = writeTailRef.current
        .catch(() => undefined)
        .then(() => saveAppData(snapshot))
        .then(() => setStorageError(undefined))
        .catch(() => {
          setStorageError('Changes are visible, but could not be saved on this device. Keep this page open and try another edit.');
        });
    },
    [],
  );

  const replaceData = useCallback(async (replacement: AppData): Promise<boolean> => {
    const snapshot = structuredClone(replacement);
    const operation = writeTailRef.current.catch(() => undefined).then(() => saveAppData(snapshot));
    writeTailRef.current = operation;
    try {
      await operation;
      storageBlockedRef.current = false;
      dataRef.current = snapshot;
      setData(snapshot);
      setStorageError(undefined);
      return true;
    } catch {
      setStorageError('Recovery could not replace the saved data. The existing device record was left untouched.');
      return false;
    }
  }, []);

  if (!data) {
    return (
      <main className="loading-screen" aria-busy="true">
        <div>
          <span className="brand-mark" aria-hidden="true">
            <Dumbbell size={24} />
          </span>
          <h1>Loading ExerciseTracker</h1>
          <p>Your private workout data is opening on this device.</p>
        </div>
      </main>
    );
  }

  const contextValue: TrackerContextValue = { data, saveData, replaceData };

  return (
    <TrackerContext.Provider value={contextValue}>
      {storageError && (
        <div className="storage-error-banner" role="alert">
          {storageError}
        </div>
      )}
      {children}
    </TrackerContext.Provider>
  );
}
