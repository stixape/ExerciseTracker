import type {
  ActiveWorkout,
  AppData,
  BandColour,
  MetricMode,
  PlannedSetProgression,
  RestEvent,
  SessionSet,
  TemplateDay,
  TemplateExercise,
  TemplateSet,
  WorkoutSession,
} from '../domain/types';

type RecordValue = Record<string, unknown>;

export interface AppDataValidationOptions {
  /** Version-1 data may omit a rep target; normalization supplies the legacy default. */
  allowMissingTargetReps?: boolean;
}

export type AppDataValidationResult = { ok: true; data: AppData } | { ok: false; error: string };

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const METRIC_MODES = new Set<MetricMode>(['weighted_reps', 'timed_hold', 'band_reps']);
const MAX_SESSIONS = 100_000;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringError(value: unknown, path: string, label: string, maxLength = 500): string | undefined {
  if (typeof value !== 'string') return `${path} must be a string.`;
  if (!value.trim()) return `${path} must contain ${label}.`;
  if (value.length > maxLength) return `${path} is too long.`;
  if ([...value].some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)) {
    return `${path} contains unsupported control characters.`;
  }
  return undefined;
}

function idError(value: unknown, path: string): string | undefined {
  const error = stringError(value, path, 'an ID', 256);
  if (error) return error;
  if ((value as string) !== (value as string).trim()) return `${path} must not start or end with whitespace.`;
  return undefined;
}

