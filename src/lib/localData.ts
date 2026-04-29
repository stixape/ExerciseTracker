import type { AppData } from '../domain/types';
import { createDefaultAppData, createDefaultDayForWeekday } from '../domain/sampleData';

const storageKey = (userId: string) => `exercise-tracker:data:${userId}`;
const JSON_EXPORT_VERSION = 1;

export type JsonImportResult = { ok: true; data: AppData } | { ok: false; error: string };

export function loadLocalData(userId: string): AppData {
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return createDefaultAppData(userId);

  try {
    const data = JSON.parse(raw) as AppData;
    return normalizeLocalData(data, userId);
  } catch {
    return createDefaultAppData(userId);
  }
}

export function normalizeLocalData(data: Partial<AppData>, userId: string): AppData {
  const defaultData = createDefaultAppData(userId);
  const baseDays = data.template?.days ?? defaultData.template.days;
  const existingWeekdays = new Set(baseDays.map((day) => day.weekday));
  const missingDays = defaultData.template.days.filter((day) => !existingWeekdays.has(day.weekday));
  const days = [...baseDays, ...missingDays.map((day) => createDefaultDayForWeekday(day.weekday) ?? day)]
    .map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise, exerciseIndex) => ({
        ...exercise,
        sets: exercise.sets.map((set, setIndex) => ({
          ...set,
          setNumber: setIndex + 1,
          target: {
            ...set.target,
            reps:
              exercise.mode === 'weighted_reps' || exercise.mode === 'band_reps'
                ? exerciseIndex === 0
                  ? 5
                  : 10
                : set.target.reps,
          },
        })),
      })),
    }))
    .sort((a, b) => a.weekday - b.weekday);

  return {
    ...data,
    userId,
    bandColours: data.bandColours?.length ? data.bandColours : defaultData.bandColours,
    sessions: data.sessions ?? [],
    settings: {
      ...defaultData.settings,
      ...data.settings,
    },
    template: {
      ...defaultData.template,
      ...(data.template ?? {}),
      days,
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseJsonImport(raw: string, userId: string): JsonImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Import file is not valid JSON.' };
  }

  if (!isObject(parsed) || parsed.version !== JSON_EXPORT_VERSION) {
    return { ok: false, error: 'Import file must be an ExerciseTracker JSON export version 1.' };
  }

  if (!isObject(parsed.data)) {
    return { ok: false, error: 'Import file does not contain ExerciseTracker data.' };
  }

  try {
    return { ok: true, data: normalizeLocalData(parsed.data as Partial<AppData>, userId) };
  } catch {
    return { ok: false, error: 'Import file could not be restored.' };
  }
}

export function saveLocalData(data: AppData): void {
  localStorage.setItem(storageKey(data.userId), JSON.stringify(data));
}

export function resetLocalData(userId: string): AppData {
  const data = createDefaultAppData(userId);
  saveLocalData(data);
  return data;
}

export function clearLocalData(userId: string): void {
  localStorage.removeItem(storageKey(userId));
}
