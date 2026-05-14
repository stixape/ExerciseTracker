import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Dumbbell,
  Home,
  Moon,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SkipForward,
  Sun,
  TimerReset,
  Trash2,
  Upload,
} from 'lucide-react';
import { detectPlateaus } from './domain/analytics';
import { getTemplateDayForToday } from './domain/calendar';
import { createJsonExport, createCsvExport, downloadTextFile } from './domain/export';
import { createId } from './domain/ids';
import { createDefaultAppData } from './domain/sampleData';
import { formatDuration } from './domain/rest';
import { completeSessionIfDone, completeSet, createActiveRest, createSessionFromDay, logRestEvent } from './domain/session';
import type {
  ActiveRest,
  AppData,
  BandColour,
  MetricMode,
  SessionSet,
  SetValues,
  TemplateDay,
  TemplateExercise,
  TemplateSet,
  WorkoutSession,
} from './domain/types';
import { validateSetValues } from './domain/validation';
import {
  applySetProgression,
  formatSetTarget,
  getCurrentSessionSet,
  getRepWheelMax,
  getWheelValues,
  type PlannedSetProgression,
} from './domain/workoutFlow';
import { playRestAlarm, primeAlarmAudio } from './lib/alarm';
import { clearActiveWorkout, loadActiveWorkout, queueCompletedSession, resetOfflineData, saveActiveWorkout } from './lib/offlineDb';
import { loadLocalData, parseJsonImport, saveLocalData } from './lib/localData';

const LOCAL_USER_ID = 'local-user';

interface TrackerContextValue {
  data: AppData;
  saveData: (updater: (current: AppData) => AppData) => void;
}

const TrackerContext = createContext<TrackerContextValue | null>(null);

function useTracker(): TrackerContextValue {
  const value = useContext(TrackerContext);
  if (!value) throw new Error('useTracker must be used inside TrackerContext');
  return value;
}

function App() {
  return <TrackerProvider />;
}

function TrackerProvider() {
  const [data, setData] = useState<AppData>(() => loadLocalData(LOCAL_USER_ID));

  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
  }, [data.settings.theme]);

  useEffect(() => {
    loadActiveWorkout(LOCAL_USER_ID).then((activeWorkout) => {
      if (activeWorkout) {
        setData((current) => ({ ...current, activeWorkout }));
      }
    });
  }, []);

  const saveData = useCallback(
    (updater: (current: AppData) => AppData) => {
      setData((current) => {
        const next = updater(current);
        saveLocalData(next);
        if (next.activeWorkout) {
          void saveActiveWorkout(next.userId, next.activeWorkout);
        } else {
          void clearActiveWorkout(next.userId);
        }
        return next;
      });
    },
    [],
  );

  const contextValue = useMemo(() => ({ data, saveData }), [data, saveData]);

  return (
    <TrackerContext.Provider value={contextValue}>
      <AppShell />
    </TrackerContext.Provider>
  );
}

