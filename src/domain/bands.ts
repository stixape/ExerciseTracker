import type {
  AppData,
  BandColour,
  PlannedSetProgression,
  SessionSet,
  SetValues,
  TemplateDay,
  WorkoutSession,
} from './types';

export function reorderBandColours(bands: BandColour[], bandId: string, targetBandId: string): BandColour[] {
  const fromIndex = bands.findIndex((band) => band.id === bandId);
  const targetIndex = bands.findIndex((band) => band.id === targetBandId);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return bands;

  const reordered = [...bands];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered;
}

function removeBandFromValues(values: SetValues, bandId: string): SetValues {
  if (!values.bandColourIds?.includes(bandId)) return values;
  return { ...values, bandColourIds: values.bandColourIds.filter((id) => id !== bandId) };
}

function removeBandFromProgression(
  progression: PlannedSetProgression | undefined,
  bandId: string,
): PlannedSetProgression | undefined {
  if (!progression?.bandColourIds?.includes(bandId)) return progression;

  const next: PlannedSetProgression = {
    ...progression,
    bandColourIds: progression.bandColourIds.filter((id) => id !== bandId),
  };
  if (next.bandColourIds?.length === 0) delete next.bandColourIds;
  return Object.values(next).some((value) => value !== undefined) ? next : undefined;
}

function removeBandFromDay(day: TemplateDay, bandId: string): TemplateDay {
  return {
    ...day,
    exercises: day.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, target: removeBandFromValues(set.target, bandId) })),
    })),
  };
}

function removeBandFromSessionSet(set: SessionSet, bandId: string): SessionSet {
  const proposedNextTarget = removeBandFromProgression(set.proposedNextTarget, bandId);
  const next: SessionSet = {
    ...set,
    target: removeBandFromValues(set.target, bandId),
    actual: removeBandFromValues(set.actual, bandId),
  };
  if (proposedNextTarget) next.proposedNextTarget = proposedNextTarget;
  else delete next.proposedNextTarget;
  return next;
}

function removeBandFromSession(session: WorkoutSession, bandId: string): WorkoutSession {
  return {
    ...session,
    snapshot: removeBandFromDay(session.snapshot, bandId),
    sets: session.sets.map((set) => removeBandFromSessionSet(set, bandId)),
  };
}

export function removeBandColour(data: AppData, bandId: string): AppData {
  return {
    ...data,
    bandColours: data.bandColours.filter((band) => band.id !== bandId),
    template: {
      ...data.template,
      days: data.template.days.map((day) => removeBandFromDay(day, bandId)),
    },
    sessions: data.sessions.map((session) => removeBandFromSession(session, bandId)),
    ...(data.activeWorkout
      ? {
          activeWorkout: {
            ...data.activeWorkout,
            session: removeBandFromSession(data.activeWorkout.session, bandId),
          },
        }
      : {}),
  };
}
