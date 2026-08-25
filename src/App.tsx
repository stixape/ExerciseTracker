import { useEffect, useId, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  ChevronDown,
  Check,
  ChevronRight,
  Download,
  Dumbbell,
  Home,
  Moon,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { LOCAL_USER_ID, TrackerProvider, useTracker } from './app/TrackerContext';
import { EmptyState, PageTitle } from './components/PageTitle';
import { calculateSetVolume, detectPlateaus, getPerformedRepCount } from './domain/analytics';
import { getTemplateDayForToday } from './domain/calendar';
import { createJsonExport, createCsvExport, downloadTextFile } from './domain/export';
import { createId } from './domain/ids';
import { createDefaultAppData } from './domain/sampleData';
import { createSessionFromDay } from './domain/session';
import type {
  BandColour,
  MetricMode,
  SessionSet,
  SetValues,
  TemplateDay,
  TemplateExercise,
  WorkoutSession,
} from './domain/types';
import { primeAlarmAudio } from './lib/alarm';
import { parseJsonImport } from './lib/localData';
import { formatActualReps, formatBandNames, formatSetActual } from './lib/workoutFormatting';
import { WorkoutPage } from './features/workout/WorkoutPage';

const MAX_JSON_IMPORT_BYTES = 25 * 1024 * 1024;

function App() {
  return (
    <TrackerProvider>
      <AppShell />
    </TrackerProvider>
  );
}

function AppShell() {
  const { data } = useTracker();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const todayDay = getTemplateDayForToday(data.template);
  const workoutPath = data.activeWorkout ? '/workout' : todayDay ? `/workout/${todayDay.id}` : '/workout';
  const activeWorkoutPreviewPath = data.activeWorkout ? `/workout/${data.activeWorkout.session.templateDayId}` : undefined;
  const hideWorkoutChrome = Boolean(
    data.activeWorkout && (location.pathname === '/workout' || location.pathname === activeWorkoutPreviewPath),
  );
  const routeName = location.pathname.startsWith('/plan')
    ? 'Plan'
    : location.pathname.startsWith('/workout')
      ? 'Workout'
      : location.pathname.startsWith('/progress')
        ? 'Progress'
        : location.pathname.startsWith('/settings')
          ? 'Settings'
          : 'Today';
  const completedSets = data.activeWorkout?.session.sets.filter((set) => set.completedAt).length ?? 0;
  const totalSets = data.activeWorkout?.session.sets.length ?? 0;

  useEffect(() => {
    document.title = `${routeName} | ExerciseTracker`;
    const frame = window.requestAnimationFrame(() => {
      const heading = mainRef.current?.querySelector<HTMLElement>('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, routeName]);

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

      <main ref={mainRef} id="main-content" className={hideWorkoutChrome ? 'main-content workout-focus-main' : 'main-content'}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/workout/:dayId" element={<WorkoutPage />} />
          <Route path="/workout" element={<WorkoutPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {data.activeWorkout ? `${completedSets} of ${totalSets} workout sets completed.` : `${routeName} page.`}
      </p>

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
  const { data, saveData } = useTracker();
  const navigate = useNavigate();
  const completedSessions = data.sessions.filter((session) => session.completedAt).length;
  const totalCompletedSets = data.sessions.reduce((total, session) => total + session.sets.filter((set) => set.completedAt).length, 0);
  const todayDay = getTemplateDayForToday(data.template);
  const activeSession = data.activeWorkout?.session;
  const activeCompletedSets = activeSession?.sets.filter((set) => set.completedAt).length ?? 0;
  const activeTotalSets = activeSession?.sets.length ?? 0;

  function startToday() {
    if (!todayDay) return;
    if (!todayDay.exercises.length || !todayDay.exercises.some((exercise) => exercise.sets.length)) {
      navigate(`/workout/${todayDay.id}`);
      return;
    }
    saveData((current) => ({ ...current, activeWorkout: { session: createSessionFromDay(todayDay) } }));
    primeAlarmAudio();
    navigate('/workout');
  }

  return (
    <div className="page-stack">
      <section className="overview-band">
        <div>
          <p className="eyebrow">Today</p>
          <h1>{activeSession?.label ?? todayDay?.label ?? 'Rest day'}</h1>
          <p>
            {activeSession
              ? `${activeCompletedSets} of ${activeTotalSets} sets complete`
              : todayDay
                ? `${todayDay.exercises.length} exercises planned`
                : 'Nothing is scheduled today. Recover well or choose another workout.'}
          </p>
        </div>
        {activeSession ? (
          <button className="primary-button" type="button" onClick={() => navigate('/workout')}>
            <Play size={18} />
            Resume workout
          </button>
        ) : todayDay ? (
          <button className="primary-button" type="button" onClick={startToday}>
            <Play size={18} />
            Start workout
          </button>
        ) : (
          <button className="ghost-button hero-ghost-button" type="button" onClick={() => navigate('/workout')}>
            Choose a workout
          </button>
        )}
      </section>

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
  const [lastRemoved, setLastRemoved] = useState<{ dayId: string; exercise: TemplateExercise; index: number }>();
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

  function removeExercise(exercise: TemplateExercise, exerciseIndex: number) {
    if (!selectedDay) return;
    const confirmed = window.confirm(`Remove ${exercise.name} and all of its planned sets from ${selectedDay.label}?`);
    if (!confirmed) return;

    setLastRemoved({ dayId: selectedDay.id, exercise: structuredClone(exercise), index: exerciseIndex });
    updateDay(selectedDay.id, (day) => ({
      ...day,
      exercises: day.exercises.filter((item) => item.id !== exercise.id),
    }));
  }

  function undoRemoveExercise() {
    if (!lastRemoved) return;
    updateDay(lastRemoved.dayId, (day) => {
      const exercises = [...day.exercises];
      exercises.splice(Math.min(lastRemoved.index, exercises.length), 0, lastRemoved.exercise);
      return { ...day, exercises };
    });
    setSelectedDayId(lastRemoved.dayId);
    setLastRemoved(undefined);
  }

  if (!selectedDay) {
    return <EmptyState title="No plan days" text="Create a template day to start building workouts." />;
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Plan" title="Weekly workouts" text="Choose a day, then expand only the exercises you want to edit." />

      <div className="day-tabs" role="tablist" aria-label="Workout days">
        {data.template.days.map((day) => (
          <button
            key={day.id}
            className={day.id === selectedDay.id ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={day.id === selectedDay.id}
            onClick={() => setSelectedDayId(day.id)}
          >
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

      {lastRemoved && (
        <section className="status-strip" role="status">
          <Check size={22} aria-hidden="true" />
          <div>
            <strong>{lastRemoved.exercise.name} removed</strong>
            <span>You can undo this while you stay on the Plan page.</span>
          </div>
          <button type="button" className="ghost-button" onClick={undoRemoveExercise}>
            Undo
          </button>
        </section>
      )}

      <div className="exercise-list">
        {selectedDay.exercises.map((exercise, exerciseIndex) => (
          <PlanExerciseEditor
            key={exercise.id}
            exercise={exercise}
            exerciseIndex={exerciseIndex}
            bandColours={data.bandColours}
            onChange={(updater) => updateExercise(exercise.id, updater)}
            onRemove={() => removeExercise(exercise, exerciseIndex)}
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
    <details className="exercise-card plan-exercise-card">
      <summary className="plan-exercise-summary">
        <span className="exercise-index">{exerciseIndex + 1}</span>
        <span>
          <strong>{exercise.name}</strong>
          <small>
            {formatModeLabel(exercise.mode)} · {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'}
          </small>
        </span>
        <ChevronDown size={20} aria-hidden="true" />
      </summary>

      <div className="plan-exercise-body">
        <div className="card-heading">
          <label className="exercise-name-field">
            Exercise name
            <input
              aria-label={`Exercise ${exerciseIndex + 1} name`}
              value={exercise.name}
              onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <button type="button" className="icon-button danger" onClick={onRemove} aria-label={`Remove ${exercise.name}`}>
            <Trash2 size={17} />
          </button>
        </div>

        <div className="segmented-control" role="group" aria-label={`Metric for ${exercise.name}`}>
          <button
            className={exercise.mode === 'weighted_reps' ? 'active' : ''}
            type="button"
            aria-pressed={exercise.mode === 'weighted_reps'}
            onClick={() => changeMode('weighted_reps')}
          >
            Weight
          </button>
          <button
            className={exercise.mode === 'timed_hold' ? 'active' : ''}
            type="button"
            aria-pressed={exercise.mode === 'timed_hold'}
            onClick={() => changeMode('timed_hold')}
          >
            Time
          </button>
          <button
            className={exercise.mode === 'band_reps' ? 'active' : ''}
            type="button"
            aria-pressed={exercise.mode === 'band_reps'}
            onClick={() => changeMode('band_reps')}
          >
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
                  onClick={() => {
                    if (!window.confirm(`Remove set ${set.setNumber} from ${exercise.name}?`)) return;
                    onChange((current) => ({
                      ...current,
                      sets: current.sets
                        .filter((item) => item.id !== set.id)
                        .map((item, index) => ({
                          ...item,
                          setNumber: index + 1,
                        })),
                    }));
                  }}
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
      </div>
    </details>
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
                aria-label={`${band.name} band`}
                aria-pressed={active}
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

      <div className="day-tabs" role="tablist" aria-label="Progress workout days">
        {data.template.days.map((day) => (
          <button
            key={day.id}
            className={day.id === selectedDay.id ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={day.id === selectedDay.id}
            onClick={() => chooseDay(day)}
          >
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
              aria-pressed={summary.exercise.id === selectedSummary?.exercise.id}
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
    .filter(
      (session) => session.completedAt && (session.templateDayId ? session.templateDayId === day.id : session.label === day.label),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function buildExerciseSummary(exercise: TemplateExercise, daySessions: WorkoutSession[], bandColours: BandColour[]): ExerciseSummary {
  const completedSets = daySessions.flatMap((session) => session.sets.filter((set) => set.completedAt && setMatchesExercise(set, exercise)));
  const plateaus = detectPlateaus(daySessions);
  const plateau = plateaus.find(
    (item) => item.mode === exercise.mode && (item.exerciseId ? item.exerciseId === exercise.id : item.exerciseName === exercise.name),
  );

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
          .filter((set) => set.completedAt && setMatchesExercise(set, exercise))
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
      const weights = session.sets
        .filter((set) => set.completedAt && setMatchesExercise(set, exercise) && set.actual.weightKg !== undefined)
        .map((set) => set.actual.weightKg ?? 0);
      return {
        date: formatShortDate(session.startedAt),
        weightKg: Math.max(0, ...weights),
      };
    })
    .filter((entry) => entry.weightKg > 0);
}

function WeightTrendChart({ data }: { data: Array<{ date: string; weightKg: number }> }) {
  const captionId = useId();
  const chartTitleId = useId();
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
    <figure className="weight-chart" aria-labelledby={captionId}>
      <figcaption id={captionId}>Heaviest completed weight by workout date</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={chartTitleId}>
        <title id={chartTitleId}>Weight trend from {points[0]?.date} to {points[points.length - 1]?.date}</title>
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
      <details className="chart-data">
        <summary>View chart data</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point, index) => (
              <tr key={`${point.date}-${point.weightKg}-${index}`}>
                <td>{point.date}</td>
                <td>{point.weightKg} kg</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function setMatchesExercise(set: SessionSet, exercise: TemplateExercise): boolean {
  return set.exerciseId ? set.exerciseId === exercise.id : set.exerciseName === exercise.name;
}

function getPersonalBestLabels(mode: MetricMode, sets: SessionSet[], bandColours: BandColour[]): string[] {
  if (!sets.length) return [];

  if (mode === 'weighted_reps') {
    const heaviest = [...sets].sort((a, b) => (b.actual.weightKg ?? 0) - (a.actual.weightKg ?? 0))[0];
    const bestVolume = [...sets].sort((a, b) => calculateSetVolume(b) - calculateSetVolume(a))[0];
    return [`Load PB: ${heaviest.actual.weightKg ?? 0} kg x ${formatActualReps(heaviest)}`, `Volume PB: ${calculateSetVolume(bestVolume).toFixed(1)} kg·reps`];
  }

  if (mode === 'timed_hold') {
    const longest = [...sets].sort((a, b) => (b.actual.seconds ?? 0) - (a.actual.seconds ?? 0))[0];
    return [`Time PB: ${longest.actual.seconds ?? 0}s`];
  }

  const bestBandSet = [...sets].sort((a, b) => {
    const scoreA = (a.actual.bandColourIds?.length ?? 0) * 100 + getPerformedRepCount(a);
    const scoreB = (b.actual.bandColourIds?.length ?? 0) * 100 + getPerformedRepCount(b);
    return scoreB - scoreA;
  })[0];
  return [`Band PB: ${formatBandNames(bestBandSet.actual.bandColourIds ?? [], bandColours)} x ${formatActualReps(bestBandSet)}`];
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
  const { data, saveData, replaceData } = useTracker();
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

  function removeBand(band: BandColour) {
    const referencedInTemplate = data.template.days.some((day) =>
      day.exercises.some((exercise) => exercise.sets.some((set) => set.target.bandColourIds?.includes(band.id))),
    );
    const referencedInSessions = [...data.sessions, ...(data.activeWorkout ? [data.activeWorkout.session] : [])].some((session) =>
      session.sets.some(
        (set) =>
          set.target.bandColourIds?.includes(band.id) ||
          set.actual.bandColourIds?.includes(band.id) ||
          set.proposedNextTarget?.bandColourIds?.includes(band.id),
      ),
    );
    if (referencedInTemplate || referencedInSessions) {
      setBandMessage({ tone: 'error', text: `${band.name} is used by a plan or workout and cannot be removed.` });
      return;
    }
    if (!window.confirm(`Remove the ${band.name} band colour?`)) return;
    saveData((current) => ({
      ...current,
      bandColours: current.bandColours.filter((item) => item.id !== band.id),
    }));
    setBandMessage({ tone: 'success', text: `${band.name} removed.` });
  }

  async function importJsonFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size > MAX_JSON_IMPORT_BYTES) {
      setDataMessage({ tone: 'error', text: 'JSON import is larger than the 25 MB safety limit.' });
      return;
    }

    const result = parseJsonImport(await file.text(), LOCAL_USER_ID);
    if (!result.ok) {
      setDataMessage({ tone: 'error', text: result.error });
      return;
    }

    const restored = await replaceData(result.data);
    setDataMessage(
      restored
        ? { tone: 'success', text: 'JSON import restored.' }
        : { tone: 'error', text: 'JSON import was valid, but could not be saved on this device.' },
    );
  }

  async function resetData() {
    const confirmed = window.confirm('Reset all local ExerciseTracker data on this device? This removes workouts, plan edits, active workout progress, and band colours.');
    if (!confirmed) return;

    const reset = await replaceData(createDefaultAppData(LOCAL_USER_ID));
    setDataMessage(reset ? { tone: 'success', text: 'Local data reset.' } : { tone: 'error', text: 'Local data could not be reset.' });
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Settings" title="Bands and data" text="Manage resistance band colours and export your workout records." />

      <section className="section-block">
        <div className="section-heading">
          <h2>Display</h2>
        </div>
        <div className="appearance-setting">
          <p className="muted-text">Light is the default. Choose dark when you prefer lower brightness.</p>
          <div className="segmented-control appearance-control" role="group" aria-label="Colour mode">
            <button
              className={isDarkMode ? '' : 'active'}
              type="button"
              aria-pressed={!isDarkMode}
              onClick={() =>
                saveData((current) => ({ ...current, settings: { ...current.settings, theme: 'light' } }))
              }
            >
              <Sun size={18} aria-hidden="true" />
              Light
            </button>
            <button
              className={isDarkMode ? 'active' : ''}
              type="button"
              aria-pressed={isDarkMode}
              onClick={() =>
                saveData((current) => ({ ...current, settings: { ...current.settings, theme: 'dark' } }))
              }
            >
              <Moon size={18} aria-hidden="true" />
              Dark
            </button>
          </div>
        </div>
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
                onClick={() => removeBand(band)}
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

export default App;
