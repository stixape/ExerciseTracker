import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Check, Clock3, Pause, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import { sessionWorkoutDate, weekdayName } from '../../domain/calendar';
import { advanceInterval, pauseInterval, resumeInterval, skipIntervalRest, startInterval, type IntervalUpdate } from '../../domain/interval';
import { formatDuration } from '../../domain/rest';
import { completeSessionIfDone, completeSet, createActiveRest, createSessionFromDay, logRestEvent, uncompleteSet, updateExerciseNotes } from '../../domain/session';
import type { ActiveRest, ActiveWorkout, AppData, BandColour, Modifier, SessionSet, SetValues, TemplateDay, WorkoutSession } from '../../domain/types';
import { changeModifierValue, modifierValue } from '../../domain/modifiers';
import { formatTargetRange, getRecordedRangeMax } from '../../domain/targetRange';
import { validateSetValues } from '../../domain/validation';
import { applySessionProgressions, formatSetTarget, getCurrentSessionSet, getFinalExerciseSets, reviewExerciseProgression, stageSetProgression, type PlannedSetProgression } from '../../domain/workoutFlow';
import { findPreviousSet } from '../../domain/previousSet';
import { playIntervalBell, playIntervalFinishAlarm, playRestAlarm, primeAlarmAudio, primeIntervalAudio } from '../../lib/alarm';
import { formatBandNames, formatSetActual } from '../../lib/workoutFormatting';
import { useTracker } from '../../app/TrackerContext';
import { ValidatedInput } from '../../components/ValidatedInput';
import { ExerciseNotes } from '../../components/ExerciseNotes';
import { ModifierInput } from '../../components/ModifierInput';
import { WorkTimeInput } from '../../components/WorkTimeInput';
import { IntervalTimer } from './IntervalTimer';