function AppShell() {
  const { data } = useTracker();
  const location = useLocation();
  const todayDay = getTemplateDayForToday(data.template);
  const workoutPath = todayDay ? `/workout/${todayDay.id}` : '/workout';
  const hideWorkoutChrome = Boolean(data.activeWorkout && location.pathname.startsWith('/workout'));

  return (
    <div className={hideWorkoutChrome ? 'app-shell workout-focus-shell' : 'app-shell'}>
      {!hideWorkoutChrome && (
        <header className="top-bar">
          <NavLink to="/" className="brand-link" aria-label="ExerciseTracker home">
            <span className="brand-mark">
              <Dumbbell size={24} />
            </span>
            <span>ExerciseTracker</span>
          </NavLink>
          <span className="storage-pill">Local-first</span>
        </header>
      )}

      <main className={hideWorkoutChrome ? 'main-content workout-focus-main' : 'main-content'}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/workout/:dayId" element={<WorkoutPage />} />
          <Route path="/workout" element={<WorkoutPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {!hideWorkoutChrome && (
        <nav className="bottom-nav" aria-label="Primary">
          <NavItem to="/" icon={<Home size={20} />} label="Home" />
          <NavItem to="/plan" icon={<Dumbbell size={20} />} label="Plan" />
          <NavItem to={workoutPath} icon={<Activity size={20} />} label="Workout" />
          <NavItem to="/progress" icon={<BarChart3 size={20} />} label="Progress" />
          <NavItem to="/settings" icon={<Settings size={20} />} label="Settings" />
        </nav>
      )}
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink to={to} className="nav-item">
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function Dashboard() {
  const { data } = useTracker();
  const navigate = useNavigate();
  const completedSessions = data.sessions.filter((session) => session.completedAt).length;
  const totalCompletedSets = data.sessions.reduce((total, session) => total + session.sets.filter((set) => set.completedAt).length, 0);
  const nextDay = getTemplateDayForToday(data.template);

  return (
    <div className="page-stack">
      <section className="overview-band">
        <div>
          <p className="eyebrow">Today</p>
          <h1>{nextDay?.label ?? 'Workout'}</h1>
          <p>{nextDay ? `${nextDay.exercises.length} exercises planned` : 'Create a workout day to begin.'}</p>
        </div>
        {nextDay && (
          <button className="primary-button" type="button" onClick={() => navigate(`/workout/${nextDay.id}`)}>
            <Play size={18} />
            Start
          </button>
        )}
      </section>

      {data.activeWorkout && (
        <section className="status-strip">
          <TimerReset size={22} />
          <div>
            <strong>Workout in progress</strong>
            <span>{data.activeWorkout.session.label}</span>
          </div>
          <button type="button" className="ghost-button" onClick={() => navigate('/workout')}>
            Resume
          </button>
        </section>
      )}

      <section className="metric-grid">
        <MetricTile label="Completed sessions" value={completedSessions} />
        <MetricTile label="Completed sets" value={totalCompletedSets} />
        <MetricTile label="Template days" value={data.template.days.length} />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Weekly template</p>
            <h2>{data.template.name}</h2>
          </div>
          <button className="icon-text-button" type="button" onClick={() => navigate('/plan')}>
            Edit <ChevronRight size={18} />
          </button>
        </div>
        <div className="day-list">
          {data.template.days.map((day) => (
            <button key={day.id} className="day-row" type="button" onClick={() => navigate(`/workout/${day.id}`)}>
              <span>{day.label}</span>
              <small>{day.exercises.length} exercises</small>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PlanPage() {
  const { data, saveData } = useTracker();
  const [selectedDayId, setSelectedDayId] = useState(data.template.days[0]?.id ?? '');
  const selectedDay = data.template.days.find((day) => day.id === selectedDayId) ?? data.template.days[0];

  function updateDay(dayId: string, updater: (day: TemplateDay) => TemplateDay) {
    saveData((current) => ({
      ...current,
      template: {
        ...current.template,
        days: current.template.days.map((day) => (day.id === dayId ? updater(day) : day)),
      },
    }));
  }

  function updateExercise(exerciseId: string, updater: (exercise: TemplateExercise) => TemplateExercise) {
    if (!selectedDay) return;
    updateDay(selectedDay.id, (day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => (exercise.id === exerciseId ? updater(exercise) : exercise)),
    }));
  }

  function addExercise() {
    if (!selectedDay) return;
    updateDay(selectedDay.id, (day) => ({
      ...day,
      exercises: [
        ...day.exercises,
        {
          id: createId('exercise'),
          name: 'New Exercise',
          mode: 'weighted_reps',
          sets: [1, 2, 3].map((setNumber) => ({
            id: createId('template_set'),
            setNumber,
            target: getDefaultTargetForMode('weighted_reps', day.exercises.length, data.bandColours),
          })),
        },
      ],
    }));
  }

  if (!selectedDay) {
    return <EmptyState title="No plan days" text="Create a template day to start building workouts." />;
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Plan builder" title="Weekly workouts" text="Edit exercise targets. Each day starts from the planned 5 exercises and 3 sets, but the structure can expand." />

      <div className="day-tabs">
        {data.template.days.map((day) => (
          <button key={day.id} className={day.id === selectedDay.id ? 'active' : ''} type="button" onClick={() => setSelectedDayId(day.id)}>
            {day.label}
          </button>
        ))}
      </div>

      <section className="section-block">
        <label className="inline-label">
          Day name
          <input value={selectedDay.label} onChange={(event) => updateDay(selectedDay.id, (day) => ({ ...day, label: event.target.value }))} />
        </label>
      </section>

      <div className="exercise-list">
        {selectedDay.exercises.map((exercise, exerciseIndex) => (
          <PlanExerciseEditor
            key={exercise.id}
            exercise={exercise}
            exerciseIndex={exerciseIndex}
            bandColours={data.bandColours}
            onChange={(updater) => updateExercise(exercise.id, updater)}
            onRemove={() =>
              updateDay(selectedDay.id, (day) => ({
                ...day,
                exercises: day.exercises.filter((item) => item.id !== exercise.id),
              }))
            }
          />
        ))}
      </div>

      <button className="secondary-button" type="button" onClick={addExercise}>
        <Plus size={18} />
        Add exercise
      </button>
    </div>
  );
}

function getDefaultReps(exerciseIndex: number): number {
  return exerciseIndex === 0 ? 5 : 10;
}

function getDefaultTargetForMode(mode: MetricMode, exerciseIndex: number, bandColours: BandColour[], existing: SetValues = {}): SetValues {
  const reps = existing.reps ?? getDefaultReps(exerciseIndex);

  if (mode === 'weighted_reps') {
    return {
      weightKg: existing.weightKg ?? 0,
      reps,
    };
  }

  if (mode === 'timed_hold') {
    return {
      seconds: existing.seconds ?? 30,
    };
  }

  return {
    reps,
    bandColourIds: existing.bandColourIds?.length ? existing.bandColourIds : [bandColours[0]?.id].filter(Boolean),
  };
}

function cloneSetValues(values: SetValues): SetValues {
  return {
    ...values,
    bandColourIds: [...(values.bandColourIds ?? [])],
  };
}

function ensureUnilateralSetCount(sets: TemplateSet[], mode: MetricMode, exerciseIndex: number, bandColours: BandColour[]): TemplateSet[] {
  const nextSets = sets.map((set, index) => ({
    ...set,
    setNumber: index + 1,
    target: cloneSetValues(set.target),
  }));

  while (nextSets.length < 6) {
    const sourceTarget = nextSets.at(-1)?.target ?? getDefaultTargetForMode(mode, exerciseIndex, bandColours);
    nextSets.push({
      id: createId('template_set'),
      setNumber: nextSets.length + 1,
      target: cloneSetValues(sourceTarget),
    });
  }

  return nextSets;
}

function PlanExerciseEditor({
  exercise,
  exerciseIndex,
  bandColours,
  onChange,
  onRemove,
}: {
  exercise: TemplateExercise;
  exerciseIndex: number;
  bandColours: BandColour[];
  onChange: (updater: (exercise: TemplateExercise) => TemplateExercise) => void;
  onRemove: () => void;
}) {
  function changeMode(mode: MetricMode) {
    onChange((current) => ({
      ...current,
      mode,
      tracksSides: mode === 'timed_hold' ? undefined : current.tracksSides,
      sets: current.sets.map((set) => ({
        ...set,
        target: getDefaultTargetForMode(mode, exerciseIndex, bandColours, set.target),
      })),
    }));
  }

  function changeSideTracking(tracksSides: boolean) {
    onChange((current) => ({
      ...current,
      tracksSides: tracksSides ? true : undefined,
      sets: tracksSides ? ensureUnilateralSetCount(current.sets, current.mode, exerciseIndex, bandColours) : current.sets,
    }));
  }

  return (
    <article className="exercise-card">
      <div className="card-heading">
        <span className="exercise-index">{exerciseIndex + 1}</span>
        <input value={exercise.name} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} />
        <button type="button" className="icon-button danger" onClick={onRemove} aria-label={`Remove ${exercise.name}`}>
          <Trash2 size={17} />
        </button>
      </div>

      <div className="segmented-control" aria-label="Exercise mode">
        <button className={exercise.mode === 'weighted_reps' ? 'active' : ''} type="button" onClick={() => changeMode('weighted_reps')}>
          Weight
        </button>
        <button className={exercise.mode === 'timed_hold' ? 'active' : ''} type="button" onClick={() => changeMode('timed_hold')}>
          Time
        </button>
        <button className={exercise.mode === 'band_reps' ? 'active' : ''} type="button" onClick={() => changeMode('band_reps')}>
          Bands
        </button>
      </div>

      {exercise.mode !== 'timed_hold' && (
        <label className="switch-row exercise-option-row">
          <span>
            <strong>Left/right reps</strong>
          </span>
          <input
            type="checkbox"
            aria-label={`Track sides for ${exercise.name}`}
            checked={Boolean(exercise.tracksSides)}
            onChange={(event) => changeSideTracking(event.target.checked)}
          />
        </label>
      )}

      <div className="set-grid">
        {exercise.sets.map((set) => (
          <div className="set-editor" key={set.id}>
            <div className="set-editor-heading">
              <strong>Set {set.setNumber}</strong>
              {exercise.sets.length > 1 && (
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Remove set ${set.setNumber}`}
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      sets: current.sets
                        .filter((item) => item.id !== set.id)
                        .map((item, index) => ({
                          ...item,
                          setNumber: index + 1,
                        })),
                    }))
                  }
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <SetValueEditor
              mode={exercise.mode}
              values={set.target}
              bandColours={bandColours}
              onChange={(target) =>
                onChange((current) => ({
                  ...current,
                  sets: current.sets.map((item) => (item.id === set.id ? { ...item, target } : item)),
                }))
              }
            />
          </div>
        ))}
      </div>

      <button
        className="small-button"
        type="button"
        onClick={() =>
          onChange((current) => ({
            ...current,
            sets: [
              ...current.sets,
              {
                id: createId('template_set'),
                setNumber: current.sets.length + 1,
                target: getDefaultTargetForMode(current.mode, exerciseIndex, bandColours),
              },
            ],
          }))
        }
      >
        <Plus size={16} />
        Add set
      </button>
    </article>
  );
}

function WorkoutPage() {
  const { dayId } = useParams();
  const { data, saveData } = useTracker();
  const navigate = useNavigate();
  const day = dayId ? data.template.days.find((item) => item.id === dayId) : getTemplateDayForToday(data.template);
  const activeWorkout = data.activeWorkout;
  const routeActiveWorkout = !dayId || activeWorkout?.session.templateDayId === dayId ? activeWorkout : undefined;
  const session = routeActiveWorkout?.session;

  useEffect(() => {
    if (!day || data.activeWorkout) return;
    const session = createSessionFromDay(day);
    saveData((current) => ({ ...current, activeWorkout: { session } }));
    primeAlarmAudio();
  }, [data.activeWorkout, day, saveData]);

  function startDay(targetDay: TemplateDay) {
    if (data.activeWorkout && data.activeWorkout.session.templateDayId !== targetDay.id) {
      const replace = window.confirm('Starting this workout will replace the workout currently in progress. Continue?');
      if (!replace) return;
    }

    const session = createSessionFromDay(targetDay);
    saveData((current) => ({ ...current, activeWorkout: { session } }));
    primeAlarmAudio();
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
            sets: current.activeWorkout.session.sets.map((set) => (set.id === setId ? { ...set, actual } : set)),
          },
        },
      };
    });
  }

  function completeWorkoutSet(set: SessionSet, progression?: PlannedSetProgression) {
    primeAlarmAudio();
    const errors = validateSetValues(set.mode, set.actual);
    if (errors.length) {
      window.alert(errors.join('\n'));
      return;
    }

    const shouldReturnHome = Boolean(completeSessionIfDone(completeSet(session!, set.id, set.actual)).completedAt);

    saveData((current) => {
      if (!current.activeWorkout) return current;
      const completed = completeSet(current.activeWorkout.session, set.id, set.actual);
      const activeRest = createActiveRest(completed, set.id);
      const completedSession = completeSessionIfDone(completed);
      const completedSet = completedSession.sets.find((item) => item.id === set.id) ?? set;
      const template = applySetProgression(current.template, completedSession, completedSet, progression);

      if (completedSession.completedAt && !activeRest) {
        void queueCompletedSession({
          id: createId('sync'),
          userId: current.userId,
          createdAt: new Date().toISOString(),
          type: 'session_completed',
          payload: completedSession,
        });

        return {
          ...current,
          template,
          sessions: [completedSession, ...current.sessions],
          activeWorkout: undefined,
        };
      }

      return {
        ...current,
        template,
        activeWorkout: {
          session: completedSession,
          activeRest,
        },
      };
    });

    if (shouldReturnHome) navigate('/');
  }

  function updateRest(updater: (session: WorkoutSession, rest: ActiveRest) => { session: WorkoutSession; activeRest?: ActiveRest }) {
    saveData((current) => {
      if (!current.activeWorkout?.activeRest) return current;
      const next = updater(current.activeWorkout.session, current.activeWorkout.activeRest);
      return {
        ...current,
        activeWorkout: {
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

  if (!session && day) {
    return (
      <div className="page-stack">
        <PageTitle eyebrow="Workout" title={day.label} text="Start this planned workout or resume the existing active session." />

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
            <button className="primary-button" type="button" onClick={() => startDay(day)}>
              <Play size={18} />
              Start
            </button>
          </div>
          <div className="day-list">
            {day.exercises.map((exercise, index) => (
              <div className="day-row static-row" key={exercise.id}>
                <span>{exercise.name}</span>
                <small>
                  Exercise {index + 1} - {exercise.sets.length} sets
                </small>
                <span />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="page-stack">
        <PageTitle eyebrow="Workout" title="Choose a day" text="Start from one of your weekly template days." />
        <div className="day-list">
          {data.template.days.map((templateDay) => (
            <button key={templateDay.id} className="day-row" type="button" onClick={() => startDay(templateDay)}>
              <span>{templateDay.label}</span>
              <small>{templateDay.exercises.length} exercises</small>
              <Play size={18} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const completedCount = session.sets.filter((set) => set.completedAt).length;
  const currentSet = getCurrentSessionSet(session);

  if (activeWorkout?.activeRest) {
    return (
      <RestScreen
        rest={activeWorkout.activeRest}
        session={session}
        bandColours={data.bandColours}
        onSkip={() => finishRest(true)}
        onComplete={() => finishRest(false)}
      />
    );
  }

  if (!currentSet) {
    return (
      <div className="focused-workout-screen active-set-screen">
        <section className="active-set-panel">
          <p className="eyebrow">Workout complete</p>
          <h1>{session.label}</h1>
        </section>
      </div>
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
      onComplete={(progression) => completeWorkoutSet(currentSet, progression)}
      onExit={() => navigate('/')}
    />
  );
}

function getNumericInputStyle(value: number | undefined): React.CSSProperties {
  return { '--digits': Math.max(1, String(value ?? '').length) } as React.CSSProperties;
}

function parseOptionalNumber(value: string): number | undefined {
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function RestScreen({
  rest,
  session,
  bandColours,
  onSkip,
  onComplete,
}: {
  rest: ActiveRest;
  session: WorkoutSession;
  bandColours: BandColour[];
  onSkip: () => void;
  onComplete: () => void;
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
      <div className="rest-countdown">
        <Clock3 size={34} />
        <p className="eyebrow">Rest period</p>
        <strong>{formatDuration(remaining)}</strong>
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
        Skip
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
  onComplete,
  onExit,
}: {
  set: SessionSet;
  session: WorkoutSession;
  completedCount: number;
  bandColours: BandColour[];
  onActualChange: (values: SetValues) => void;
  onComplete: (progression?: PlannedSetProgression) => void;
  onExit: () => void;
}) {
  const [progression, setProgression] = useState<PlannedSetProgression>(() => getInitialProgression(set));

  return (
    <section className="focused-workout-screen active-set-screen">
      <article className="active-set-panel">
        <div className="active-set-heading">
          <div>
            <p className="eyebrow">Current set</p>
            <h1>{set.exerciseName}</h1>
            <p>
              Set {set.setNumber} of {session.snapshot.exercises[set.exerciseIndex]?.sets.length ?? set.setNumber}
            </p>
          </div>
          <span className="active-set-index">{completedCount + 1}</span>
        </div>

        <TargetSummary set={set} bandColours={bandColours} />
        <ActualSetEditor set={set} bandColours={bandColours} progression={progression} onChange={onActualChange} onProgressionChange={setProgression} />

        <div className="active-set-actions">
          <button className="complete-button focused-complete-button" type="button" onClick={() => onComplete(progression)}>
            <Check size={18} />
            Complete set
          </button>
          <button className="ghost-button focused-exit-button" type="button" onClick={onExit}>
            Exit Workout
          </button>
        </div>
      </article>
    </section>
  );
}

function getInitialProgression(set: SessionSet): PlannedSetProgression {
  if (set.mode === 'weighted_reps') return { weightKg: set.target.weightKg };
  if (set.mode === 'band_reps') return { bandColourIds: [...(set.target.bandColourIds ?? [])] };
  return {};
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
        <ValueTile label={set.tracksSides ? 'Target reps each side' : 'Target reps'} value={String(set.target.reps ?? 0)} />
      </section>
    );
  }

  return (
    <section className="target-summary two" aria-label="Target">
      <ValueTile label="Target weight" value={`${set.target.weightKg ?? 0} kg`} />
      <ValueTile label={set.tracksSides ? 'Target reps each side' : 'Target reps'} value={String(set.target.reps ?? 0)} />
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
  onProgressionChange: (values: PlannedSetProgression) => void;
}) {
  function patch(next: Partial<SetValues>) {
    onChange({ ...set.actual, ...next });
  }

  function patchProgression(next: Partial<PlannedSetProgression>) {
    onProgressionChange({ ...progression, ...next });
  }

  function patchSideReps(side: 'left' | 'right', value: number) {
    const targetReps = set.target.reps ?? 0;
    const leftReps = side === 'left' ? value : set.actual.leftReps ?? set.actual.reps ?? targetReps;
    const rightReps = side === 'right' ? value : set.actual.rightReps ?? set.actual.reps ?? targetReps;
    patch({
      leftReps,
      rightReps,
      reps: Math.min(leftReps, rightReps),
    });
  }

  const repControls = set.tracksSides ? (
    <div className="side-rep-grid">
      <WheelPicker label="Left reps" value={set.actual.leftReps ?? set.actual.reps ?? set.target.reps ?? 0} max={getRepWheelMax(set)} onChange={(reps) => patchSideReps('left', reps)} />
      <WheelPicker label="Right reps" value={set.actual.rightReps ?? set.actual.reps ?? set.target.reps ?? 0} max={getRepWheelMax(set)} onChange={(reps) => patchSideReps('right', reps)} />
    </div>
  ) : (
    <WheelPicker label="Attained reps" value={set.actual.reps ?? 0} max={getRepWheelMax(set)} onChange={(reps) => patch({ reps })} />
  );

  if (set.mode === 'timed_hold') {
    return <WheelPicker label="Attained seconds" value={set.actual.seconds ?? 0} max={300} onChange={(seconds) => patch({ seconds })} />;
  }

  if (set.mode === 'band_reps') {
    return (
      <section className="actual-editor">
        {repControls}
        <p className="eyebrow">Plan progression</p>
        <div className="band-picker" aria-label="New band">
          {bandColours.map((band) => {
            const active = progression.bandColourIds?.includes(band.id) ?? false;
            return (
              <button
                key={band.id}
                type="button"
                className={active ? 'band-swatch active' : 'band-swatch'}
                style={{ '--band-color': band.hex } as React.CSSProperties}
                aria-label={band.name}
                title={band.name}
                onClick={() => {
                  const current = progression.bandColourIds ?? [];
                  patchProgression({
                    bandColourIds: active ? current.filter((id) => id !== band.id) : [...current, band.id],
                  });
                }}
              />
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="actual-editor weighted-actual-editor">
      {repControls}
      <label className="compact-field">
        New weight
        <input
          className="numeric-input"
          style={getNumericInputStyle(progression.weightKg)}
          aria-label="New weight"
          type="number"
          min={0}
          step={0.5}
          value={progression.weightKg ?? ''}
          onChange={(event) => patchProgression({ weightKg: parseOptionalNumber(event.target.value) })}
        />
      </label>
    </section>
  );
}

function WheelPicker({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  const options = value > max ? [...getWheelValues(max), value] : getWheelValues(max);

  return (
    <label className="wheel-field">
      <span>{label}</span>
      <select className="wheel-picker" size={5} aria-label={label} value={String(value)} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SetValueEditor({
  mode,
  values,
  bandColours,
  onChange,
  disabled,
}: {
  mode: MetricMode;
  values: SetValues;
  bandColours: BandColour[];
  onChange: (values: SetValues) => void;
  disabled?: boolean;
}) {
  function patch(next: Partial<SetValues>) {
    onChange({ ...values, ...next });
  }

  if (mode === 'timed_hold') {
    return (
      <label className="compact-field">
        Seconds
        <input
          className="numeric-input"
          style={getNumericInputStyle(values.seconds)}
          disabled={disabled}
          type="number"
          min={0}
          value={values.seconds ?? ''}
          onChange={(event) => patch({ seconds: parseOptionalNumber(event.target.value) })}
        />
      </label>
    );
  }

  if (mode === 'band_reps') {
    return (
      <div className="value-editor">
        <label className="compact-field">
          Reps
          <input
            className="numeric-input"
            style={getNumericInputStyle(values.reps)}
            disabled={disabled}
            type="number"
            min={0}
            value={values.reps ?? ''}
            onChange={(event) => patch({ reps: parseOptionalNumber(event.target.value) })}
          />
        </label>
        <div className="band-picker" aria-label="Band colours">
          {bandColours.map((band) => {
            const active = values.bandColourIds?.includes(band.id) ?? false;
            return (
              <button
                key={band.id}
                type="button"
                className={active ? 'band-swatch active' : 'band-swatch'}
                style={{ '--band-color': band.hex } as React.CSSProperties}
                aria-label={band.name}
                title={band.name}
                disabled={disabled}
                onClick={() => {
                  const current = values.bandColourIds ?? [];
                  patch({
                    bandColourIds: active ? current.filter((id) => id !== band.id) : [...current, band.id],
                  });
                }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="value-editor two">
      <label className="compact-field">
        Kg
        <input
          className="numeric-input"
          style={getNumericInputStyle(values.weightKg)}
          disabled={disabled}
          type="number"
          min={0}
          step={0.5}
          value={values.weightKg ?? ''}
          onChange={(event) => patch({ weightKg: parseOptionalNumber(event.target.value) })}
        />
      </label>
      <label className="compact-field">
        Reps
        <input
          className="numeric-input"
          style={getNumericInputStyle(values.reps)}
          disabled={disabled}
          type="number"
          min={0}
          value={values.reps ?? ''}
          onChange={(event) => patch({ reps: parseOptionalNumber(event.target.value) })}
        />
      </label>
    </div>
  );
}

interface ExerciseSummary {
  exercise: TemplateExercise;
  completedSets: SessionSet[];
  history: Array<{ sessionId: string; date: string; values: string }>;
  weightTrend: Array<{ date: string; weightKg: number }>;
  personalBests: string[];
  plateau?: string;
}

function ProgressPage() {
  const { data, saveData } = useTracker();
  const [selectedDayId, setSelectedDayId] = useState(data.template.days[0]?.id ?? '');
  const selectedDay = data.template.days.find((day) => day.id === selectedDayId) ?? data.template.days[0];
  const [selectedExerciseId, setSelectedExerciseId] = useState(selectedDay?.exercises[0]?.id ?? '');
  const selectedExercise = selectedDay?.exercises.find((exercise) => exercise.id === selectedExerciseId) ?? selectedDay?.exercises[0];
  const daySessions = selectedDay ? getSessionsForDay(data.sessions, selectedDay) : [];
  const exerciseSummaries = selectedDay?.exercises.map((exercise) => buildExerciseSummary(exercise, daySessions, data.bandColours)) ?? [];
  const selectedSummary = exerciseSummaries.find((summary) => summary.exercise.id === selectedExercise?.id) ?? exerciseSummaries[0];

  function chooseDay(day: TemplateDay) {
    setSelectedDayId(day.id);
    setSelectedExerciseId(day.exercises[0]?.id ?? '');
  }

  function deleteSession(sessionId: string) {
    const session = data.sessions.find((item) => item.id === sessionId);
    if (!session) return;

    const confirmed = window.confirm(`Delete the ${session.label} session from ${formatDate(session.startedAt)}? This removes its progress data from this device.`);
    if (!confirmed) return;

    saveData((current) => ({
      ...current,
      sessions: current.sessions.filter((item) => item.id !== sessionId),
    }));
  }

  if (!selectedDay) {
    return (
      <div className="page-stack">
        <PageTitle eyebrow="Progress" title="Exercise history" text="Create a workout plan to start tracking progress." />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Progress" title="Exercise history" text="Select a day, then review each assigned exercise with PBs, history, and plateau signals." />

      <div className="day-tabs">
        {data.template.days.map((day) => (
          <button key={day.id} className={day.id === selectedDay.id ? 'active' : ''} type="button" onClick={() => chooseDay(day)}>
            {day.label}
          </button>
        ))}
      </div>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Assigned exercises</p>
            <h2>{selectedDay.label}</h2>
          </div>
          <span className="summary-pill">{daySessions.length} sessions</span>
        </div>

        <div className="exercise-summary-grid">
          {exerciseSummaries.map((summary) => (
            <button
              key={summary.exercise.id}
              className={summary.exercise.id === selectedSummary?.exercise.id ? 'exercise-summary-card active' : 'exercise-summary-card'}
              type="button"
              onClick={() => setSelectedExerciseId(summary.exercise.id)}
            >
              <strong>{summary.exercise.name}</strong>
              <span>{summary.personalBests[0] ?? 'No PB yet'}</span>
              <small>
                {summary.completedSets.length} completed sets
                {summary.plateau ? ' - Plateau flagged' : ''}
              </small>
            </button>
          ))}
        </div>
      </section>

      {selectedSummary && (
        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Selected exercise</p>
              <h2>{selectedSummary.exercise.name}</h2>
            </div>
            <span className="summary-pill">{formatModeLabel(selectedSummary.exercise.mode)}</span>
          </div>

          <div className="progress-detail-grid">
            <div className="progress-panel">
              <h3>Personal bests</h3>
              {selectedSummary.personalBests.length ? (
                <div className="result-list compact">
                  {selectedSummary.personalBests.map((best) => (
                    <div className="result-row" key={best}>
                      <span>{best}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No PB yet" text="Complete this exercise in a finished workout to create a baseline." />
              )}
            </div>

            <div className={selectedSummary.plateau ? 'progress-panel warning-panel' : 'progress-panel'}>
              <h3>Plateau</h3>
              {selectedSummary.plateau ? (
                <p>{selectedSummary.plateau}</p>
              ) : (
                <p className="muted-text">No plateau detected for this exercise.</p>
              )}
            </div>
          </div>

          <div className="history-list">
            <h3>Weight over time</h3>
            {selectedSummary.weightTrend.length ? (
              <WeightTrendChart data={selectedSummary.weightTrend} />
            ) : (
              <EmptyState title="No weight trend yet" text="Weight charts appear for completed weight-based sets." />
            )}
          </div>

          <div className="history-list">
            <h3>Progress history</h3>
            {selectedSummary.history.length ? (
              <div className="result-list compact">
                {selectedSummary.history.map((entry) => (
                  <div className="history-row" key={`${entry.sessionId}-${entry.values}`}>
                    <strong>{entry.date}</strong>
                    <span>{entry.values}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No history yet" text="Completed sessions for this exercise will appear here." />
            )}
          </div>
        </section>
      )}

      <section className="section-block">
        <div className="section-heading">
          <h2>Session history</h2>
        </div>
        {data.sessions.length ? (
          <div className="result-list">
            {data.sessions.map((session) => (
              <div className="session-history-row" key={session.id}>
                <div>
                  <strong>{session.label}</strong>
                  <span>
                    {formatDate(session.startedAt)} - {session.sets.filter((set) => set.completedAt).length} sets
                  </span>
                </div>
                <button className="icon-button danger" type="button" aria-label={`Delete ${session.label} session from ${formatDate(session.startedAt)}`} onClick={() => deleteSession(session.id)}>
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No sessions saved" text="Finished workouts will appear here." />
        )}
      </section>
    </div>
  );
}

function getSessionsForDay(sessions: WorkoutSession[], day: TemplateDay): WorkoutSession[] {
  return sessions
    .filter((session) => session.completedAt && (session.templateDayId === day.id || session.label === day.label))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function buildExerciseSummary(exercise: TemplateExercise, daySessions: WorkoutSession[], bandColours: BandColour[]): ExerciseSummary {
  const completedSets = daySessions.flatMap((session) => session.sets.filter((set) => set.completedAt && set.exerciseName === exercise.name));
  const plateaus = detectPlateaus(daySessions);
  const plateau = plateaus.find((item) => item.exerciseName === exercise.name && item.mode === exercise.mode);

  return {
    exercise,
    completedSets,
    weightTrend: buildWeightTrend(exercise, daySessions),
    personalBests: getPersonalBestLabels(exercise.mode, completedSets, bandColours),
    plateau: plateau ? `No improvement across ${plateau.appearances} recent completed appearances.` : undefined,
    history: daySessions
      .map((session) => ({
        sessionId: session.id,
        date: formatDate(session.startedAt),
        values: session.sets
          .filter((set) => set.completedAt && set.exerciseName === exercise.name)
          .map((set) => formatSetActual(set, bandColours))
          .join(' | '),
      }))
      .filter((entry) => entry.values),
  };
}

function buildWeightTrend(exercise: TemplateExercise, daySessions: WorkoutSession[]): Array<{ date: string; weightKg: number }> {
  if (exercise.mode !== 'weighted_reps') return [];

  return [...daySessions]
    .reverse()
    .map((session) => {
      const weights = session.sets.filter((set) => set.completedAt && set.exerciseName === exercise.name && set.actual.weightKg !== undefined).map((set) => set.actual.weightKg ?? 0);
      return {
        date: formatShortDate(session.startedAt),
        weightKg: Math.max(0, ...weights),
      };
    })
    .filter((entry) => entry.weightKg > 0);
}

function WeightTrendChart({ data }: { data: Array<{ date: string; weightKg: number }> }) {
  const width = 320;
  const height = 160;
  const padding = 28;
  const min = Math.min(...data.map((point) => point.weightKg));
  const max = Math.max(...data.map((point) => point.weightKg));
  const range = Math.max(max - min, 1);
  const points = data.map((point, index) => {
    const x = data.length === 1 ? width / 2 : padding + (index / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.weightKg - min) / range) * (height - padding * 2);
    return { ...point, x, y };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <div className="weight-chart" aria-label="Weight over time chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} />
        <polyline points={polyline} />
        {points.map((point) => (
          <g key={`${point.date}-${point.weightKg}`}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text x={point.x} y={point.y - 9} textAnchor="middle">
              {point.weightKg}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-labels">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function getPersonalBestLabels(mode: MetricMode, sets: SessionSet[], bandColours: BandColour[]): string[] {
  if (!sets.length) return [];

  if (mode === 'weighted_reps') {
    const heaviest = [...sets].sort((a, b) => (b.actual.weightKg ?? 0) - (a.actual.weightKg ?? 0))[0];
    const bestVolume = [...sets].sort((a, b) => (b.actual.weightKg ?? 0) * (b.actual.reps ?? 0) - (a.actual.weightKg ?? 0) * (a.actual.reps ?? 0))[0];
    return [`Load PB: ${heaviest.actual.weightKg ?? 0} kg x ${formatActualReps(heaviest)}`, `Volume PB: ${((bestVolume.actual.weightKg ?? 0) * (bestVolume.actual.reps ?? 0)).toFixed(1)} kg`];
  }

  if (mode === 'timed_hold') {
    const longest = [...sets].sort((a, b) => (b.actual.seconds ?? 0) - (a.actual.seconds ?? 0))[0];
    return [`Time PB: ${longest.actual.seconds ?? 0}s`];
  }

  const bestBandSet = [...sets].sort((a, b) => {
    const scoreA = (a.actual.bandColourIds?.length ?? 0) * 100 + (a.actual.reps ?? 0);
    const scoreB = (b.actual.bandColourIds?.length ?? 0) * 100 + (b.actual.reps ?? 0);
    return scoreB - scoreA;
  })[0];
  return [`Band PB: ${formatBandNames(bestBandSet.actual.bandColourIds ?? [], bandColours)} x ${formatActualReps(bestBandSet)}`];
}

function formatSetActual(set: SessionSet, bandColours: BandColour[]): string {
  if (set.mode === 'weighted_reps') return `${set.actual.weightKg ?? 0} kg x ${formatActualReps(set)}`;
  if (set.mode === 'timed_hold') return `${set.actual.seconds ?? 0}s`;
  return `${formatBandNames(set.actual.bandColourIds ?? [], bandColours)} x ${formatActualReps(set)}`;
}

function formatActualReps(set: SessionSet): string {
  if (!set.tracksSides) return String(set.actual.reps ?? 0);
  const leftReps = set.actual.leftReps ?? set.actual.reps ?? 0;
  const rightReps = set.actual.rightReps ?? set.actual.reps ?? 0;
  return `L${leftReps}/R${rightReps}`;
}

function formatBandNames(ids: string[], bandColours: BandColour[]): string {
  if (!ids.length) return 'No band';
  return ids.map((id) => bandColours.find((band) => band.id === id)?.name ?? 'Unknown').join(' + ');
}

function formatModeLabel(mode: MetricMode): string {
  if (mode === 'weighted_reps') return 'Weight';
  if (mode === 'timed_hold') return 'Time';
  return 'Bands';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SettingsPage() {
  const { data, saveData } = useTracker();
  const [bandName, setBandName] = useState('');
  const [bandHex, setBandHex] = useState('#6f42c1');
  const [bandMessage, setBandMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [dataMessage, setDataMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const isDarkMode = data.settings.theme === 'dark';

  function addBand() {
    const trimmedName = bandName.trim();
    if (!trimmedName) {
      setBandMessage({ tone: 'error', text: 'Enter a band name.' });
      return;
    }

    if (data.bandColours.some((band) => band.name.toLowerCase() === trimmedName.toLowerCase())) {
      setBandMessage({ tone: 'error', text: 'A band with that name already exists.' });
      return;
    }

    saveData((current) => ({
      ...current,
      bandColours: [...current.bandColours, { id: createId('band'), name: trimmedName, hex: bandHex }],
    }));
    setBandName('');
    setBandMessage({ tone: 'success', text: `${trimmedName} added.` });
  }

  async function importJsonFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const result = parseJsonImport(await file.text(), LOCAL_USER_ID);
    if (!result.ok) {
      setDataMessage({ tone: 'error', text: result.error });
      return;
    }

    await resetOfflineData(LOCAL_USER_ID);
    saveData(() => result.data);
    setDataMessage({ tone: 'success', text: 'JSON import restored.' });
  }

  async function resetData() {
    const confirmed = window.confirm('Reset all local ExerciseTracker data on this device? This removes workouts, plan edits, active workout progress, and band colours.');
    if (!confirmed) return;

    await resetOfflineData(LOCAL_USER_ID);
    saveData(() => createDefaultAppData(LOCAL_USER_ID));
    setDataMessage({ tone: 'success', text: 'Local data reset.' });
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Settings" title="Bands and data" text="Manage resistance band colours and export your workout records." />

      <section className="section-block">
        <div className="section-heading">
          <h2>Display</h2>
        </div>
        <label className="switch-row">
          <span className="switch-label">
            {isDarkMode ? <Moon size={20} /> : <Sun size={20} />}
            Dark mode
          </span>
          <input
            type="checkbox"
            checked={isDarkMode}
            onChange={(event) =>
              saveData((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  theme: event.target.checked ? 'dark' : 'light',
                },
              }))
            }
          />
        </label>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Band colours</h2>
        </div>
        <div className="band-list">
          {data.bandColours.map((band) => (
            <div className="band-row" key={band.id}>
              <span className="band-dot" style={{ '--band-color': band.hex } as React.CSSProperties} />
              <strong>{band.name}</strong>
              <button
                className="icon-button danger"
                type="button"
                aria-label={`Remove ${band.name}`}
                onClick={() =>
                  saveData((current) => ({
                    ...current,
                    bandColours: current.bandColours.filter((item) => item.id !== band.id),
                  }))
                }
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
        <div className="add-band-form">
          <label>
            Name
            <input
              value={bandName}
              onChange={(event) => {
                setBandName(event.target.value);
                setBandMessage(undefined);
              }}
              placeholder="Purple"
            />
          </label>
          <label>
            Colour
            <input
              value={bandHex}
              onChange={(event) => {
                setBandHex(event.target.value);
                setBandMessage(undefined);
              }}
              type="color"
            />
          </label>
          <button className="secondary-button" type="button" onClick={addBand}>
            <Palette size={18} />
            Add
          </button>
        </div>
        {bandMessage && <p className={bandMessage.tone === 'error' ? 'form-message' : 'success-message'}>{bandMessage.text}</p>}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Data</h2>
        </div>
        {dataMessage && <p className={dataMessage.tone === 'error' ? 'form-message' : 'success-message'}>{dataMessage.text}</p>}
        <div className="export-actions">
          <button className="secondary-button" type="button" onClick={() => downloadTextFile('exercise-tracker-export.json', createJsonExport(data), 'application/json')}>
            <Download size={18} />
            JSON
          </button>
          <button className="secondary-button" type="button" onClick={() => downloadTextFile('exercise-tracker-sessions.csv', createCsvExport(data.sessions), 'text/csv')}>
            <Download size={18} />
            CSV
          </button>
          <label className="file-button">
            <Upload size={18} />
            Import JSON
            <input type="file" accept="application/json,.json" aria-label="Import JSON export" onChange={importJsonFile} />
          </label>
          <button className="ghost-button danger" type="button" onClick={resetData}>
            <RotateCcw size={18} />
            Reset
          </button>
        </div>
      </section>
    </div>
  );
}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <section className="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export default App;
