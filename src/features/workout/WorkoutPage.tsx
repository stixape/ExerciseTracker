import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, Clock3, Pause, Play, RotateCcw, SkipForward, TimerReset, Trash2 } from 'lucide-react';
import { EmptyState, PageTitle } from '../../components/PageTitle';
import { getTemplateDayForToday } from '../../domain/calendar';
import { formatDuration } from '../../domain/rest';
import { completeSessionIfDone, completeSet, createActiveRest, createSessionFromDay, logRestEvent, uncompleteSet } from '../../domain/session';
import type { ActiveRest, BandColour, SessionSet, SetValues, TemplateDay, WorkoutSession } from '../../domain/types';
import { validateSetValues } from '../../domain/validation';
import { applySessionProgressions, formatSetTarget, getCurrentSessionSet, stageSetProgression, type PlannedSetProgression } from '../../domain/workoutFlow';
import { playRestAlarm, primeAlarmAudio } from '../../lib/alarm';
import { formatBandNames, formatSetActual } from '../../lib/workoutFormatting';
import { useTracker } from '../../app/TrackerContext';

export function WorkoutPage() {
  const { dayId } = useParams();
  const { data, saveData } = useTracker();
  const navigate = useNavigate();
  const activeWorkout = data.activeWorkout;
  const scheduledDay = getTemplateDayForToday(data.template);
  const day = dayId
    ? data.template.days.find((item) => item.id === dayId)
    : activeWorkout
      ? data.template.days.find((item) => item.id === activeWorkout.session.templateDayId) ?? activeWorkout.session.snapshot
      : scheduledDay;
  const routeActiveWorkout = !dayId || activeWorkout?.session.templateDayId === dayId ? activeWorkout : undefined;
  const session = routeActiveWorkout?.session;
  const selectedSet = session?.sets.find((set) => set.id === routeActiveWorkout?.selectedSetId && !set.completedAt);
  const currentSet = selectedSet ?? (session ? getCurrentSessionSet(session) : undefined);
  const completedCount = session?.sets.filter((set) => set.completedAt).length ?? 0;

  useScreenWakeLock(Boolean(session && !session.completedAt));

  function startDay(targetDay: TemplateDay) {
    if (!targetDay.exercises.length || !targetDay.exercises.some((exercise) => exercise.sets.length)) return;

    if (data.activeWorkout && data.activeWorkout.session.templateDayId !== targetDay.id) {
      const replace = window.confirm(`Discard the ${data.activeWorkout.session.label} workout in progress and start ${targetDay.label}?`);
      if (!replace) return;
    }

    const session = createSessionFromDay(targetDay);
    saveData((current) => ({ ...current, activeWorkout: { session } }));
    primeAlarmAudio();
    navigate('/workout');
  }

  function updateActual(setId: string, actual: SetValues) {
    saveData((current) => {
      if (!current.activeWorkout) return current;
      return {
        ...current,
        activeWorkout: {
          ...current.activeWorkout,
          session: {
            ...current.activeWorkout.session,
            sets: current.activeWorkout.session.sets.map((set) => {
              if (set.id !== setId) return set;
              const nextSet = { ...set, actual };
              try {
                return stageSetProgression(nextSet, set.proposedNextTarget, current.bandColours.map((band) => band.id));
              } catch {
                return { ...nextSet, proposedNextTarget: undefined };
              }
            }),
          },
        },
      };
    });
  }

  function updateProgression(setId: string, progression?: PlannedSetProgression) {
    const set = session?.sets.find((item) => item.id === setId);
    if (!set) return;
    let stagedSet: SessionSet;
    try {
      stagedSet = stageSetProgression(set, progression, data.bandColours.map((band) => band.id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'That next-time target is not valid.');
      return;
    }

    saveData((current) => {
      if (!current.activeWorkout) return current;
      return {
        ...current,
        activeWorkout: {
          ...current.activeWorkout,
          session: {
            ...current.activeWorkout.session,
            sets: current.activeWorkout.session.sets.map((item) => (item.id === setId ? stagedSet : item)),
          },
        },
      };
    });
  }

  function completeWorkoutSet(set: SessionSet) {
    primeAlarmAudio();
    const errors = validateSetValues(set.mode, set.actual);
    if (errors.length) {
      window.alert(errors.join('\n'));
      return;
    }

    saveData((current) => {
      if (!current.activeWorkout) return current;
      const completed = completeSet(current.activeWorkout.session, set.id, set.actual);
      const createdRest = createActiveRest(completed, set.id);
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
    });
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
    navigate('/');
  }

  function discardWorkout() {
    if (!session) return;
    const confirmed = window.confirm(`Discard the ${session.label} workout in progress? Completed sets in this workout will not be saved.`);
    if (!confirmed) return;
    saveData((current) => ({ ...current, activeWorkout: undefined }));
    navigate('/');
  }

  function restartWorkout() {
    if (!session) return;
    const confirmed = window.confirm(`Restart ${session.label}? All set entries from this workout will be cleared.`);
    if (!confirmed) return;
    const latestDay = data.template.days.find((item) => item.id === session.templateDayId) ?? session.snapshot;
    if (!latestDay.exercises.length || !latestDay.exercises.some((exercise) => exercise.sets.length)) return;
    saveData((current) => ({ ...current, activeWorkout: { session: createSessionFromDay(latestDay) } }));
    primeAlarmAudio();
  }

  function saveCompletedWorkout() {
    if (!session?.completedAt) return;
    saveData((current) => {
      if (!current.activeWorkout?.session.completedAt) return current;
      const completedSession = current.activeWorkout.session;
      const template = applySessionProgressions(current.template, completedSession, current.bandColours.map((band) => band.id));
      return {
        ...current,
        template,
        sessions: [completedSession, ...current.sessions.filter((item) => item.id !== completedSession.id)],
        activeWorkout: undefined,
      };
    });
    navigate('/progress');
  }

  if (!session && day) {
    const setCount = day.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
    const canStart = day.exercises.length > 0 && setCount > 0;
    return (
      <div className="page-stack">
        <PageTitle eyebrow="Workout preview" title={day.label} text="Review the plan. Nothing is recorded until you choose Start workout." />

        {activeWorkout && activeWorkout.session.templateDayId !== day.id && (
          <section className="status-strip">
            <TimerReset size={22} />
            <div>
              <strong>Workout in progress</strong>
              <span>{activeWorkout.session.label}</span>
            </div>
            <button type="button" className="ghost-button" onClick={() => navigate(`/workout/${activeWorkout.session.templateDayId}`)}>
              Resume
            </button>
          </section>
        )}

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Selected day</p>
              <h2>{day.label}</h2>
            </div>
            {canStart && (
              <button className="primary-button" type="button" onClick={() => startDay(day)}>
                <Play size={18} />
                Start workout
              </button>
            )}
          </div>
          {canStart ? (
            <div className="day-list">
              {day.exercises.map((exercise, index) => (
                <div className="day-row static-row" key={exercise.id}>
                  <span>{exercise.name}</span>
                  <small>
                    Exercise {index + 1} · {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'}
                  </small>
                  <span />
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-workout-recovery">
              <EmptyState title="This workout is empty" text="Add an exercise and at least one set before starting." />
              <button className="secondary-button" type="button" onClick={() => navigate('/plan')}>
                Edit plan
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="page-stack">
        <PageTitle
          eyebrow="Workout"
          title={scheduledDay ? 'Choose a day' : 'Rest day'}
          text={scheduledDay ? 'Review a planned day before starting.' : 'Nothing is scheduled today. You can still choose another planned workout.'}
        />
        <div className="day-list">
          {data.template.days.map((templateDay) => (
            <button key={templateDay.id} className="day-row" type="button" onClick={() => navigate(`/workout/${templateDay.id}`)}>
              <span>{templateDay.label}</span>
              <small>{templateDay.exercises.length} exercises</small>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (activeWorkout?.activeRest) {
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
        onSave={saveCompletedWorkout}
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
      onActualChange={(actual) => updateActual(currentSet.id, actual)}
      onProgressionChange={(progression) => updateProgression(currentSet.id, progression)}
      onComplete={() => completeWorkoutSet(currentSet)}
      onChooseExercise={chooseExercise}
      onPause={pauseWorkout}
      onDiscard={discardWorkout}
      onRestart={restartWorkout}
      onUndoLast={completedCount ? () => undoCompletedSet() : undefined}
    />
  );
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


function parseOptionalNumber(value: string): number | undefined {
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  onSave,
  onUndo,
  onRestart,
  onDiscard,
}: {
  session: WorkoutSession;
  bandColours: BandColour[];
  onSave: () => void;
  onUndo: (setId: string) => void;
  onRestart: () => void;
  onDiscard: () => void;
}) {
  const proposedCount = session.sets.filter((set) => set.proposedNextTarget && Object.values(set.proposedNextTarget).some((value) => value !== undefined)).length;
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

        <div className="summary-set-list" aria-label="Completed sets">
          {session.sets.map((set) => (
            <div className="summary-set-row" key={set.id}>
              <div>
                <strong>
                  {set.exerciseName} · Set {set.setNumber}
                </strong>
                <span>{formatSetActual(set, bandColours)}</span>
                {set.proposedNextTarget && <small>{formatProposedTarget(set, bandColours)}</small>}
              </div>
              <button className="ghost-button" type="button" onClick={() => onUndo(set.id)} aria-label={`Undo ${set.exerciseName} set ${set.setNumber}`}>
                Undo
              </button>
            </div>
          ))}
        </div>

        <div className="summary-save-actions">
          <button className="complete-button" type="button" onClick={onSave}>
            <Check size={18} aria-hidden="true" />
            Save workout
          </button>
          <p>Your workout is not added to History until you save it.</p>
        </div>
      </article>
    </section>
  );
}

function formatProposedTarget(set: SessionSet, bandColours: BandColour[]): string | undefined {
  const proposal = set.proposedNextTarget;
  if (!proposal) return undefined;
  const parts: string[] = [];
  if (proposal.weightKg !== undefined) parts.push(`${proposal.weightKg} kg`);
  if (proposal.seconds !== undefined) parts.push(`${proposal.seconds}s`);
  if (proposal.bandColourIds !== undefined) parts.push(formatBandNames(proposal.bandColourIds, bandColours));
  if (proposal.reps !== undefined) parts.push(`${proposal.reps} reps`);
  return parts.length ? `Next time: ${parts.join(' × ')}` : undefined;
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
            <span>{formatSetTarget(nextSet, bandColours)}</span>
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
  onActualChange,
  onProgressionChange,
  onComplete,
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
  onActualChange: (values: SetValues) => void;
  onProgressionChange: (progression?: PlannedSetProgression) => void;
  onComplete: () => void;
  onChooseExercise: (exerciseId: string) => void;
  onPause: () => void;
  onDiscard: () => void;
  onRestart: () => void;
  onUndoLast?: () => void;
}) {
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
              Set {set.setNumber} of {session.snapshot.exercises[set.exerciseIndex]?.sets.length ?? set.setNumber}
            </p>
          </div>
          <span className="active-set-index" aria-label={`Set ${completedCount + 1} of ${session.sets.length} overall`}>
            {completedCount + 1}
          </span>
        </div>

        <progress className="workout-progress" aria-label="Workout progress" value={completedCount} max={session.sets.length} />

        <TargetSummary set={set} bandColours={bandColours} />
        <ActualSetEditor
          set={set}
          bandColours={bandColours}
          progression={set.proposedNextTarget ?? {}}
          onChange={onActualChange}
          onProgressionChange={onProgressionChange}
        />

        <div className="active-set-actions">
          <button className="complete-button focused-complete-button" type="button" onClick={onComplete}>
            <Check size={18} />
            Complete set
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
}: {
  onPause?: () => void;
  onRestart: () => void;
  onDiscard: () => void;
  inverse?: boolean;
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
      <button type="button" className="workout-control-button" onClick={onRestart}>
        <RotateCcw size={17} aria-hidden="true" />
        Restart
      </button>
      <button type="button" className="workout-control-button danger" onClick={onDiscard}>
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

function TargetSummary({ set, bandColours }: { set: SessionSet; bandColours: BandColour[] }) {
  if (set.mode === 'timed_hold') {
    return (
      <section className="target-summary" aria-label="Target">
        <ValueTile label="Target time" value={`${set.target.seconds ?? 0}s`} />
      </section>
    );
  }

  if (set.mode === 'band_reps') {
    return (
      <section className="target-summary two" aria-label="Target">
        <ValueTile label="Target band" value={formatBandNames(set.target.bandColourIds ?? [], bandColours)} />
        <ValueTile label="Target reps" value={String(set.target.reps ?? 0)} />
      </section>
    );
  }

  return (
    <section className="target-summary two" aria-label="Target">
      <ValueTile label="Target weight" value={`${set.target.weightKg ?? 0} kg`} />
      <ValueTile label="Target reps" value={String(set.target.reps ?? 0)} />
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

function ActualSetEditor({
  set,
  bandColours,
  progression,
  onChange,
  onProgressionChange,
}: {
  set: SessionSet;
  bandColours: BandColour[];
  progression: PlannedSetProgression;
  onChange: (values: SetValues) => void;
  onProgressionChange: (values?: PlannedSetProgression) => void;
}) {
  function patch(next: Partial<SetValues>) {
    onChange({ ...set.actual, ...next });
  }

  function patchProgression(next: Partial<PlannedSetProgression>) {
    onProgressionChange({ ...progression, ...next });
  }

  const repControls = <NumberStepper label="Performed reps" value={set.actual.reps} onChange={(reps) => patch({ reps })} />;

  if (set.mode === 'timed_hold') {
    return (
      <section className="actual-editor">
        <div>
          <p className="eyebrow">Performed</p>
          <NumberStepper label="Performed seconds" value={set.actual.seconds} step={5} onChange={(seconds) => patch({ seconds })} />
        </div>
        <NextTargetPanel progression={progression} onClear={() => onProgressionChange(undefined)}>
          <NumberStepper
            label="Next target seconds"
            value={progression.seconds}
            step={5}
            placeholder={set.target.seconds}
            onChange={(seconds) => patchProgression({ seconds })}
          />
        </NextTargetPanel>
      </section>
    );
  }

  if (set.mode === 'band_reps') {
    const performedBands = set.actual.bandColourIds ?? [];
    const nextBands = progression.bandColourIds ?? set.target.bandColourIds ?? [];
    return (
      <section className="actual-editor">
        <div className="performed-fields">
          <p className="eyebrow">Performed</p>
          <BandPicker
            label="Performed bands"
            bandColours={bandColours}
            selectedIds={performedBands}
            onChange={(bandColourIds) => patch({ bandColourIds })}
          />
          {repControls}
        </div>
        <NextTargetPanel progression={progression} onClear={() => onProgressionChange(undefined)}>
          <BandPicker
            label="Next target bands"
            bandColours={bandColours}
            selectedIds={nextBands}
            onChange={(bandColourIds) => patchProgression({ bandColourIds })}
          />
          <NumberStepper
            label="Next target reps"
            value={progression.reps}
            placeholder={set.target.reps}
            onChange={(reps) => patchProgression({ reps })}
          />
        </NextTargetPanel>
      </section>
    );
  }

  return (
    <section className="actual-editor">
      <div className="performed-fields weighted-actual-editor">
        <p className="eyebrow">Performed</p>
        <NumberStepper label="Performed weight" value={set.actual.weightKg} step={0.5} suffix="kg" onChange={(weightKg) => patch({ weightKg })} />
        {repControls}
      </div>
      <NextTargetPanel progression={progression} onClear={() => onProgressionChange(undefined)}>
        <NumberStepper
          label="Next target weight"
          value={progression.weightKg}
          step={0.5}
          suffix="kg"
          placeholder={set.target.weightKg}
          onChange={(weightKg) => patchProgression({ weightKg })}
        />
        <NumberStepper
          label="Next target reps"
          value={progression.reps}
          placeholder={set.target.reps}
          onChange={(reps) => patchProgression({ reps })}
        />
      </NextTargetPanel>
    </section>
  );
}

function NextTargetPanel({
  progression,
  onClear,
  children,
}: {
  progression: PlannedSetProgression;
  onClear: () => void;
  children: ReactNode;
}) {
  const hasProposal = Object.values(progression).some((value) => value !== undefined);
  return (
    <details className="next-target-panel" open={hasProposal || undefined}>
      <summary>Next time <span>optional</span></summary>
      <p className="muted-text">Leave blank to keep the current target. Changes are applied only when you save the workout.</p>
      <div className="next-target-fields">{children}</div>
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
          <input
            id={inputId}
            type="number"
            inputMode={step % 1 === 0 ? 'numeric' : 'decimal'}
            min={min}
            step={step}
            value={value ?? ''}
            placeholder={placeholder === undefined ? undefined : String(placeholder)}
            onChange={(event) => onChange(parseOptionalNumber(event.target.value))}
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
        {bandColours.map((band) => {
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