export function WorkoutPage() {
  const { data, saveData, status } = useTracker();
  const navigate = useNavigate();
  const [finishingSessionId, setFinishingSessionId] = useState<string>();
  const activeWorkout = data.activeWorkout;
  const session = activeWorkout?.session;
  const interval = activeWorkout?.activeInterval;
  const intervalSet = session?.sets.find((set) => set.id === interval?.setId);
  const selectedSet = session?.sets.find((set) => set.id === activeWorkout?.selectedSetId && !set.completedAt);
  const currentSet = selectedSet ?? (session ? getCurrentSessionSet(session) : undefined);
  const completedCount = session?.sets.filter((set) => set.completedAt).length ?? 0;
  const finalSets = session && getFinalExerciseSets(session);
  const planDay = data.template.days.find((day) => day.id === session?.templateDayId);
  const plannedExercise = planDay?.exercises.find((exercise) => exercise.id === currentSet?.exerciseId);
  const currentPlanTarget = plannedExercise?.mode === currentSet?.mode ? plannedExercise?.sets[0]?.target : undefined;
  const referenceSet = interval ? (interval.phase === 'work' ? intervalSet : undefined) : currentSet;
  const previousSet = session && referenceSet && findPreviousSet(data.sessions, session, referenceSet);
  const previous = session && referenceSet && previousSet && <PreviousResult set={previousSet} bandColours={data.bandColours}
    modifiers={session.snapshot.exercises[referenceSet.exerciseIndex]?.modifiers} />;

  useScreenWakeLock(Boolean(session && !session.completedAt));

  async function updateInterval(update: (workout: ActiveWorkout) => IntervalUpdate) {
    let cue: IntervalUpdate['cue'];
    const saved = await saveData((current) => {
      const workout = current.activeWorkout;
      if (!workout || workout.session.id !== session?.id || workout.activeInterval !== interval) return current;
      const next = update(workout);
      cue = next.cue;
      return next.workout === workout ? current : { ...current, activeWorkout: next.workout };
    }, 'set');
    if (saved && cue === 'bell') void playIntervalBell();
    if (saved && cue === 'finish') void playIntervalFinishAlarm();
  }

  function beginInterval(set: SessionSet) {
    primeIntervalAudio();
    void updateInterval((workout) => ({ workout: startInterval(workout, set.exerciseId, Date.now()) }));
  }

  function updateActual(setId: string, actual: SetValues) {
    saveData((current) => {
      const workout = current.activeWorkout;
      if (!workout || workout.session.id !== session?.id) return current;
      return updateWorkoutSet(current, workout, setId, (set) => ({ ...set, actual }));
    });
  }

  function updateProgression(set: SessionSet, progression?: PlannedSetProgression) {
    if (finalSets?.get(set.exerciseId)?.id !== set.id) return;
    try {
      const staged = stageSetProgression(set, progression, data.bandColours.map((band) => band.id));
      saveData((current) => {
        const workout = current.activeWorkout;
        if (!workout || workout.session.id !== session?.id) return current;
        return updateWorkoutSet(current, workout, set.id, (live) => ({ ...live, proposedNextTarget: staged.proposedNextTarget }));
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'That next-time target is not valid.');
    }
  }

  function completeWorkoutSet(set: SessionSet) {
    if (reportInvalidWorkoutInput()) return;
    if (!data.settings.hideRestTimes) primeAlarmAudio();
    const errors = validateSetValues(set.mode, set.actual);
    if (errors.length) {
      window.alert(set.mode === 'band_reps' && !set.actual.bandColourIds?.length
        ? 'Choose a band colour in Plan and restart the workout to use it.' : errors.join('\n'));
      return;
    }

    saveData((current) => {
      if (!current.activeWorkout) return current;
      const completed = completeSet(current.activeWorkout.session, set.id, set.actual);
      const createdRest = current.settings.hideRestTimes ? undefined : createActiveRest(completed, set.id);
      const activeRest = createdRest ? { ...createdRest, nextSetId: getCurrentSessionSet(completed)?.id } : undefined;
      const completedSession = completeSessionIfDone(completed);

      return {
        ...current,
        activeWorkout: {
          ...current.activeWorkout,
          session: completedSession,
          activeRest,
          selectedExerciseId: undefined,
          selectedSetId: undefined,
        },
      };
    }, 'set');
  }

  function updateRest(updater: (session: WorkoutSession, rest: ActiveRest) => { session: WorkoutSession; activeRest?: ActiveRest }) {
    saveData((current) => {
      if (!current.activeWorkout?.activeRest) return current;
      const next = updater(current.activeWorkout.session, current.activeWorkout.activeRest);
      return {
        ...current,
        activeWorkout: {
          ...current.activeWorkout,
          session: next.session,
          activeRest: next.activeRest,
        },
      };
    });
  }

  function finishRest(skipped: boolean) {
    updateRest((currentSession, rest) => ({
      session: logRestEvent(currentSession, rest, skipped),
      activeRest: undefined,
    }));
  }

  function chooseExercise(exerciseId: string) {
    saveData((current) => {
      if (!current.activeWorkout) return current;
      const set = current.activeWorkout.session.sets.find((item) => item.exerciseId === exerciseId && !item.completedAt);
      if (!set) return current;
      return {
        ...current,
        activeWorkout: {
          ...current.activeWorkout,
          selectedExerciseId: exerciseId,
          selectedSetId: set.id,
        },
      };
    });
  }

  function undoCompletedSet(setId?: string) {
    saveData((current) => {
      if (!current.activeWorkout) return current;
      const completedSets = current.activeWorkout.session.sets.filter((set) => set.completedAt);
      const target = setId
        ? completedSets.find((set) => set.id === setId)
        : [...completedSets].sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
      if (!target) return current;
      return {
        ...current,
        activeWorkout: {
          ...current.activeWorkout,
          session: uncompleteSet(current.activeWorkout.session, target.id),
          activeRest: undefined,
          selectedExerciseId: target.exerciseId,
          selectedSetId: target.id,
        },
      };
    });
  }

  function pauseWorkout() {
    navigate('/workout');
  }

  async function discardWorkout() {
    if (!session) return;
    const confirmed = window.confirm(`Discard the ${session.label} workout in progress? Completed sets in this workout will not be saved.`);
    if (!confirmed) return;
    await saveData((current) => ({ ...current, activeWorkout: undefined }));
  }

  function restartWorkout() {
    if (!session) return;
    const confirmed = window.confirm(`Restart ${session.label}? All set entries from this workout will be cleared.`);
    if (!confirmed) return;
    const latestDay = data.template.days.find((item) => item.id === session.templateDayId) ?? session.snapshot;
    if (!latestDay.exercises.length || !latestDay.exercises.some((exercise) => exercise.sets.length)) return;
    saveData((current) => ({ ...current, activeWorkout: {
      session: createSessionFromDay({ ...latestDay, label: weekdayName(latestDay.weekday) }, new Date(), sessionWorkoutDate(session)),
    } }));
    primeAlarmAudio();
  }

  async function saveCompletedWorkout() {
    if (!session?.completedAt || !session.sets.length || reportInvalidWorkoutInput()) return;
    setFinishingSessionId(session.id);
    await saveData((current) => {
      if (!current.activeWorkout?.session.completedAt || current.activeWorkout.session.id !== session.id) return current;
      const completedSession = current.activeWorkout.session;
      const template = applySessionProgressions(current.template, completedSession, current.bandColours);
      return {
        ...current,
        template,
        sessions: [completedSession, ...current.sessions.filter((item) => item.id !== completedSession.id)],
        activeWorkout: undefined,
      };
    }, 'workout');
  }

  if (!session) {
    const saved = finishingSessionId && data.sessions.some((item) => item.id === finishingSessionId);
    return <Navigate replace to={saved ? '/progress' : '/workout'} />;
  }

  if (activeWorkout?.activeRest && !data.settings.hideRestTimes) {
    return (
      <RestScreen
        rest={activeWorkout.activeRest}
        session={session}
        bandColours={data.bandColours}
        onSkip={() => finishRest(true)}
        onComplete={() => finishRest(false)}
        onPause={pauseWorkout}
        onDiscard={discardWorkout}
        onRestart={restartWorkout}
        onUndoLast={() => undoCompletedSet()}
      />
    );
  }

  if (interval && intervalSet) {
    return (
      <section className="focused-workout-screen active-set-screen">
        <WorkoutControls onRestart={restartWorkout} onDiscard={discardWorkout} disabled={status !== 'saved'} />
        <IntervalTimer
          key={interval.setId + interval.phase}
          interval={interval}
          set={intervalSet}
          setCount={session.snapshot.exercises[intervalSet.exerciseIndex].sets.length}
          previous={previous}
          ready={status === 'saved'}
          onDue={(live) => void updateInterval((workout) => advanceInterval(workout, Date.now(), live))}
          onPause={() => void updateInterval((workout) => ({ workout: pauseInterval(workout, Date.now()) }))}
          onResume={() => {
            primeIntervalAudio();
            void updateInterval((workout) => ({ workout: resumeInterval(workout, Date.now()) }));
          }}
          onSkip={() => void updateInterval((workout) => skipIntervalRest(workout, Date.now()))}
        />
      </section>
    );
  }

  if (!session.sets.length) {
    return (
      <EmptyActiveWorkout
        session={session}
        onEditPlan={() => navigate('/plan')}
        onDiscard={discardWorkout}
        onRestart={restartWorkout}
      />
    );
  }

  if (session.completedAt || !currentSet) {
    return (
      <WorkoutSummary
        session={session}
        bandColours={data.bandColours}
        planDay={planDay}
        onProgressionChange={updateProgression}
        onSave={saveCompletedWorkout}
        saving={status === 'saving'}
        onUndo={(setId) => undoCompletedSet(setId)}
        onRestart={restartWorkout}
        onDiscard={discardWorkout}
      />
    );
  }

  return (
    <ActiveSetScreen
      key={currentSet.id}
      set={currentSet}
      session={session}
      completedCount={completedCount}
      bandColours={data.bandColours}
      previous={previous}
      finalSet={finalSets?.get(currentSet.exerciseId)?.id === currentSet.id}
      planTarget={currentPlanTarget}
      blockedIncreases={reviewExerciseProgression(plannedExercise, session, currentSet, data.bandColours).blocked}
      onActualChange={(actual) => updateActual(currentSet.id, actual)}
      onProgressionChange={(progression) => updateProgression(currentSet, progression)}
      onSaveNotes={(notes) => saveData((current) => updateExerciseNotes(current, session.templateDayId, currentSet.exerciseId, notes))}
      onComplete={() => currentSet.mode === 'interval' ? beginInterval(currentSet) : completeWorkoutSet(currentSet)}
      startingBlocked={currentSet.mode === 'interval' && status !== 'saved'}
      onChooseExercise={chooseExercise}
      onPause={pauseWorkout}
      onDiscard={discardWorkout}
      onRestart={restartWorkout}
      onUndoLast={completedCount ? () => undoCompletedSet() : undefined}
    />
  );
}

function updateWorkoutSet(data: AppData, workout: ActiveWorkout, setId: string,
  update: (set: SessionSet) => SessionSet) {
  return {
    ...data,
    activeWorkout: { ...workout, session: {
      ...workout.session,
      sets: workout.session.sets.map((set) => set.id === setId ? update(set) : set),
    } },
  };
}

function reportInvalidWorkoutInput(): boolean {
  const invalid = document.querySelector<HTMLInputElement>('.focused-workout-screen input[aria-invalid="true"]');
  if (!invalid) return false;
  const panel = invalid.closest('details');
  if (panel) panel.open = true;
  invalid.reportValidity();
  return true;
}

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}

