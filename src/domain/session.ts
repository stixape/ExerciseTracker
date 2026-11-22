import { createId } from './ids';
import type { ActiveRest, AppData, RestEvent, SessionSet, SetValues, TemplateDay, WorkoutSession } from './types';
import { getExerciseRestSeconds, getNextIncompleteSet, isFinalSet } from './rest';

function cloneSetValues(values: SetValues): SetValues {
  return {
    ...values,
    bandColourIds: [...(values.bandColourIds ?? [])],
    ...(values.modifiers ? { modifiers: { ...values.modifiers } } : {}),
  };
}

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
      target: cloneSetValues(set.target),
      actual: exercise.mode === 'other' ? {} : cloneSetValues(set.target),
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

export function completeSet(session: WorkoutSession, setId: string, actual: SetValues, completedAt = new Date().toISOString()): WorkoutSession {
  return {
    ...session,
    sets: session.sets.map((set) =>
      set.id === setId
        ? {
            ...set,
            actual: cloneSetValues(actual),
            completedAt,
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

export function completeSessionIfDone(session: WorkoutSession, completedAt = new Date().toISOString()): WorkoutSession {
  if (session.completedAt || session.sets.some((set) => !set.completedAt)) return session;
  return { ...session, completedAt };
}

export function updateExerciseNotes(data: AppData, dayId: string, exerciseId: string, notes?: string): AppData {
  function updateDay(day: TemplateDay) {
    if (day.id !== dayId || !day.exercises.some((exercise) => exercise.id === exerciseId && exercise.notes !== notes)) return day;
    return { ...day, exercises: day.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, notes } : exercise) };
  }
  const days = data.template.days.map(updateDay);
  const active = data.activeWorkout;
  const snapshot = active && updateDay(active.session.snapshot);
  if (days.every((day, index) => day === data.template.days[index]) && snapshot === active?.session.snapshot) return data;
  return {
    ...data,
    template: { ...data.template, days },
    activeWorkout: active && snapshot ? { ...active, session: { ...active.session, snapshot } } : active,
  };
}

export function createActiveRest(session: WorkoutSession, completedSetId: string): ActiveRest | undefined {
  const completedSet = session.sets.find((set) => set.id === completedSetId);
  if (!completedSet || isFinalSet(session, completedSetId)) return undefined;

  const durationSeconds = getExerciseRestSeconds(session, completedSet.exerciseIndex);
  if (!durationSeconds) return undefined;
  const now = Date.now();
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

export function logRestEvent(
  session: WorkoutSession,
  rest: Pick<ActiveRest, 'afterSessionSetId' | 'durationSeconds' | 'startedAt'>,
  skipped: boolean,
  endedAt = new Date().toISOString(),
): WorkoutSession {
  const afterSet = session.sets.find((set) => set.id === rest.afterSessionSetId);
  const restEvent: RestEvent = {
    id: createId('rest'),
    afterSessionSetId: rest.afterSessionSetId,
    exerciseIndex: afterSet?.exerciseIndex ?? 0,
    setNumber: afterSet?.setNumber ?? 0,
    durationSeconds: rest.durationSeconds,
    startedAt: rest.startedAt,
    endedAt,
    skipped,
  };

  return { ...session, restEvents: [...session.restEvents, restEvent] };
}
