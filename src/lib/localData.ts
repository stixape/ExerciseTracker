import { APP_DATA_EXPORT_VERSION } from '../domain/dataVersion';
import { createDefaultAppData, createDefaultDayForWeekday } from '../domain/sampleData';
import type {
  ActiveWorkout,
  AppData,
  PlannedSetProgression,
  SessionSet,
  SetValues,
  TemplateDay,
  TemplateExercise,
  WorkoutSession,
} from '../domain/types';
import { isValidIsoDateTime, validateAppData } from './appDataSchema';

const STORAGE_PREFIX = 'exercise-tracker:data:';
const storageKey = (userId: string) => `${STORAGE_PREFIX}${userId}`;

export type JsonImportResult = { ok: true; data: AppData } | { ok: false; error: string };

type JsonDataMigration = (data: unknown) => unknown;

/** Each function migrates its key version to the next version without mutating input. */
const JSON_DATA_MIGRATIONS: Readonly<Record<number, JsonDataMigration>> = {
  1: (data) => structuredClone(data),
  2: (data) => structuredClone(data),
};

type LegacySetValues = SetValues & { leftReps?: number; rightReps?: number };
type LegacyProgression = PlannedSetProgression & { leftReps?: number; rightReps?: number };
type LegacyTemplateExercise = TemplateExercise & { tracksSides?: boolean };
type LegacySessionSet = SessionSet & { tracksSides?: boolean };

function normalizedReps(values: LegacySetValues | LegacyProgression, preferSideMinimum = false): number | undefined {
  if (!preferSideMinimum && values.reps !== undefined) return values.reps;
  const sideValues = [values.leftReps ?? values.reps, values.rightReps ?? values.reps].filter(
    (value): value is number => value !== undefined,
  );
  return sideValues.length ? Math.min(...sideValues) : undefined;
}

function normalizeSetValues(values: SetValues, preferSideMinimum = false): SetValues {
  const legacy = values as LegacySetValues;
  const normalized = { ...legacy };
  const reps = normalizedReps(legacy, preferSideMinimum);
  delete normalized.leftReps;
  delete normalized.rightReps;
  if (reps !== undefined) normalized.reps = reps;
  if (normalized.bandColourIds) normalized.bandColourIds = [...normalized.bandColourIds];
  return normalized;
}

function normalizeProgression(values: PlannedSetProgression): PlannedSetProgression {
  const legacy = values as LegacyProgression;
  const normalized = { ...legacy };
  const reps = normalizedReps(legacy);
  delete normalized.leftReps;
  delete normalized.rightReps;
  if (reps !== undefined) normalized.reps = reps;
  if (normalized.bandColourIds) normalized.bandColourIds = [...normalized.bandColourIds];
  return normalized;
}

function normalizeTemplateExercise(exercise: TemplateExercise): TemplateExercise {
  const normalized = { ...exercise } as LegacyTemplateExercise;
  delete normalized.tracksSides;
  return {
    ...normalized,
    sets: normalized.sets.map((set) => ({ ...set, target: normalizeSetValues(set.target) })),
  };
}

function normalizeTemplateDay(day: TemplateDay): TemplateDay {
  return { ...day, exercises: day.exercises.map(normalizeTemplateExercise) };
}

function normalizeSessionSet(set: SessionSet): SessionSet {
  const normalized = { ...set } as LegacySessionSet;
  delete normalized.tracksSides;
  return {
    ...normalized,
    target: normalizeSetValues(set.target),
    actual: normalizeSetValues(set.actual, true),
    ...(set.proposedNextTarget ? { proposedNextTarget: normalizeProgression(set.proposedNextTarget) } : {}),
  };
}

function normalizeSession(session: WorkoutSession): WorkoutSession {
  return {
    ...session,
    snapshot: normalizeTemplateDay(session.snapshot),
    sets: session.sets.map(normalizeSessionSet),
  };
}