function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    let sentinel: WakeLockSentinelLike | undefined;
    let disposed = false;
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    }).wakeLock;

    async function requestWakeLock() {
      if (!enabled || !wakeLock || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const nextSentinel = await wakeLock.request('screen');
        if (disposed) {
          await nextSentinel.release();
          return;
        }
        sentinel = nextSentinel;
      } catch {
        // Wake lock support and permission vary by browser; the workout remains usable without it.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') void requestWakeLock();
    }

    void requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [enabled]);
}


function EmptyActiveWorkout({
  session,
  onEditPlan,
  onDiscard,
  onRestart,
}: {
  session: WorkoutSession;
  onEditPlan: () => void;
  onDiscard: () => void;
  onRestart: () => void;
}) {
  return (
    <section className="focused-workout-screen active-set-screen">
      <WorkoutControls onRestart={onRestart} onDiscard={onDiscard} />
      <div className="active-set-panel empty-active-panel">
        <p className="eyebrow">Workout needs a plan</p>
        <h1>{session.label} is empty</h1>
        <p className="muted-text">This active workout has no sets to complete. Discard it, then add exercises in Plan.</p>
        <div className="active-set-actions">
          <button className="secondary-button" type="button" onClick={onEditPlan}>
            Edit plan
          </button>
          <button className="ghost-button danger" type="button" onClick={onDiscard}>
            Discard empty workout
          </button>
        </div>
      </div>
    </section>
  );
}

