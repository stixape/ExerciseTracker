import { sameBandSelection } from './bands';
import { changeModifierValue, formatModifierValues, modifierValue } from './modifiers';
import { replaceExerciseTarget } from './plan';
import { formatTargetRange, rangeMetric } from './targetRange';
import { formatDuration } from './rest';
import type { BandColour, Modifier, PlannedSetProgression, SessionSet, TemplateExercise, WorkoutSession, WorkoutTemplate } from './types';
import { validatePlannedSetProgression } from './validation';

export type { PlannedSetProgression } from './types';

export function getCurrentSessionSet(session: WorkoutSession): SessionSet | undefined {
  return session.sets.find((set) => !set.completedAt);
}

export function getWheelValues(max: number): number[] {
  return Array.from({ length: max + 1 }, (_, index) => index);
}

export function getRepWheelMax(set: SessionSet, fallback = 50): number {
  return Math.max(0, Math.floor(fallback), Math.floor(set.target.reps ?? 0));
}

export function getFinalExerciseSets(session: WorkoutSession): Map<string, SessionSet> {
  const finalSets = new Map<string, SessionSet>();
  for (const set of session.sets) {
    if (set.setNumber > (finalSets.get(set.exerciseId)?.setNumber ?? 0)) finalSets.set(set.exerciseId, set);
  }
  return finalSets;
}

export function stageSetProgression(
  set: SessionSet,
  progression: PlannedSetProgression | undefined,
  knownBandColourIds: Iterable<string>,
): SessionSet {
  const changes = Object.fromEntries(Object.entries(progression ?? {}).filter(([, value]) => value !== undefined));
  if (progression?.modifiers && !Object.keys(progression.modifiers).length) delete changes.modifiers;
  if (!Object.keys(changes).length) return { ...set, proposedNextTarget: undefined };
  const errors = validatePlannedSetProgression(set.mode, changes, knownBandColourIds);
  if (errors.length) throw new RangeError(errors.join(' '));
  return { ...set, proposedNextTarget: structuredClone(changes) };
}

function bandStrength(ids: string[] | undefined, palette: BandColour[]): number {
  return palette.reduce((strength, band, index) => strength + (ids?.includes(band.id) ? index + 1 : 0), 0);
}

function metRecordedTarget(set: SessionSet, fields: Modifier[] | undefined, bands: BandColour[]): boolean {
  const { actual, target } = set;
  if (set.mode === 'timed_hold' || set.mode === 'interval') return (actual.seconds ?? 0) >= (target.seconds ?? 0);
  if (set.mode === 'other') {
    return (fields ?? []).every((field) => {
      const goal = modifierValue(target.modifiers, field.id);
      const result = modifierValue(actual.modifiers, field.id);
      return goal === undefined || (typeof goal === 'number' ? typeof result === 'number' && result >= goal : result === goal);
    });
  }
  if ((actual.reps ?? 0) < (target.reps ?? 0)) return false;
  return set.mode === 'weighted_reps'
    ? (actual.weightKg ?? 0) >= (target.weightKg ?? 0)
    : bandStrength(actual.bandColourIds, bands) >= bandStrength(target.bandColourIds, bands);
}

const progressionLabels = { weightKg: 'Weight', reps: 'Repetitions', seconds: 'Seconds' } as const;