function finiteNumberError(
  value: unknown,
  path: string,
  options: { integer?: boolean; minimum?: number; maximum?: number } = {},
): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a finite number.`;
  if (options.integer && !Number.isInteger(value)) return `${path} must be a whole number.`;
  if (options.minimum !== undefined && value < options.minimum) return `${path} must be ${options.minimum} or higher.`;
  if (options.maximum !== undefined && value > options.maximum) return `${path} must be ${options.maximum} or lower.`;
  return undefined;
}

function isoDateError(value: unknown, path: string): string | undefined {
  if (typeof value !== 'string') return `${path} must be an ISO date-time string.`;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return `${path} must be a valid ISO date-time string.`;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    return `${path} must be a valid ISO date-time string.`;
  }
  return undefined;
}

export function isValidIsoDateTime(value: unknown): value is string {
  return isoDateError(value, 'date') === undefined;
}

function optionalBooleanError(value: unknown, path: string): string | undefined {
  return value === undefined || typeof value === 'boolean' ? undefined : `${path} must be true or false.`;
}

function arrayError(value: unknown, path: string, maximum = 10_000): string | undefined {
  if (!Array.isArray(value)) return `${path} must be an array.`;
  if (value.length > maximum) return `${path} contains too many items.`;
  return undefined;
}

function duplicateError(values: string[], path: string, label: string): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return `${path} contains a duplicate ${label} "${value}".`;
    seen.add(value);
  }
  return undefined;
}

function validateBandIds(value: unknown, path: string, knownBandIds: ReadonlySet<string>, requireOne: boolean): string | undefined {
  const error = arrayError(value, path, 100);
  if (error) return error;
  const ids = value as unknown[];
  if (requireOne && ids.length === 0) return `${path} must contain at least one band ID.`;

  for (let index = 0; index < ids.length; index += 1) {
    const itemError = idError(ids[index], `${path}[${index}]`);
    if (itemError) return itemError;
    if (!knownBandIds.has(ids[index] as string)) return `${path}[${index}] references an unknown band ID "${ids[index]}".`;
  }
  return duplicateError(ids as string[], path, 'band ID');
}

function validateSetValues(
  value: unknown,
  path: string,
  mode: MetricMode,
  knownBandIds: ReadonlySet<string>,
  options: { target: boolean; allowMissingTargetReps: boolean },
): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;

  for (const key of ['weightKg', 'reps', 'leftReps', 'rightReps', 'seconds'] as const) {
    if (value[key] === undefined) continue;
    const numberError = finiteNumberError(value[key], `${path}.${key}`, {
      integer: key !== 'weightKg',
      minimum: 0,
    });
    if (numberError) return numberError;
  }

  if (value.bandColourIds !== undefined) {
    const bandError = validateBandIds(value.bandColourIds, `${path}.bandColourIds`, knownBandIds, mode === 'band_reps');
    if (bandError) return bandError;
  }

  if (mode === 'weighted_reps') {
    if (value.seconds !== undefined || (Array.isArray(value.bandColourIds) && value.bandColourIds.length > 0)) {
      return `${path} contains values that are not valid for a weighted exercise.`;
    }
    if (value.weightKg === undefined) return `${path}.weightKg is required for a weighted exercise.`;
    if (value.reps === undefined && !(options.target && options.allowMissingTargetReps)) {
      return `${path}.reps is required for a weighted exercise.`;
    }
  } else if (mode === 'timed_hold') {
    if (
      value.weightKg !== undefined ||
      value.reps !== undefined ||
      value.leftReps !== undefined ||
      value.rightReps !== undefined ||
      (Array.isArray(value.bandColourIds) && value.bandColourIds.length > 0)
    ) {
      return `${path} contains values that are not valid for a timed exercise.`;
    }
    if (value.seconds === undefined) return `${path}.seconds is required for a timed exercise.`;
  } else {
    if (value.weightKg !== undefined || value.seconds !== undefined) {
      return `${path} contains values that are not valid for a band exercise.`;
    }
    if (value.reps === undefined && !(options.target && options.allowMissingTargetReps)) {
      return `${path}.reps is required for a band exercise.`;
    }
    if (value.bandColourIds === undefined) return `${path}.bandColourIds is required for a band exercise.`;
  }

  return undefined;
}

function validateProgression(
  value: unknown,
  path: string,
  mode: MetricMode,
  knownBandIds: ReadonlySet<string>,
): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const progression = value as PlannedSetProgression;
  const progressionKeys = new Set(['weightKg', 'reps', 'leftReps', 'rightReps', 'seconds', 'bandColourIds']);
  const unsupportedKey = Object.keys(value).find((key) => !progressionKeys.has(key));
  if (unsupportedKey) return `${path}.${unsupportedKey} is not a supported proposed target.`;

  for (const key of ['weightKg', 'reps', 'leftReps', 'rightReps', 'seconds'] as const) {
    if (progression[key] === undefined) continue;
    const error = finiteNumberError(progression[key], `${path}.${key}`, { integer: key !== 'weightKg', minimum: 0 });
    if (error) return error;
  }
  if (progression.bandColourIds !== undefined) {
    const error = validateBandIds(progression.bandColourIds, `${path}.bandColourIds`, knownBandIds, true);
    if (error) return error;
  }
  if (mode === 'weighted_reps' && (progression.bandColourIds !== undefined || progression.seconds !== undefined)) {
    return `${path} contains values that are not valid for a weighted exercise.`;
  }
  if (mode === 'band_reps' && (progression.weightKg !== undefined || progression.seconds !== undefined)) {
    return `${path} contains values that are not valid for a band exercise.`;
  }
  if (
    mode === 'timed_hold' &&
    (progression.weightKg !== undefined ||
      progression.reps !== undefined ||
      progression.leftReps !== undefined ||
      progression.rightReps !== undefined ||
      progression.bandColourIds !== undefined)
  ) {
    return `${path} contains values that are not valid for a timed exercise.`;
  }
  const knownProgressionKeys: Array<keyof PlannedSetProgression> = [
    'weightKg',
    'reps',
    'leftReps',
    'rightReps',
    'seconds',
    'bandColourIds',
  ];
  if (knownProgressionKeys.every((key) => progression[key] === undefined)) {
    return `${path} must contain at least one proposed target.`;
  }
  return undefined;
}

function validateTemplateSet(
  value: unknown,
  path: string,
  mode: MetricMode,
  knownBandIds: ReadonlySet<string>,
  options: AppDataValidationOptions,
): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  return (
    idError(value.id, `${path}.id`) ??
    finiteNumberError(value.setNumber, `${path}.setNumber`, { integer: true, minimum: 1 }) ??
    validateSetValues(value.target, `${path}.target`, mode, knownBandIds, {
      target: true,
      allowMissingTargetReps: Boolean(options.allowMissingTargetReps),
    })
  );
}

function validateTemplateExercise(
  value: unknown,
  path: string,
  knownBandIds: ReadonlySet<string>,
  options: AppDataValidationOptions,
): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const baseError =
    idError(value.id, `${path}.id`) ??
    stringError(value.name, `${path}.name`, 'an exercise name') ??
    (!METRIC_MODES.has(value.mode as MetricMode) ? `${path}.mode is not a supported exercise mode.` : undefined) ??
    optionalBooleanError(value.tracksSides, `${path}.tracksSides`) ??
    arrayError(value.sets, `${path}.sets`, 100);
  if (baseError) return baseError;
  if (value.mode === 'timed_hold' && value.tracksSides === true) return `${path}.tracksSides cannot be true for a timed exercise.`;

  const sets = value.sets as unknown[];
  if (!sets.length) return `${path}.sets must contain at least one set.`;
  for (let index = 0; index < sets.length; index += 1) {
    const error = validateTemplateSet(sets[index], `${path}.sets[${index}]`, value.mode as MetricMode, knownBandIds, options);
    if (error) return error;
  }
  const typedSets = sets as TemplateSet[];
  return duplicateError(
    typedSets.map((set) => set.id),
    `${path}.sets`,
    'set ID',
  ) ?? duplicateError(
    typedSets.map((set) => String(set.setNumber)),
    `${path}.sets`,
    'set number',
  );
}

function validateTemplateDay(
  value: unknown,
  path: string,
  knownBandIds: ReadonlySet<string>,
  options: AppDataValidationOptions,
): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const baseError =
    idError(value.id, `${path}.id`) ??
    finiteNumberError(value.weekday, `${path}.weekday`, { integer: true, minimum: 1, maximum: 7 }) ??
    stringError(value.label, `${path}.label`, 'a day label') ??
    arrayError(value.exercises, `${path}.exercises`, 500);
  if (baseError) return baseError;

  const exercises = value.exercises as unknown[];
  for (let index = 0; index < exercises.length; index += 1) {
    const error = validateTemplateExercise(exercises[index], `${path}.exercises[${index}]`, knownBandIds, options);
    if (error) return error;
  }
  return duplicateError(
    (exercises as TemplateExercise[]).map((exercise) => exercise.id),
    `${path}.exercises`,
    'exercise ID',
  );
}

function validateTemplate(
  value: unknown,
  path: string,
  knownBandIds: ReadonlySet<string>,
  options: AppDataValidationOptions,
): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const baseError =
    idError(value.id, `${path}.id`) ??
    stringError(value.name, `${path}.name`, 'a template name') ??
    arrayError(value.days, `${path}.days`, 7);
  if (baseError) return baseError;

  const days = value.days as unknown[];
  for (let index = 0; index < days.length; index += 1) {
    const error = validateTemplateDay(days[index], `${path}.days[${index}]`, knownBandIds, options);
    if (error) return error;
  }
  const typedDays = days as TemplateDay[];
  const dayError = duplicateError(
    typedDays.map((day) => day.id),
    `${path}.days`,
    'day ID',
  ) ?? duplicateError(
    typedDays.map((day) => String(day.weekday)),
    `${path}.days`,
    'weekday',
  );
  if (dayError) return dayError;

  const exercises = typedDays.flatMap((day) => day.exercises);
  return duplicateError(
    exercises.map((exercise) => exercise.id),
    `${path}.days`,
    'exercise ID',
  ) ?? duplicateError(
    exercises.flatMap((exercise) => exercise.sets.map((set) => set.id)),
    `${path}.days`,
    'template set ID',
  );
}

function validateSessionSet(
  value: unknown,
  path: string,
  knownBandIds: ReadonlySet<string>,
  sessionStartedAt: string,
): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const baseError =
    idError(value.id, `${path}.id`) ??
    idError(value.templateSetId, `${path}.templateSetId`) ??
    idError(value.exerciseId, `${path}.exerciseId`) ??
    stringError(value.exerciseName, `${path}.exerciseName`, 'an exercise name') ??
    finiteNumberError(value.exerciseIndex, `${path}.exerciseIndex`, { integer: true, minimum: 0 }) ??
    finiteNumberError(value.setNumber, `${path}.setNumber`, { integer: true, minimum: 1 }) ??
    (!METRIC_MODES.has(value.mode as MetricMode) ? `${path}.mode is not a supported exercise mode.` : undefined) ??
    optionalBooleanError(value.tracksSides, `${path}.tracksSides`);
  if (baseError) return baseError;
  if (value.mode === 'timed_hold' && value.tracksSides === true) return `${path}.tracksSides cannot be true for a timed exercise.`;

  const targetError = validateSetValues(value.target, `${path}.target`, value.mode as MetricMode, knownBandIds, {
    target: true,
    allowMissingTargetReps: false,
  });
  if (targetError) return targetError;
  const actualError = validateSetValues(value.actual, `${path}.actual`, value.mode as MetricMode, knownBandIds, {
    target: false,
    allowMissingTargetReps: false,
  });
  if (actualError) return actualError;

  if (value.proposedNextTarget !== undefined) {
    const progressionError = validateProgression(value.proposedNextTarget, `${path}.proposedNextTarget`, value.mode as MetricMode, knownBandIds);
    if (progressionError) return progressionError;
  }
  if (value.completedAt !== undefined) {
    const dateError = isoDateError(value.completedAt, `${path}.completedAt`);
    if (dateError) return dateError;
    if (Date.parse(value.completedAt as string) < Date.parse(sessionStartedAt)) return `${path}.completedAt cannot be before the session started.`;
  }
  return undefined;
}

function validateRestEvent(value: unknown, path: string, setIds: ReadonlySet<string>, sessionStartedAt: string): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const baseError =
    idError(value.id, `${path}.id`) ??
    idError(value.afterSessionSetId, `${path}.afterSessionSetId`) ??
    finiteNumberError(value.exerciseIndex, `${path}.exerciseIndex`, { integer: true, minimum: 0 }) ??
    finiteNumberError(value.setNumber, `${path}.setNumber`, { integer: true, minimum: 1 }) ??
    finiteNumberError(value.durationSeconds, `${path}.durationSeconds`, { integer: true, minimum: 0 }) ??
    isoDateError(value.startedAt, `${path}.startedAt`) ??
    optionalBooleanError(value.skipped, `${path}.skipped`);
  if (baseError) return baseError;
  if (typeof value.skipped !== 'boolean') return `${path}.skipped must be true or false.`;
  if (!setIds.has(value.afterSessionSetId as string)) return `${path}.afterSessionSetId references a set outside this session.`;
  if (Date.parse(value.startedAt as string) < Date.parse(sessionStartedAt)) return `${path}.startedAt cannot be before the session started.`;
  if (value.endedAt !== undefined) {
    const endedError = isoDateError(value.endedAt, `${path}.endedAt`);
    if (endedError) return endedError;
    if (Date.parse(value.endedAt as string) < Date.parse(value.startedAt as string)) return `${path}.endedAt cannot be before the rest started.`;
  }
  return undefined;
}

function validateSession(
  value: unknown,
  path: string,
  knownBandIds: ReadonlySet<string>,
  requireCompleted: boolean,
): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const baseError =
    idError(value.id, `${path}.id`) ??
    idError(value.templateDayId, `${path}.templateDayId`) ??
    stringError(value.label, `${path}.label`, 'a session label') ??
    isoDateError(value.startedAt, `${path}.startedAt`) ??
    arrayError(value.sets, `${path}.sets`, 10_000) ??
    arrayError(value.restEvents, `${path}.restEvents`, 10_000) ??
    validateTemplateDay(value.snapshot, `${path}.snapshot`, knownBandIds, {});
  if (baseError) return baseError;

  if (value.completedAt !== undefined) {
    const completedError = isoDateError(value.completedAt, `${path}.completedAt`);
    if (completedError) return completedError;
    if (Date.parse(value.completedAt as string) < Date.parse(value.startedAt as string)) return `${path}.completedAt cannot be before the session started.`;
  } else if (requireCompleted) {
    return `${path}.completedAt is required for a saved session.`;
  }

  const snapshot = value.snapshot as TemplateDay;
  if (snapshot.id !== value.templateDayId) return `${path}.templateDayId must match snapshot.id.`;
  if (snapshot.label !== value.label) return `${path}.label must match snapshot.label.`;

  const sets = value.sets as unknown[];
  for (let index = 0; index < sets.length; index += 1) {
    const error = validateSessionSet(sets[index], `${path}.sets[${index}]`, knownBandIds, value.startedAt as string);
    if (error) return error;
  }
  const typedSets = sets as SessionSet[];
  const setIdError = duplicateError(
    typedSets.map((set) => set.id),
    `${path}.sets`,
    'session set ID',
  );
  if (setIdError) return setIdError;
  if (value.completedAt !== undefined && typedSets.some((set) => !set.completedAt)) return `${path} is completed but contains an incomplete set.`;
  if (
    value.completedAt !== undefined &&
    typedSets.some((set) => set.completedAt && Date.parse(set.completedAt) > Date.parse(value.completedAt as string))
  ) {
    return `${path} contains a set completed after the session completed.`;
  }

  for (let index = 0; index < typedSets.length; index += 1) {
    const set = typedSets[index];
    const snapshotExercise = snapshot.exercises.find((exercise) => exercise.id === set.exerciseId);
    if (!snapshotExercise) return `${path}.sets[${index}].exerciseId is not present in the session snapshot.`;
    if (snapshot.exercises.indexOf(snapshotExercise) !== set.exerciseIndex) return `${path}.sets[${index}].exerciseIndex does not match the session snapshot.`;
    if (snapshotExercise.mode !== set.mode) return `${path}.sets[${index}].mode does not match the session snapshot.`;
    if (snapshotExercise.name !== set.exerciseName) return `${path}.sets[${index}].exerciseName does not match the session snapshot.`;
    const snapshotSet = snapshotExercise.sets.find((item) => item.id === set.templateSetId);
    if (!snapshotSet) return `${path}.sets[${index}].templateSetId is not present in the session snapshot.`;
    if (snapshotSet.setNumber !== set.setNumber) return `${path}.sets[${index}].setNumber does not match the session snapshot.`;
  }

  const setIds = new Set(typedSets.map((set) => set.id));
  const rests = value.restEvents as unknown[];
  for (let index = 0; index < rests.length; index += 1) {
    const error = validateRestEvent(rests[index], `${path}.restEvents[${index}]`, setIds, value.startedAt as string);
    if (error) return error;
  }
  const typedRests = rests as RestEvent[];
  return duplicateError(
    typedRests.map((rest) => rest.id),
    `${path}.restEvents`,
    'rest event ID',
  ) ?? duplicateError(
    typedRests.map((rest) => rest.afterSessionSetId),
    `${path}.restEvents`,
    'rest event set reference',
  );
}

function validateActiveRest(value: unknown, path: string, session: WorkoutSession): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const setIds = new Set(session.sets.map((set) => set.id));
  const baseError =
    idError(value.afterSessionSetId, `${path}.afterSessionSetId`) ??
    finiteNumberError(value.durationSeconds, `${path}.durationSeconds`, { integer: true, minimum: 0 }) ??
    isoDateError(value.startedAt, `${path}.startedAt`) ??
    isoDateError(value.endsAt, `${path}.endsAt`) ??
    optionalBooleanError(value.completed, `${path}.completed`);
  if (baseError) return baseError;
  if (typeof value.completed !== 'boolean') return `${path}.completed must be true or false.`;
  if (!setIds.has(value.afterSessionSetId as string)) return `${path}.afterSessionSetId references a set outside this session.`;
  if (value.nextSetId !== undefined) {
    const nextIdError = idError(value.nextSetId, `${path}.nextSetId`);
    if (nextIdError) return nextIdError;
    if (!setIds.has(value.nextSetId as string)) return `${path}.nextSetId references a set outside this session.`;
  }
  if (Date.parse(value.endsAt as string) < Date.parse(value.startedAt as string)) return `${path}.endsAt cannot be before the rest started.`;
  return undefined;
}

function validateActiveWorkout(value: unknown, path: string, knownBandIds: ReadonlySet<string>): string | undefined {
  if (!isRecord(value)) return `${path} must be an object.`;
  const sessionError = validateSession(value.session, `${path}.session`, knownBandIds, false);
  if (sessionError) return sessionError;
  const session = value.session as WorkoutSession;

  if (value.activeRest !== undefined) {
    const restError = validateActiveRest(value.activeRest, `${path}.activeRest`, session);
    if (restError) return restError;
  }
  if (value.selectedExerciseId !== undefined) {
    const selectedError = idError(value.selectedExerciseId, `${path}.selectedExerciseId`);
    if (selectedError) return selectedError;
    if (!session.sets.some((set) => set.exerciseId === value.selectedExerciseId)) return `${path}.selectedExerciseId is not present in the active session.`;
  }
  if (value.selectedSetId !== undefined) {
    const selectedError = idError(value.selectedSetId, `${path}.selectedSetId`);
    if (selectedError) return selectedError;
    const selectedSet = session.sets.find((set) => set.id === value.selectedSetId);
    if (!selectedSet) return `${path}.selectedSetId is not present in the active session.`;
    if (value.selectedExerciseId !== undefined && selectedSet.exerciseId !== value.selectedExerciseId) {
      return `${path}.selectedSetId does not belong to selectedExerciseId.`;
    }
  }
  return undefined;
}

function validateBandColours(value: unknown, path: string): { error?: string; bands?: BandColour[] } {
  const error = arrayError(value, path, 100);
  if (error) return { error };

  const bands = value as unknown[];
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (!isRecord(band)) return { error: `${path}[${index}] must be an object.` };
    const bandError = idError(band.id, `${path}[${index}].id`) ?? stringError(band.name, `${path}[${index}].name`, 'a band name');
    if (bandError) return { error: bandError };
    if (typeof band.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(band.hex)) return { error: `${path}[${index}].hex must be a six-digit hex colour.` };
  }
  const typedBands = bands as BandColour[];
  return {
    error:
      duplicateError(
        typedBands.map((band) => band.id),
        path,
        'band ID',
      ) ?? duplicateError(
        typedBands.map((band) => band.name.trim().toLocaleLowerCase()),
        path,
        'band name',
      ),
    bands: typedBands,
  };
}

export function validateAppData(value: unknown, options: AppDataValidationOptions = {}): AppDataValidationResult {
  if (!isRecord(value)) return { ok: false, error: 'data must be an object.' };
  const userError = idError(value.userId, 'data.userId');
  if (userError) return { ok: false, error: userError };

  const bandResult = validateBandColours(value.bandColours, 'data.bandColours');
  if (bandResult.error) return { ok: false, error: bandResult.error };
  const knownBandIds = new Set((bandResult.bands ?? []).map((band) => band.id));

  const templateError = validateTemplate(value.template, 'data.template', knownBandIds, options);
  if (templateError) return { ok: false, error: templateError };

  const sessionsError = arrayError(value.sessions, 'data.sessions', MAX_SESSIONS);
  if (sessionsError) return { ok: false, error: sessionsError };
  const sessions = value.sessions as unknown[];
  for (let index = 0; index < sessions.length; index += 1) {
    const sessionError = validateSession(sessions[index], `data.sessions[${index}]`, knownBandIds, true);
    if (sessionError) return { ok: false, error: sessionError };
  }
  const typedSessions = sessions as WorkoutSession[];
  const duplicateSessionError = duplicateError(
    typedSessions.map((session) => session.id),
    'data.sessions',
    'session ID',
  );
  if (duplicateSessionError) return { ok: false, error: duplicateSessionError };

  if (value.activeWorkout !== undefined) {
    const activeError = validateActiveWorkout(value.activeWorkout, 'data.activeWorkout', knownBandIds);
    if (activeError) return { ok: false, error: activeError };
    const activeWorkout = value.activeWorkout as ActiveWorkout;
    if (typedSessions.some((session) => session.id === activeWorkout.session.id)) {
      return { ok: false, error: 'data.activeWorkout.session.id duplicates a saved session ID.' };
    }
  }

  if (!isRecord(value.settings)) return { ok: false, error: 'data.settings must be an object.' };
  if (value.settings.theme !== 'light' && value.settings.theme !== 'dark') {
    return { ok: false, error: 'data.settings.theme must be "light" or "dark".' };
  }

  return { ok: true, data: value as unknown as AppData };
}

export function validateActiveWorkoutData(value: unknown, bandColours: BandColour[]): value is ActiveWorkout {
  const bandIds = new Set(bandColours.map((band) => band.id));
  return validateActiveWorkout(value, 'activeWorkout', bandIds) === undefined;
}