function WorkoutSummary({
  session,
  bandColours,
  planDay,
  onProgressionChange,
  onSave,
  saving,
  onUndo,
  onRestart,
  onDiscard,
}: {
  session: WorkoutSession;
  bandColours: BandColour[];
  planDay?: TemplateDay;
  onProgressionChange: (set: SessionSet, progression?: PlannedSetProgression) => void;
  onSave: () => void;
  saving: boolean;
  onUndo: (setId: string) => void;
  onRestart: () => void;
  onDiscard: () => void;
}) {
  const finalSets = getFinalExerciseSets(session);
  const plannedExercises = new Map(planDay?.exercises.map((exercise) => [exercise.id, exercise]));
  const reviews = new Map([...finalSets.values()].map((set) => [set.id, reviewExerciseProgression(
    plannedExercises.get(set.exerciseId), session, set, bandColours,
  )]));
  const proposedCount = [...reviews.values()].filter(({ accepted }) => Object.keys(accepted).length).length;
  const olderProposals = session.sets.some((set) => set.proposedNextTarget && finalSets.get(set.exerciseId)?.id !== set.id);
  const elapsedSeconds = Math.max(0, Math.round(((session.completedAt ? new Date(session.completedAt) : new Date()).getTime() - new Date(session.startedAt).getTime()) / 1000));

  return (
    <section className="focused-workout-screen summary-screen">
      <WorkoutControls onRestart={onRestart} onDiscard={onDiscard} />
      <article className="workout-summary-panel">
        <header className="summary-hero">
          <span className="summary-check" aria-hidden="true">
            <Check size={28} />
          </span>
          <div>
            <p className="eyebrow">Review before saving</p>
            <h1>{session.label} complete</h1>
            <p>
              {session.sets.length} sets · {formatDuration(elapsedSeconds)} elapsed
            </p>
          </div>
        </header>

        {proposedCount > 0 && (
          <p className="progression-notice" role="status">
            {proposedCount} next-time {proposedCount === 1 ? 'target is' : 'targets are'} staged. They will update the plan only when you save.
          </p>
        )}
        {olderProposals && <p className="progression-notice" role="status">
          To use a Next time target from an earlier set, undo that exercise’s final set and enter the target there.
        </p>}

        <div className="summary-set-list" aria-label="Completed sets">
          {session.sets.map((set) => {
            const exercise = session.snapshot.exercises[set.exerciseIndex];
            const review = reviews.get(set.id);
            const proposal = review?.accepted ?? set.proposedNextTarget;
            const proposedLabel = proposal && formatProposedTarget(proposal, bandColours, exercise?.modifiers);
            const planned = plannedExercises.get(set.exerciseId);
            return (
              <div className="summary-set-row" key={set.id}>
                <div>
                  <strong>
                    {set.exerciseName} · Set {set.setNumber}
                  </strong>
                  <span>{formatSetActual(set, bandColours, exercise?.modifiers)}</span>
                  {proposedLabel && <small>{review ? 'Next time' : 'Earlier proposal'}: {proposedLabel}</small>}
                  {set.mode !== 'interval' && review && <BlockedIncreases fields={review.blocked} />}
                </div>
                <button className="ghost-button" type="button" onClick={() => onUndo(set.id)} aria-label={`Undo ${set.exerciseName} set ${set.setNumber}`}>
                  Undo
                </button>
                {set.mode === 'interval' && review && (
                  <NextTargetPanel progression={set.proposedNextTarget ?? {}} blockedIncreases={review.blocked}
                    onClear={() => onProgressionChange(set)}>
                    <WorkTimeInput label="Next time Work Time (minutes)" seconds={set.proposedNextTarget?.seconds}
                        placeholderSeconds={planned?.mode === 'interval' ? planned.sets[0].target.seconds : set.target.seconds}
                      onValue={(seconds) => onProgressionChange(set, { seconds })} />
                  </NextTargetPanel>
                )}
              </div>
            );
          })}
        </div>

        <div className="summary-save-actions">
          <button className="complete-button" type="button" onClick={onSave} disabled={saving}>
            <Check size={18} aria-hidden="true" />
            Save workout
          </button>
          <p>Your workout is not added to History until you save it.</p>
        </div>
      </article>
    </section>
  );
}

