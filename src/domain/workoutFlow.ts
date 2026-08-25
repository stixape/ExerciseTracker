import type { BandColour, PlannedSetProgression, SessionSet, WorkoutSession, WorkoutTemplate } from './types';
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

export function applySetProgression(
  template: WorkoutTemplate,
  session: WorkoutSession,
  set: SessionSet,
  progression?: PlannedSetProgression,
  knownBandColourIds?: Iterable<string>,
): WorkoutTemplate {
  if (!progression || !isSetTargetMet(set)) return template;

  const errors = validatePlannedSetProgression(set.mode, progression, knownBandColourIds);
  if (errors.length) throw new RangeError(errors.join(' '));
  const nextTarget = progressionForMode(set, progression);
  if (!progressionChangesTarget(set, nextTarget)) return template;

  return {
    ...template,
    days: template.days.map((day) => {
      if (day.id !== session.templateDayId) return day;

      return {
        ...day,
        exercises: day.exercises.map((exercise) => {
          if (exercise.id !== set.exerciseId) return exercise;

          return {
            ...exercise,
            sets: exercise.sets.map((templateSet) => {
              if (templateSet.id !== set.templateSetId) return templateSet;

              return {
                ...templateSet,
                target: {
                  ...templateSet.target,
                  ...nextTarget,
                  ...(nextTarget.bandColourIds ? { bandColourIds: [...nextTarget.bandColourIds] } : {}),
                },
              };
            }),
          };
        }),
      };
    }),
  };
}

/**
 * Stores a proposed target on the performed set without mutating the plan. Passing
 * no proposal, an unchanged proposal, or a missed target removes a prior proposal.
 */
export function stageSetProgression(
  set: SessionSet,
  progression?: PlannedSetProgression,
  knownBandColourIds?: Iterable<string>,
): SessionSet {
  if (!progression || !isSetTargetMet(set)) return withoutProposedTarget(set);

  const errors = validatePlannedSetProgression(set.mode, progression, knownBandColourIds);
  if (errors.length) throw new RangeError(errors.join(' '));
  const nextTarget = progressionForMode(set, progression);
  if (!progressionChangesTarget(set, nextTarget)) return withoutProposedTarget(set);
  return {
    ...set,
    proposedNextTarget: {
      ...nextTarget,
      ...(nextTarget.bandColourIds ? { bandColourIds: [...nextTarget.bandColourIds] } : {}),
    },
  };
}

/** Applies every staged target only once a whole workout has been completed. */
export function applySessionProgressions(
  template: WorkoutTemplate,
  session: WorkoutSession,
  knownBandColourIds?: Iterable<string>,
): WorkoutTemplate {
  if (!session.completedAt || session.sets.some((set) => !set.completedAt)) return template;

  return session.sets.reduce(
    (current, set) => applySetProgression(current, session, set, set.proposedNextTarget, knownBandColourIds),
    template,
  );
}

export function formatSetTarget(set: SessionSet, bandColours: BandColour[]): string {
  if (set.mode === 'timed_hold') return `${set.target.seconds ?? 0} seconds`;
  const repsLabel = `${set.target.reps ?? 0} reps`;
  if (set.mode === 'band_reps') return `${formatBandNames(set.target.bandColourIds ?? [], bandColours)} x ${repsLabel}`;
  return `${set.target.weightKg ?? 0} kg x ${repsLabel}`;
}

function formatBandNames(ids: string[], bandColours: BandColour[]): string {
  if (!ids.length) return 'No band';

  return ids
    .map((id) => bandColours.find((band) => band.id === id)?.name ?? 'Unknown band')
    .join(' + ');
}

function isSetTargetMet(set: SessionSet): boolean {
  if (set.mode === 'timed_hold') return (set.actual.seconds ?? 0) >= (set.target.seconds ?? 0);
  // Weight is numerically comparable; band colours are user-defined and have no
  // reliable strength ordering, so band progression is gated by reps alone.
  if (set.mode === 'weighted_reps' && (set.actual.weightKg ?? 0) < (set.target.weightKg ?? 0)) return false;
  return (set.actual.reps ?? 0) >= (set.target.reps ?? 0);
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function progressionForMode(set: SessionSet, progression: PlannedSetProgression): PlannedSetProgression {
  if (set.mode === 'timed_hold') {
    return progression.seconds === undefined ? {} : { seconds: progression.seconds };
  }

  const repTargets = progression.reps === undefined ? {} : { reps: progression.reps };
  if (set.mode === 'weighted_reps') {
    return {
      ...repTargets,
      ...(progression.weightKg === undefined ? {} : { weightKg: progression.weightKg }),
    };
  }
  return {
    ...repTargets,
    ...(progression.bandColourIds === undefined ? {} : { bandColourIds: [...progression.bandColourIds] }),
  };
}

function progressionChangesTarget(set: SessionSet, progression: PlannedSetProgression): boolean {
  return Object.entries(progression).some(([key, value]) => {
    if (key === 'bandColourIds') return !sameIds(value as string[], set.target.bandColourIds ?? []);
    return set.target[key as keyof typeof set.target] !== value;
  });
}

function withoutProposedTarget(set: SessionSet): SessionSet {
  if (!set.proposedNextTarget) return set;
  const next = { ...set };
  delete next.proposedNextTarget;
  return next;
}