function normalizeActiveWorkout(activeWorkout: ActiveWorkout): ActiveWorkout {
  return { ...activeWorkout, session: normalizeSession(activeWorkout.session) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function migrateJsonData(data: unknown, sourceVersion: number): { ok: true; data: unknown } | { ok: false; error: string } {
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > APP_DATA_EXPORT_VERSION) {
    return {
      ok: false,
      error: `Import file uses unsupported version ${String(sourceVersion)}. Supported versions are 1-${APP_DATA_EXPORT_VERSION}.`,
    };
  }

  let version = sourceVersion;
  let migrated = data;
  while (version < APP_DATA_EXPORT_VERSION) {
    const migration = JSON_DATA_MIGRATIONS[version];
    if (!migration) return { ok: false, error: `Import migration from version ${version} is unavailable.` };
    try {
      migrated = migration(migrated);
    } catch {
      return { ok: false, error: `Import migration from version ${version} failed.` };
    }
    version += 1;
  }
  return { ok: true, data: migrated };
}

export function normalizeLocalData(data: Partial<AppData>, userId: string): AppData {
  const defaultData = createDefaultAppData(userId);
  const baseDays = (data.template?.days ?? defaultData.template.days).map(normalizeTemplateDay);
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
            ...((exercise.mode === 'weighted_reps' || exercise.mode === 'band_reps') && set.target.reps === undefined
              ? { reps: exerciseIndex === 0 ? 5 : 10 }
              : {}),
          },
        })),
      })),
    }))
    .sort((a, b) => a.weekday - b.weekday);

  return {
    ...data,
    userId,
    bandColours: data.bandColours ?? defaultData.bandColours,
    sessions: (data.sessions ?? []).map(normalizeSession),
    ...(data.activeWorkout ? { activeWorkout: normalizeActiveWorkout(data.activeWorkout) } : {}),
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

export function restoreAppData(
  value: unknown,
  userId: string,
  allowLegacyTargetDefaults = true,
  allowLegacySideFields = true,
): JsonImportResult {
  const initialValidation = validateAppData(value, {
    allowMissingTargetReps: allowLegacyTargetDefaults,
    allowLegacySideFields,
  });
  if (!initialValidation.ok) return { ok: false, error: initialValidation.error };

  const normalized = normalizeLocalData(initialValidation.data, userId);
  const finalValidation = validateAppData(normalized);
  return finalValidation.ok ? { ok: true, data: finalValidation.data } : { ok: false, error: finalValidation.error };
}

export function readLegacyLocalData(userId: string): AppData | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return undefined;

  try {
    const restored = restoreAppData(JSON.parse(raw), userId);
    return restored.ok ? restored.data : undefined;
  } catch {
    return undefined;
  }
}

export function hasLegacyLocalData(userId: string): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(storageKey(userId)) !== null;
}

export function parseJsonImport(raw: string, userId: string): JsonImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Import file is not valid JSON.' };
  }

  if (!isObject(parsed)) return { ok: false, error: 'Import file must contain an ExerciseTracker export object.' };
  if (!Number.isSafeInteger(parsed.version)) return { ok: false, error: 'Import file must contain a whole-number version.' };
  if (!('data' in parsed)) return { ok: false, error: 'Import file does not contain ExerciseTracker data.' };
  if (parsed.exportedAt !== undefined) {
    if (!isValidIsoDateTime(parsed.exportedAt)) {
      return { ok: false, error: 'Import file has an invalid exportedAt date.' };
    }
  }

  const sourceVersion = parsed.version as number;
  const migration = migrateJsonData(parsed.data, sourceVersion);
  if (!migration.ok) return migration;

  const restored = restoreAppData(migration.data, userId, sourceVersion === 1, sourceVersion < 3);
  return restored.ok ? restored : { ok: false, error: `Import data is invalid: ${restored.error}` };
}

export function clearLegacyLocalData(userId: string): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey(userId));
}