function formatProposedTarget(proposal: PlannedSetProgression, bandColours: BandColour[], modifiers?: Modifier[]): string | undefined {
  const parts: string[] = [];
  if (proposal.weightKg !== undefined) parts.push(`${proposal.weightKg} kg`);
  if (proposal.seconds !== undefined) parts.push(`${proposal.seconds}s`);
  if (proposal.bandColourIds !== undefined) parts.push(formatBandNames(proposal.bandColourIds, bandColours));
  if (proposal.reps !== undefined) parts.push(`${proposal.reps} reps`);
  for (const field of modifiers ?? []) {
    const value = modifierValue(proposal.modifiers, field.id);
    if (value !== undefined) parts.push(`${field.label}: ${value ?? 'Clear target'}`);
  }
  return parts.length ? parts.join(' × ') : undefined;
}

function RestScreen({
  rest,
  session,
  bandColours,
  onSkip,
  onComplete,
  onPause,
  onDiscard,
  onRestart,
  onUndoLast,
}: {
  rest: ActiveRest;
  session: WorkoutSession;
  bandColours: BandColour[];
  onSkip: () => void;
  onComplete: () => void;
  onPause: () => void;
  onDiscard: () => void;
  onRestart: () => void;
  onUndoLast: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((new Date(rest.endsAt).getTime() - Date.now()) / 1000)));
  const alarmPlayedRef = useRef(false);
  const nextSet = session.sets.find((set) => set.id === rest.nextSetId);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextRemaining = Math.max(0, Math.ceil((new Date(rest.endsAt).getTime() - Date.now()) / 1000));
      setRemaining(nextRemaining);
      if (nextRemaining === 0 && !alarmPlayedRef.current) {
        alarmPlayedRef.current = true;
        window.clearInterval(interval);
        playRestAlarm();
        onComplete();
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [onComplete, rest.endsAt]);

  return (
    <section className="focused-workout-screen rest-screen" aria-label="Rest period">
      <WorkoutControls onPause={onPause} onRestart={onRestart} onDiscard={onDiscard} inverse />
      <div className="rest-countdown">
        <Clock3 size={34} aria-hidden="true" />
        <p className="eyebrow">Rest period</p>
        <strong role="timer" aria-label={`${remaining} seconds remaining`}>
          {formatDuration(remaining)}
        </strong>
      </div>
      <div className="next-up-panel">
        <p className="eyebrow">Next up</p>
        <h1>{nextSet ? nextSet.exerciseName : 'Next set'}</h1>
        {nextSet && (
          <>
            <strong>Set {nextSet.setNumber}</strong>
            <span>{formatSetTarget(nextSet, bandColours, session.snapshot.exercises[nextSet.exerciseIndex]?.modifiers,
              getRecordedRangeMax(session, nextSet))}</span>
          </>
        )}
      </div>
      <button className="primary-button rest-skip-button" type="button" onClick={onSkip}>
        <SkipForward size={17} />
        Skip rest
      </button>
      <button className="rest-undo-button" type="button" onClick={onUndoLast}>
        Undo completed set
      </button>
    </section>
  );
}

