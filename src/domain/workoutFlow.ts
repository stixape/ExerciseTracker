import type { BandColour, SessionSet, WorkoutSession, WorkoutTemplate } from './types';

export interface PlannedSetProgression {
  weightKg?: number;
  bandColourIds?: string[];
}

export function getCurrentSessionSet(session: WorkoutSession): SessionSet | undefined {
  return session.sets.find((set) => !set.completedAt);
}

export function getWheelValues(max: number): number[] {
  return Array.from({ length: max + 1 }, (_, index) => index);
}

export function getRepWheelMax(set: SessionSet, fallback = 50): number {
  return Math.max(0, Math.floor(set.target.reps ?? fallback));
}

export function applySetProgression(
  template: WorkoutTemplate,
  session: WorkoutSession,
  set: SessionSet,
  progression?: PlannedSetProgression,
): WorkoutTemplate {
  if (!progression || !isSetTargetMet(set)) return template;

  const nextWeightKg = set.mode === 'weighted_reps' ? progression.weightKg : undefined;
  const nextBandColourIds = set.mode === 'band_reps' ? progression.bandColourIds : undefined;
  const shouldUpdateWeight = nextWeightKg !== undefined && nextWeightKg !== set.target.weightKg;
  const shouldUpdateBands = nextBandColourIds !== undefined && !sameIds(nextBandColourIds, set.target.bandColourIds ?? []);
  if (!shouldUpdateWeight && !shouldUpdateBands) return template;

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
                  ...(shouldUpdateWeight ? { weightKg: nextWeightKg } : {}),
                  ...(shouldUpdateBands ? { bandColourIds: [...(nextBandColourIds ?? [])] } : {}),
                },
              };
            }),
          };
        }),
      };
    }),
  };
}

export function formatSetTarget(set: SessionSet, bandColours: BandColour[]): string {
  if (set.mode === 'timed_hold') return `${set.target.seconds ?? 0} seconds`;
  const repsLabel = `${set.target.reps ?? 0} reps${set.tracksSides ? ' each side' : ''}`;
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
  if (set.tracksSides) {
    const targetReps = set.target.reps ?? 0;
    const leftReps = set.actual.leftReps ?? set.actual.reps ?? 0;
    const rightReps = set.actual.rightReps ?? set.actual.reps ?? 0;
    return leftReps >= targetReps && rightReps >= targetReps;
  }
  return (set.actual.reps ?? 0) >= (set.target.reps ?? 0);
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}
