import { getExerciseRestSeconds } from './rest';
import { completeSessionIfDone, completeSet, logRestEvent } from './session';
import type { ActiveInterval, ActiveWorkout, SessionSet, WorkoutSession } from './types';

export const DEFAULT_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 24 * 60 * 60;

type IntervalCue = 'bell' | 'finish';
export type IntervalUpdate = { workout: ActiveWorkout; cue?: IntervalCue };

export function getIntervalSet(session: WorkoutSession, exerciseId: string): SessionSet | undefined {
  return session.sets.find((set) => set.exerciseId === exerciseId && set.mode === 'interval' && !set.completedAt);
}

function startPhase(phase: ActiveInterval['phase'], setId: string, start: number, seconds: number): ActiveInterval {
  return { phase, setId, startedAt: new Date(start).toISOString(), endsAt: new Date(start + seconds * 1000).toISOString() };
}

function startWork(set: SessionSet, now: number): ActiveInterval {
  return startPhase('work', set.id, now, set.target.seconds!);
}

export function startInterval(workout: ActiveWorkout, exerciseId: string, now: number): ActiveWorkout {
  if (workout.activeInterval || workout.activeRest) return workout;
  const set = getIntervalSet(workout.session, exerciseId);
  if (!set) return workout;
  const start = workout.session.sets.reduce((latest, item) =>
    item.completedAt ? Math.max(latest, Date.parse(item.completedAt)) : latest,
  Math.max(now, Date.parse(workout.session.startedAt)));
  return {
    ...workout,
    activeInterval: startWork(set, start),
    selectedExerciseId: undefined,
    selectedSetId: undefined,
  };
}

export function pauseInterval(workout: ActiveWorkout, now: number): ActiveWorkout {
  const interval = workout.activeInterval;
  if (!interval?.endsAt || Date.parse(interval.endsAt) <= now) return workout;
  const { phase, setId, startedAt } = interval;
  const set = workout.session.sets.find((item) => item.id === setId)!;
  const phaseSeconds = phase === 'work' ? set.target.seconds! : getExerciseRestSeconds(workout.session, set.exerciseIndex);
  const remainingMs = Math.min(phaseSeconds * 1000, Date.parse(interval.endsAt) - Math.max(now, Date.parse(startedAt)));
  return { ...workout, activeInterval: { phase, setId, startedAt, remainingMs } };
}

export function resumeInterval(workout: ActiveWorkout, now: number): ActiveWorkout {
  const interval = workout.activeInterval;
  if (!interval || interval.remainingMs === undefined) return workout;
  const { phase, setId, startedAt, remainingMs } = interval;
  const endsAt = new Date(Math.max(now, Date.parse(startedAt)) + remainingMs).toISOString();
  return { ...workout, activeInterval: { phase, setId, startedAt, endsAt } };
}

function advancePhase(workout: ActiveWorkout, at: number, skipped = false): IntervalUpdate {
  const interval = workout.activeInterval!;
  const set = workout.session.sets.find((item) => item.id === interval.setId)!;
  const timestamp = new Date(at).toISOString();
  const restSeconds = getExerciseRestSeconds(workout.session, set.exerciseIndex);
  const session = interval.phase === 'work'
    ? completeSet(workout.session, set.id, { seconds: set.target.seconds }, timestamp)
    : logRestEvent(workout.session, { afterSessionSetId: set.id, durationSeconds: restSeconds, startedAt: interval.startedAt }, skipped, timestamp);
  const next = getIntervalSet(session, set.exerciseId);
  if (!next) {
    return { workout: { ...workout, session: completeSessionIfDone(session, timestamp), activeInterval: undefined }, cue: 'finish' };
  }
  const activeInterval = interval.phase === 'work' && restSeconds > 0
    ? startPhase('rest', set.id, at, restSeconds)
    : startWork(next, at);
  return { workout: { ...workout, session, activeInterval }, cue: 'bell' };
}

/** Commit elapsed phases together and emit at most one live cue. */
export function advanceInterval(workout: ActiveWorkout, now: number, live = false): IntervalUpdate {
  let result: IntervalUpdate = { workout };
  let transitions = 0;
  while (result.workout.activeInterval?.endsAt) {
    const boundary = Date.parse(result.workout.activeInterval.endsAt);
    if (boundary > now) break;
    result = advancePhase(result.workout, boundary);
    transitions++;
  }
  if (result.cue === 'bell' && (!live || transitions !== 1)) return { workout: result.workout };
  return result;
}

export function skipIntervalRest(workout: ActiveWorkout, now: number): IntervalUpdate {
  const interval = workout.activeInterval;
  if (interval?.phase !== 'rest') return { workout };
  if (interval.endsAt && Date.parse(interval.endsAt) <= now) return advanceInterval(workout, now, true);
  return advancePhase(workout, Math.max(now, Date.parse(interval.startedAt)), true);
}