function ActiveSetScreen({
  set,
  session,
  completedCount,
  bandColours,
  previous,
  finalSet,
  planTarget,
  blockedIncreases,
  onActualChange,
  onProgressionChange,
  onSaveNotes,
  onComplete,
  startingBlocked,
  onChooseExercise,
  onPause,
  onDiscard,
  onRestart,
  onUndoLast,
}: {
  set: SessionSet;
  session: WorkoutSession;
  completedCount: number;
  bandColours: BandColour[];
  previous?: ReactNode;
  finalSet: boolean;
  planTarget?: SetValues;
  blockedIncreases: string[];
  onActualChange: (values: SetValues) => void;
  onProgressionChange: (progression?: PlannedSetProgression) => void;
  onSaveNotes: (notes?: string) => Promise<boolean>;
  onComplete: () => void;
  startingBlocked: boolean;
  onChooseExercise: (exerciseId: string) => void;
  onPause: () => void;
  onDiscard: () => void;
  onRestart: () => void;
  onUndoLast?: () => void;
}) {
  const exercise = session.snapshot.exercises[set.exerciseIndex];
  return (
    <section className="focused-workout-screen active-set-screen">
      <WorkoutControls onPause={onPause} onRestart={onRestart} onDiscard={onDiscard} />
      <article className="active-set-panel">
        <ExercisePicker session={session} activeExerciseId={set.exerciseId} onChoose={onChooseExercise} />

        <div className="active-set-heading">
          <div>
            <p className="eyebrow">Current set</p>
            <h1>{set.exerciseName}</h1>
            <p>
              Set {set.setNumber} of {exercise?.sets.length ?? set.setNumber}
            </p>
          </div>
          <span className="active-set-index" aria-label={`Set ${completedCount + 1} of ${session.sets.length} overall`}>
            {completedCount + 1}
          </span>
        </div>

        <progress className="workout-progress" aria-label="Workout progress" value={completedCount} max={session.sets.length} />

        <TargetSummary set={set} bandColours={bandColours} modifiers={exercise?.modifiers} rangeMax={getRecordedRangeMax(session, set)} />
        {previous}
        <ActualSetEditor set={set} modifiers={exercise?.modifiers} onChange={onActualChange} />
        {finalSet && <NextTargetEditor set={set} planTarget={planTarget ?? set.target} bandColours={bandColours} modifiers={exercise?.modifiers}
          blockedIncreases={blockedIncreases} onChange={onProgressionChange} />}
        <ExerciseNotes notes={exercise?.notes} onSave={onSaveNotes} />

        <div className="active-set-actions">
          <button className="complete-button focused-complete-button" type="button" onClick={onComplete} disabled={startingBlocked}>
            <Check size={18} />
            {set.mode === 'interval' ? 'Start interval' : 'Complete set'}
          </button>
          {onUndoLast && (
            <button className="ghost-button focused-exit-button" type="button" onClick={onUndoLast}>
              Undo last set
            </button>
          )}
        </div>
      </article>
    </section>
  );
}

function WorkoutControls({
  onPause,
  onRestart,
  onDiscard,
  inverse = false,
  disabled = false,
}: {
  onPause?: () => void;
  onRestart: () => void;
  onDiscard: () => void;
  inverse?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={inverse ? 'workout-controls inverse' : 'workout-controls'} aria-label="Workout controls">
      {onPause && (
        <button type="button" className="workout-control-button" onClick={onPause}>
          <Pause size={17} aria-hidden="true" />
          Pause
        </button>
      )}
      <span className="workout-control-spacer" />
      <button type="button" className="workout-control-button" onClick={onRestart} disabled={disabled}>
        <RotateCcw size={17} aria-hidden="true" />
        Restart
      </button>
      <button type="button" className="workout-control-button danger" onClick={onDiscard} disabled={disabled}>
        <Trash2 size={17} aria-hidden="true" />
        Discard
      </button>
    </div>
  );
}

