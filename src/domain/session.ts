import { createId } from './ids';
import type { ActiveRest, RestEvent, SessionSet, SetValues, TemplateDay, WorkoutSession } from './types';
import { getNextIncompleteSet, getRestDurationSeconds, isFinalSet } from './rest';

export function createSessionFromDay(day: TemplateDay): WorkoutSession {
  const sets: SessionSet[] = day.exercises.flatMap((exercise, exerciseIndex) =>
    exercise.sets.map((set) => ({
      id: createId('session_set'),
      templateSetId: set.id,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      exerciseIndex,
      setNumber: set.setNumber,
      mode: exercise.mode,
      target: { ...set.target, bandColourIds: [...(set.target.bandColourIds ?? [])] },
      actual: { ...set.target, bandColourIds: [...(set.target.bandColourIds ?? [])] },
    })),
  );

  return {
    id: createId('session'),
    templateDayId: day.id,
    label: day.label,
    startedAt: new Date().toISOString(),
    snapshot: structuredClone(day),
    sets,
    restEvents: [],
  };
}

export function completeSet(session: WorkoutSession, setId: string, actual: SetValues): WorkoutSession {
  return {
    ...session,
    sets: session.sets.map((set) =>
      set.id === setId
        ? {
            ...set,
            actual: {
              ...actual,
              bandColourIds: [...(actual.bandColourIds ?? [])],
            },
            completedAt: new Date().toISOString(),
          }
        : set,
    ),
  };
}

export function uncompleteSet(session: WorkoutSession, setId: string): WorkoutSession {
  return {
    ...session,
    completedAt: undefined,
    sets: session.sets.map((set) => (set.id === setId ? { ...set, completedAt: undefined } : set)),
    restEvents: session.restEvents.filter((event) => event.afterSessionSetId !== setId),
  };
}

export function completeSessionIfDone(session: WorkoutSession): WorkoutSession {
  if (session.completedAt || session.sets.some((set) => !set.completedAt)) return session;
  return { ...session, completedAt: new Date().toISOString() };
}

export function createActiveRest(session: WorkoutSession, completedSetId: string): ActiveRest | undefined {
  const completedSet = session.sets.find((set) => set.id === completedSetId);
  if (!completedSet || isFinalSet(session, completedSetId)) return undefined;

  const now = Date.now();
  const durationSeconds = getRestDurationSeconds(completedSet.exerciseIndex, true);
  const nextSet = getNextIncompleteSet(session, completedSetId) ?? getNextIncompleteSet(session);

  return {
    afterSessionSetId: completedSetId,
    durationSeconds,
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + durationSeconds * 1000).toISOString(),
    nextSetId: nextSet?.id,
    completed: false,
  };
}

export function logRestEvent(session: WorkoutSession, rest: ActiveRest, skipped: boolean): WorkoutSession {
  const afterSet = session.sets.find((set) => set.id === rest.afterSessionSetId);
  const restEvent: RestEvent = {
    id: createId('rest'),
    afterSessionSetId: rest.afterSessionSetId,
    exerciseIndex: afterSet?.exerciseIndex ?? 0,
    setNumber: afterSet?.setNumber ?? 0,
    durationSeconds: rest.durationSeconds,
    startedAt: rest.startedAt,
    endedAt: new Date().toISOString(),
    skipped,
  };

  return { ...session, restEvents: [...session.restEvents, restEvent] };
}
