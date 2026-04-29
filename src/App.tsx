import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
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
  Save,
  Settings,
  SkipForward,
  Sun,
  TimerReset,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { detectPlateaus } from './domain/analytics';
import { getTemplateDayForToday } from './domain/calendar';
import { createJsonExport, createCsvExport, downloadTextFile } from './domain/export';
import { createId } from './domain/ids';
import { createDefaultAppData } from './domain/sampleData';
import { formatDuration } from './domain/rest';
import { completeSessionIfDone, completeSet, createActiveRest, createSessionFromDay, logRestEvent, uncompleteSet } from './domain/session';
import type {
  ActiveRest,
  AppData,
  BandColour,
  MetricMode,
  SessionSet,
  SetValues,
  TemplateDay,
  TemplateExercise,
  WorkoutSession,
} from './domain/types';
import { validateSetValues } from './domain/validation';
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
  const todayDay = getTemplateDayForToday(data.template);
  const workoutPath = todayDay ? `/workout/${todayDay.id}` : '/workout';

  return (
    <div className="app-shell">
      <header className="top-bar">
        <NavLink to="/" className="brand-link" aria-label="ExerciseTracker home">
          <span className="brand-mark">
            <Dumbbell size={24} />
          </span>
          <span>ExerciseTracker</span>
        </NavLink>
        <span className="storage-pill">Local-first</span>
      </header>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/workout/:dayId" element={<WorkoutPage />} />
          <Route path="/workout" element={<WorkoutPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <nav className="bottom-nav" aria-label="Primary">
        <NavItem to="/" icon={<Home size={20} />} label="Home" />
        <NavItem to="/plan" icon={<Dumbbell size={20} />} label="Plan" />
        <NavItem to={workoutPath} icon={<Activity size={20} />} label="Workout" />
        <NavItem to="/progress" icon={<BarChart3 size={20} />} label="Progress" />
        <NavItem to="/settings" icon={<Settings size={20} />} label="Settings" />
      </nav>
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
      sets: current.sets.map((set) => ({
        ...set,
        target: getDefaultTargetForMode(mode, exerciseIndex, bandColours, set.target),
      })),
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
  const [selectedExerciseIndex, setSelectedExerciseIndex] = useState<number | undefined>();
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

  function completeWorkoutSet(set: SessionSet) {
    const errors = validateSetValues(set.mode, set.actual);
    if (errors.length) {
      window.alert(errors.join('\n'));
      return;
    }

    saveData((current) => {
      if (!current.activeWorkout) return current;
      const completed = completeSet(current.activeWorkout.session, set.id, set.actual);
      const activeRest = createActiveRest(completed, set.id);
      return {
        ...current,
        activeWorkout: {
          session: completeSessionIfDone(completed),
          activeRest,
        },
      };
    });
  }

  function uncompleteWorkoutSet(set: SessionSet) {
    saveData((current) => {
      if (!current.activeWorkout) return current;
      return {
        ...current,
        activeWorkout: {
          session: uncompleteSet(current.activeWorkout.session, set.id),
          activeRest: undefined,
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
          session: next.session,
          activeRest: next.activeRest,
        },
      };
    });
  }

  function finishWorkout() {
    saveData((current) => {
      const completed = current.activeWorkout?.session;
      if (!completed?.completedAt) return current;
      void queueCompletedSession({
        id: createId('sync'),
        userId: current.userId,
        createdAt: new Date().toISOString(),
        type: 'session_completed',
        payload: completed,
      });

      return {
        ...current,
        sessions: [completed, ...current.sessions],
        activeWorkout: undefined,
      };
    });
    navigate('/progress');
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
  const isComplete = completedCount === session.sets.length;
  const currentExerciseIndex = getCurrentExerciseIndex(session, selectedExerciseIndex);
  const currentExercise = session.snapshot.exercises[currentExerciseIndex];
  const currentSets = session.sets.filter((set) => set.exerciseIndex === currentExerciseIndex);

  return (
    <div className="page-stack workout-page">
      <section className="workout-header">
        <div>
          <p className="eyebrow">Active workout</p>
          <h1>{session.label}</h1>
          <p>
            {completedCount} of {session.sets.length} sets completed
          </p>
        </div>
        {isComplete && (
          <button className="primary-button" type="button" onClick={finishWorkout}>
            <Save size={18} />
            Finish
          </button>
        )}
      </section>

      {activeWorkout?.activeRest && (
        <RestPanel
          rest={activeWorkout.activeRest}
          session={session}
          onSkip={() =>
            updateRest((currentSession, rest) => ({
              session: logRestEvent(currentSession, rest, true),
              activeRest: undefined,
            }))
          }
          onComplete={() =>
            updateRest((currentSession, rest) => ({
              session: rest.completed ? currentSession : logRestEvent(currentSession, rest, false),
              activeRest: { ...rest, completed: true },
            }))
          }
          onDismiss={() =>
            updateRest((currentSession) => ({
              session: currentSession,
              activeRest: undefined,
            }))
          }
        />
      )}

      <ExerciseProgressStrip session={session} currentExerciseIndex={currentExerciseIndex} onSelect={setSelectedExerciseIndex} />

      {currentExercise && (
        <article className="exercise-card current-exercise-card">
          <div className="workout-exercise-heading">
            <span className="exercise-index">{currentExerciseIndex + 1}</span>
            <div>
              <p className="eyebrow">Current exercise</p>
              <h2>{currentExercise.name}</h2>
              <small>{currentExerciseIndex === 0 ? '3 minute rests' : '2 minute rests'}</small>
            </div>
          </div>

          <div className="workout-set-list">
            {currentSets.map((set) => (
              <div className={set.completedAt ? 'workout-set complete' : 'workout-set'} key={set.id}>
                <div className="set-title">
                  <strong>Set {set.setNumber}</strong>
                  {set.completedAt && <Check size={18} />}
                </div>
                <SetValueEditor mode={set.mode} values={set.actual} bandColours={data.bandColours} onChange={(actual) => updateActual(set.id, actual)} disabled={Boolean(set.completedAt)} />
                {set.completedAt ? (
                  <button className="undo-button" type="button" onClick={() => uncompleteWorkoutSet(set)}>
                    <Undo2 size={17} />
                    Uncomplete
                  </button>
                ) : (
                  <button className="complete-button" type="button" onClick={() => completeWorkoutSet(set)}>
                    <Check size={17} />
                    Complete set
                  </button>
                )}
              </div>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}

function ExerciseProgressStrip({
  session,
  currentExerciseIndex,
  onSelect,
}: {
  session: WorkoutSession;
  currentExerciseIndex: number;
  onSelect: (exerciseIndex: number) => void;
}) {
  return (
    <section className="exercise-progress" aria-label="Exercise progress">
      {session.snapshot.exercises.map((exercise, index) => {
        const sets = session.sets.filter((set) => set.exerciseIndex === index);
        const isDone = sets.every((set) => set.completedAt);
        const isCurrent = index === currentExerciseIndex;
        return (
          <button className={isCurrent ? 'exercise-step current' : isDone ? 'exercise-step done' : 'exercise-step'} key={exercise.id} type="button" onClick={() => onSelect(index)}>
            <span>{index + 1}</span>
            <strong>{exercise.name}</strong>
            <small>
              {sets.filter((set) => set.completedAt).length}/{sets.length}
            </small>
          </button>
        );
      })}
    </section>
  );
}

function getCurrentExerciseIndex(session: WorkoutSession, selectedExerciseIndex?: number): number {
  if (selectedExerciseIndex !== undefined) {
    const selectedSets = session.sets.filter((set) => set.exerciseIndex === selectedExerciseIndex);
    if (selectedSets.some((set) => !set.completedAt) || session.sets.every((set) => set.completedAt)) {
      return selectedExerciseIndex;
    }
  }

  const firstIncompleteSet = session.sets.find((set) => !set.completedAt);
  if (firstIncompleteSet) return firstIncompleteSet.exerciseIndex;
  return Math.max(0, session.snapshot.exercises.length - 1);
}

function getNumericInputStyle(value: number | undefined): React.CSSProperties {
  return { '--digits': String(value ?? 0).length } as React.CSSProperties;
}

function RestPanel({
  rest,
  session,
  onSkip,
  onComplete,
  onDismiss,
}: {
  rest: ActiveRest;
  session: WorkoutSession;
  onSkip: () => void;
  onComplete: () => void;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((new Date(rest.endsAt).getTime() - Date.now()) / 1000)));
  const nextSet = session.sets.find((set) => set.id === rest.nextSetId);

  useEffect(() => {
    if (rest.completed) return;

    const interval = window.setInterval(() => {
      const nextRemaining = Math.max(0, Math.ceil((new Date(rest.endsAt).getTime() - Date.now()) / 1000));
      setRemaining(nextRemaining);
      if (nextRemaining === 0) {
        window.clearInterval(interval);
        playRestAlarm();
        onComplete();
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [onComplete, rest.completed, rest.endsAt]);

  return (
    <section className={rest.completed ? 'rest-panel done' : 'rest-panel'}>
      <div className="rest-timer">
        <Clock3 size={24} />
        <strong>{rest.completed ? 'Ready' : formatDuration(remaining)}</strong>
      </div>
      <div>
        <p className="eyebrow">{rest.completed ? 'Rest complete' : 'Recovery'}</p>
        <h2>{nextSet ? `${nextSet.exerciseName} - Set ${nextSet.setNumber}` : 'Next set'}</h2>
      </div>
      {rest.completed ? (
        <button className="primary-button" type="button" onClick={onDismiss}>
          Begin set
        </button>
      ) : (
        <button className="ghost-button" type="button" onClick={onSkip}>
          <SkipForward size={17} />
          Skip
        </button>
      )}
    </section>
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
          value={values.seconds ?? 0}
          onChange={(event) => patch({ seconds: Number(event.target.value) })}
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
            value={values.reps ?? 0}
            onChange={(event) => patch({ reps: Number(event.target.value) })}
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
          value={values.weightKg ?? 0}
          onChange={(event) => patch({ weightKg: Number(event.target.value) })}
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
          value={values.reps ?? 0}
          onChange={(event) => patch({ reps: Number(event.target.value) })}
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
    return [`Load PB: ${heaviest.actual.weightKg ?? 0} kg x ${heaviest.actual.reps ?? 0}`, `Volume PB: ${((bestVolume.actual.weightKg ?? 0) * (bestVolume.actual.reps ?? 0)).toFixed(1)} kg`];
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
  return [`Band PB: ${formatBandNames(bestBandSet.actual.bandColourIds ?? [], bandColours)} x ${bestBandSet.actual.reps ?? 0}`];
}

function formatSetActual(set: SessionSet, bandColours: BandColour[]): string {
  if (set.mode === 'weighted_reps') return `${set.actual.weightKg ?? 0} kg x ${set.actual.reps ?? 0}`;
  if (set.mode === 'timed_hold') return `${set.actual.seconds ?? 0}s`;
  return `${formatBandNames(set.actual.bandColourIds ?? [], bandColours)} x ${set.actual.reps ?? 0}`;
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
  const [dataMessage, setDataMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const isDarkMode = data.settings.theme === 'dark';

  function addBand() {
    if (!bandName.trim()) return;
    saveData((current) => ({
      ...current,
      bandColours: [...current.bandColours, { id: createId('band'), name: bandName.trim(), hex: bandHex }],
    }));
    setBandName('');
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
            <input value={bandName} onChange={(event) => setBandName(event.target.value)} placeholder="Purple" />
          </label>
          <label>
            Colour
            <input value={bandHex} onChange={(event) => setBandHex(event.target.value)} type="color" />
          </label>
          <button className="secondary-button" type="button" onClick={addBand}>
            <Palette size={18} />
            Add
          </button>
        </div>
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