function ExercisePicker({
  session,
  activeExerciseId,
  onChoose,
}: {
  session: WorkoutSession;
  activeExerciseId: string;
  onChoose: (exerciseId: string) => void;
}) {
  const exercises = session.snapshot.exercises.length
    ? session.snapshot.exercises
    : Array.from(new Map(session.sets.map((set) => [set.exerciseId, { id: set.exerciseId, name: set.exerciseName }])).values());

  return (
    <nav className="exercise-picker" aria-label="Choose exercise">
      {exercises.map((exercise) => {
        const exerciseSets = session.sets.filter((set) => set.exerciseId === exercise.id);
        const complete = exerciseSets.filter((set) => set.completedAt).length;
        const done = exerciseSets.length > 0 && complete === exerciseSets.length;
        const active = exercise.id === activeExerciseId;
        return (
          <button
            key={exercise.id}
            type="button"
            className={active ? 'exercise-picker-button active' : done ? 'exercise-picker-button done' : 'exercise-picker-button'}
            aria-pressed={active}
            aria-label={`${exercise.name}, ${complete} of ${exerciseSets.length} sets complete${done ? ', complete' : ''}`}
            disabled={done}
            onClick={() => onChoose(exercise.id)}
          >
            <strong>{exercise.name}</strong>
            <span>
              {complete}/{exerciseSets.length}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function TargetSummary({ set, bandColours, modifiers, rangeMax }: {
  set: SessionSet;
  bandColours: BandColour[];
  modifiers?: Modifier[];
  rangeMax?: number;
}) {
  if (set.mode === 'interval') {
    return (
      <section className="target-summary" aria-label="Target">
        <ValueTile label="Time" value={formatDuration(set.target.seconds ?? 0)} />
      </section>
    );
  }
  if (set.mode === 'other') {
    return (
      <section className="target-summary" aria-label="Target">
        {(modifiers ?? []).map((field) => (
          <ValueTile key={field.id} label={`Target ${field.label}`} value={String(modifierValue(set.target.modifiers, field.id) ?? '—')} />
        ))}
      </section>
    );
  }
  if (set.mode === 'timed_hold') {
    return (
      <section className="target-summary" aria-label="Target">
        <ValueTile label="Target time" value={formatTargetRange(set.target.seconds ?? 0, rangeMax) + 's'} />
      </section>
    );
  }

  if (set.mode === 'band_reps') {
    return (
      <section className="target-summary two" aria-label="Target">
        <ValueTile label="Bands" value={formatBandNames(set.actual.bandColourIds ?? [], bandColours)} />
        <ValueTile label="Target reps" value={formatTargetRange(set.target.reps ?? 0, rangeMax)} />
      </section>
    );
  }

  return (
    <section className="target-summary two" aria-label="Target">
      <ValueTile label="Weight" value={`${set.actual.weightKg ?? 0} kg`} />
      <ValueTile label="Target reps" value={formatTargetRange(set.target.reps ?? 0, rangeMax)} />
    </section>
  );
}

function ValueTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="value-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PreviousResult({ set, bandColours, modifiers }: { set: SessionSet; bandColours: BandColour[]; modifiers?: Modifier[] }) {
  const value = set.mode === 'weighted_reps' || set.mode === 'band_reps'
    ? `${set.actual.reps} reps` : formatSetActual(set, bandColours, modifiers);
  return <section className="previous-result" aria-label="Previous"><ValueTile label="Previous" value={value} /></section>;
}

function ActualSetEditor({ set, modifiers, onChange }: {
  set: SessionSet;
  modifiers?: Modifier[];
  onChange: (values: SetValues) => void;
}) {
  const fields = modifiers ?? [];
  if (set.mode === 'interval' || (set.mode === 'other' && !fields.length)) return null;

  function patch(next: Partial<SetValues>) {
    onChange({ ...set.actual, ...next });
  }

  return (
    <section className="actual-editor">
      {set.mode === 'other' ? (
        <div className="modifier-values">
          {fields.map((field) => (
            <ModifierInput key={field.id} field={field} label={'Performed ' + field.label} value={modifierValue(set.actual.modifiers, field.id)}
              onChange={(value) => patch({ modifiers: changeModifierValue(set.actual.modifiers, field.id, value) })} />
          ))}
        </div>
      ) : set.mode === 'timed_hold' ? (
        <NumberStepper label="Performed seconds" value={set.actual.seconds} step={5} onChange={(seconds) => patch({ seconds })} />
      ) : (
        <NumberStepper label="Performed reps" value={set.actual.reps} onChange={(reps) => patch({ reps })} />
      )}
    </section>
  );
}

function NextTargetEditor({ set, planTarget, bandColours, modifiers, blockedIncreases, onChange }: {
  set: SessionSet;
  planTarget: SetValues;
  bandColours: BandColour[];
  modifiers?: Modifier[];
  blockedIncreases: string[];
  onChange: (values?: PlannedSetProgression) => void;
}) {
  const progression = set.proposedNextTarget ?? {};
  function patch(next: Partial<PlannedSetProgression>) {
    onChange({ ...progression, ...next });
  }

  let fields: ReactNode;
  switch (set.mode) {
    case 'interval':
      return null;
    case 'other':
      if (!modifiers?.length) return null;
      fields = modifiers.map((field) => {
        const target = modifierValue(planTarget.modifiers, field.id);
        const proposed = modifierValue(progression.modifiers, field.id);
        return (
          <div className="modifier-next-target" key={field.id}>
            <ModifierInput field={field} label={'Next target ' + field.label} value={proposed ?? undefined}
              placeholder={proposed === null ? 'Target will be cleared' : target === undefined ? undefined : String(target)}
              onChange={(value) => patch({ modifiers: changeModifierValue(progression.modifiers, field.id, value) })} />
            {target !== undefined && proposed !== null && <button className="small-button" type="button"
              onClick={() => patch({ modifiers: changeModifierValue(progression.modifiers, field.id, null) })}>
              Clear {field.label} target
            </button>}
          </div>
        );
      });
      break;
    case 'timed_hold':
      fields = <NumberStepper label="Next target seconds" value={progression.seconds} step={5}
        placeholder={planTarget.seconds} onChange={(seconds) => patch({ seconds })} />;
      break;
    case 'weighted_reps':
    case 'band_reps':
      fields = <>
        {set.mode === 'band_reps' ? (
          <BandPicker label="Next target bands" bandColours={bandColours}
            selectedIds={progression.bandColourIds ?? planTarget.bandColourIds ?? []}
            onChange={(bandColourIds) => patch({ bandColourIds })} />
        ) : (
          <NumberStepper label="Next target weight" value={progression.weightKg} step={0.5} suffix="kg"
            placeholder={planTarget.weightKg} onChange={(weightKg) => patch({ weightKg })} />
        )}
        <NumberStepper label="Next target reps" value={progression.reps}
          placeholder={planTarget.reps} onChange={(reps) => patch({ reps })} />
      </>;
      break;
  }
  return <NextTargetPanel progression={progression} blockedIncreases={blockedIncreases} onClear={() => onChange(undefined)}>
    {fields}
  </NextTargetPanel>;
}

function BlockedIncreases({ fields }: { fields: string[] }) {
  if (!fields.length) return null;
  return <p className="form-message" role="status">{fields.join(', ')} can only increase when every set of this exercise meets its target.</p>;
}

function NextTargetPanel({
  progression,
  blockedIncreases,
  onClear,
  children,
}: {
  progression: PlannedSetProgression;
  blockedIncreases: string[];
  onClear: () => void;
  children: ReactNode;
}) {
  const hasProposal = Object.values(progression).some((value) => value !== undefined);
  return (
    <details className="next-target-panel" open={hasProposal || undefined}>
      <summary>Next time</summary>
      <p className="muted-text">Changes apply to all sets of this exercise when you save the workout.</p>
      <div className="next-target-fields">{children}</div>
      <BlockedIncreases fields={blockedIncreases} />
      {hasProposal && (
        <button className="small-button" type="button" onClick={onClear}>
          Keep current target
        </button>
      )}
    </details>
  );
}

function NumberStepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  suffix,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  step?: number;
  min?: number;
  suffix?: string;
  placeholder?: number;
}) {
  const inputId = useId();

  function adjust(direction: -1 | 1) {
    const base = value ?? placeholder ?? min;
    const next = Math.max(min, Math.round((base + step * direction) * 100) / 100);
    onChange(next);
  }

  return (
    <div className="number-stepper">
      <label htmlFor={inputId}>{label}</label>
      <div className="number-stepper-control">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => adjust(-1)}>
          −
        </button>
        <div className="number-input-wrap">
          <ValidatedInput
            id={inputId}
            type="number"
            inputMode={step % 1 === 0 ? 'numeric' : 'decimal'}
            min={min}
            step={step}
            value={value ?? ''}
            placeholder={placeholder === undefined ? undefined : String(placeholder)}
            optional={label.startsWith('Next')}
            whole={step % 1 === 0}
            onValue={(next) => onChange(next === '' ? undefined : Number(next))}
          />
          {suffix && <span aria-hidden="true">{suffix}</span>}
        </div>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => adjust(1)}>
          +
        </button>
      </div>
    </div>
  );
}

function BandPicker({
  label,
  bandColours,
  selectedIds,
  onChange,
}: {
  label: string;
  bandColours: BandColour[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="band-fieldset">
      <legend>{label}</legend>
      <div className="band-picker">
        {bandColours.filter((band) => !band.archived || selectedIds.includes(band.id)).map((band) => {
          const active = selectedIds.includes(band.id);
          return (
            <button
              key={band.id}
              type="button"
              className={active ? 'band-swatch active' : 'band-swatch'}
              style={{ '--band-color': band.hex } as CSSProperties}
              aria-label={`${band.name} for ${label}`}
              aria-pressed={active}
              title={band.name}
              onClick={() => onChange(active ? selectedIds.filter((id) => id !== band.id) : [...selectedIds, band.id])}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