export function reviewExerciseProgression(
  exercise: TemplateExercise | undefined,
  session: WorkoutSession,
  finalSet: SessionSet,
  bands: BandColour[],
): { accepted: PlannedSetProgression; blocked: string[] } {
  const accepted: PlannedSetProgression = {};
  const blocked: string[] = [];
  const proposal = finalSet.proposedNextTarget;
  const shared = exercise?.sets[0];
  if (!exercise || exercise.mode !== finalSet.mode || !shared || !proposal) return { accepted, blocked };
  const recordedFields = session.snapshot.exercises[finalSet.exerciseIndex]?.modifiers;
  let targetsMet: boolean | undefined;
  function canApply(label: string, increases: boolean) {
    if (!increases) return true;
    targetsMet ??= session.sets.every((set) => set.exerciseId !== finalSet.exerciseId ||
      ((set.id === finalSet.id || Boolean(set.completedAt)) && metRecordedTarget(set, recordedFields, bands)));
    if (!targetsMet) blocked.push(label);
    return targetsMet;
  }

  for (const key of ['weightKg', 'reps', 'seconds'] as const) {
    const value = proposal[key];
    const current = shared.target[key];
    const replacesRange = rangeMetric(exercise.mode) === key && shared.rangeMax !== undefined;
    const label = exercise.mode === 'interval' ? 'Work Time' : progressionLabels[key];
    if (value !== undefined && (value !== current || replacesRange) && canApply(label, value > (current ?? 0))) accepted[key] = value;
  }
  const proposedBands = proposal.bandColourIds;
  if (proposedBands && !sameBandSelection(proposedBands, shared.target.bandColourIds) &&
    canApply('Bands', bandStrength(proposedBands, bands) > bandStrength(shared.target.bandColourIds, bands))) {
    accepted.bandColourIds = proposedBands;
  }
  for (const field of exercise.modifiers ?? []) {
    if (!recordedFields?.some((recorded) => recorded.id === field.id && recorded.type === field.type)) continue;
    const value = modifierValue(proposal.modifiers, field.id);
    const current = modifierValue(shared.target.modifiers, field.id);
    if (value === undefined || (value ?? undefined) === current) continue;
    if (canApply(field.label, typeof value === 'number' && typeof current === 'number' && value > current)) {
      accepted.modifiers = changeModifierValue(accepted.modifiers, field.id, value);
    }
  }
  return { accepted, blocked };
}

export function applySessionProgressions(template: WorkoutTemplate, session: WorkoutSession, bands: BandColour[]): WorkoutTemplate {
  if (!session.completedAt || session.sets.some((set) => !set.completedAt)) return template;
  const finalSets = getFinalExerciseSets(session);
  const days = template.days.map((day) => {
    if (day.id !== session.templateDayId) return day;
    const exercises = day.exercises.map((exercise) => {
      const set = finalSets.get(exercise.id);
      if (!set?.proposedNextTarget) return exercise;
      const { accepted } = reviewExerciseProgression(exercise, session, set, bands);
      if (!Object.keys(accepted).length) return exercise;
      const { modifiers: proposedModifiers, ...standard } = accepted;
      const shared = exercise.sets[0];
      let modifiers = shared.target.modifiers;
      for (const [id, value] of Object.entries(proposedModifiers ?? {})) {
        modifiers = changeModifierValue(modifiers, id, value ?? undefined);
      }
      return replaceExerciseTarget(exercise, {
        rangeMax: standard.reps === undefined && standard.seconds === undefined ? shared.rangeMax : undefined,
        target: { ...shared.target, ...standard, ...(exercise.mode === 'other' ? { modifiers } : {}) },
      });
    });
    return exercises.every((exercise, index) => exercise === day.exercises[index]) ? day : { ...day, exercises };
  });
  return days.every((day, index) => day === template.days[index]) ? template : { ...template, days };
}

export function formatSetTarget(set: SessionSet, bandColours: BandColour[], modifiers?: Modifier[], rangeMax?: number): string {
  if (set.mode === 'other') return formatModifierValues(set.target, modifiers) || 'Open targets';
  if (set.mode === 'interval') return formatDuration(set.target.seconds ?? 0);
  if (set.mode === 'timed_hold') return `${formatTargetRange(set.target.seconds ?? 0, rangeMax)} seconds`;
  const repsLabel = `${formatTargetRange(set.target.reps ?? 0, rangeMax)} reps`;
  if (set.mode === 'band_reps') return `${formatBandNames(set.target.bandColourIds ?? [], bandColours)} x ${repsLabel}`;
  return `${set.target.weightKg ?? 0} kg x ${repsLabel}`;
}

function formatBandNames(ids: string[], bandColours: BandColour[]): string {
  if (!ids.length) return 'No band';
  const selectedIds = new Set(ids);
  const names = bandColours.filter((band) => selectedIds.has(band.id)).map((band) => band.name);
  const knownIds = new Set(bandColours.map((band) => band.id));
  names.push(...ids.filter((id) => !knownIds.has(id)).map(() => 'Unknown band'));
  return names.join(' + ');
}
