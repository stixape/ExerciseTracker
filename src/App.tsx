import { useEffect, useId, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  ChevronDown,
  Check,
  Download,
  Dumbbell,
  GripVertical,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
} from 'lucide-react';
import { LOCAL_USER_ID, TrackerProvider, useTracker } from './app/TrackerContext';
import { EmptyState, PageTitle } from './components/PageTitle';
import { calculateSetVolume, detectPlateaus, getPerformedRepCount } from './domain/analytics';
import { archiveBandColour, reorderBandColours } from './domain/bands';
import { getTemplateDayForToday, getTodayWeekday, weekdayName } from './domain/calendar';
import { createCsvExport, downloadTextFile } from './domain/export';
import { createId } from './domain/ids';
import { createDefaultAppData } from './domain/sampleData';
import { createSessionFromDay, updateExerciseNotes } from './domain/session';
import { changeModifierValue, MAX_REST_SECONDS, modifierValue } from './domain/modifiers';
import type {
  BandColour,
  MetricMode,
  Modifier,
  SessionSet,
  SetValues,
  TemplateDay,
  TemplateExercise,
  WorkoutSession,
} from './domain/types';
import { primeAlarmAudio } from './lib/alarm';
import { BackupPanel } from './components/BackupPanel';
import { ValidatedInput } from './components/ValidatedInput';
import { ExerciseNotes } from './components/ExerciseNotes';
import { ModifierInput } from './components/ModifierInput';
import { formatActualReps, formatBandNames, formatPlannedValues, formatSetActual } from './lib/workoutFormatting';
import { WorkoutPage } from './features/workout/WorkoutPage';

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
  const landing = location.pathname === '/workout';
  const hideWorkoutChrome = location.pathname === '/workout/active';
  const routeName = location.pathname.startsWith('/plan')
    ? 'Plan'
    : location.pathname.startsWith('/workout')
      ? 'Workout'
      : location.pathname.startsWith('/progress')
        ? 'Progress'
        : location.pathname.startsWith('/settings')
          ? 'Settings'
          : 'Workout';
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
    <div className={hideWorkoutChrome ? 'app-shell workout-focus-shell' : landing ? 'app-shell workout-landing-shell' : 'app-shell'}>
      <main ref={mainRef} id="main-content" className={hideWorkoutChrome ? 'main-content workout-focus-main' : landing ? 'main-content workout-landing-main' : 'main-content'}>
        <Routes>
          <Route path="/" element={<Navigate replace to="/workout" />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/workout/:dayId" element={<Navigate replace to="/workout" />} />
          <Route path="/workout/active" element={<WorkoutPage />} />
          <Route path="/workout" element={<WorkoutLanding />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate replace to="/workout" />} />
        </Routes>
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {data.activeWorkout ? `${completedSets} of ${totalSets} workout sets completed.` : `${routeName} page.`}
      </p>

      {!hideWorkoutChrome && (
        <nav className="bottom-nav" aria-label="Primary">
          <NavItem to="/workout" icon={<Activity size={20} />} label="Workout" />
          <NavItem to="/plan" icon={<Dumbbell size={20} />} label="Plan" />
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

function WorkoutLanding() {
  const { data, saveData } = useTracker();
  const navigate = useNavigate();
  const [today, setToday] = useState(() => new Date());
  const todayWeekday = getTodayWeekday(today);
  const scheduledDay = getTemplateDayForToday(data.template, today);
  const active = data.activeWorkout?.session;
  const day = active?.snapshot ?? scheduledDay;
  const canStart = Boolean(scheduledDay?.exercises.some((exercise) => exercise.sets.length));
  const completed = active?.sets.filter((set) => set.completedAt).length;

  useEffect(() => {
    let timer: number;
    function refresh() {
      const now = new Date();
      setToday(now);
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, midnight.getTime() - now.getTime());
    }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  async function startToday() {
    const currentDay = getTemplateDayForToday(data.template);
    if (!currentDay?.exercises.some((exercise) => exercise.sets.length)) return;
    primeAlarmAudio();
    const session = createSessionFromDay({ ...currentDay, label: weekdayName(currentDay.weekday) });
    if (await saveData((current) => current.activeWorkout ? current : { ...current, activeWorkout: { session } })) {
      navigate('/workout/active');
    }
  }

  return (
    <section className="overview-band workout-landing" aria-labelledby="today-heading">
      <header>
        <p className="eyebrow">{active && day?.weekday !== todayWeekday ? 'Workout in progress' : 'Today'}</p>
        <h1 id="today-heading">{day ? weekdayName(day.weekday) : 'Rest day'}</h1>
        {active && <p>{completed} of {active.sets.length} sets complete</p>}
        {!day && <p>{weekdayName(todayWeekday)} · Nothing is scheduled today.</p>}
        {day && !active && !canStart && <p>Add an exercise to start today’s workout.</p>}
      </header>
      {day && day.exercises.length > 0 && (
        <ol className="today-plan" aria-label="Planned exercises" tabIndex={0}>
          {day.exercises.map((exercise) => {
            const targets = exercise.sets.map((set) => formatPlannedValues(exercise.mode, set.target, data.bandColours, exercise.modifiers));
            const uniform = targets.every((target) => target === targets[0]);
            return (
              <li key={exercise.id}>
                <strong>{exercise.name}</strong>
                <p>{targets.length} {targets.length === 1 ? 'set' : 'sets'}{uniform && targets[0] ? ` · ${targets[0]}` : ''}</p>
                {!uniform && <ul>{targets.map((target, index) => (
                  <li key={exercise.sets[index].id}>Set {exercise.sets[index].setNumber} · {target}</li>
                ))}</ul>}
              </li>
            );
          })}
        </ol>
      )}
      <footer className="today-action">
        {active ? (
          <button className="primary-button" type="button" onClick={() => navigate('/workout/active')}>
            <Play size={18} /> Resume workout
          </button>
        ) : canStart ? (
          <button className="primary-button" type="button" onClick={() => void startToday()}>
            <Play size={18} /> Start workout
          </button>
        ) : day && <NavLink className="secondary-button" to="/plan">Edit plan</NavLink>}
      </footer>
    </section>
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
    const confirmed = window.confirm(`Remove ${exercise.name} and all of its planned sets from ${weekdayName(selectedDay.weekday)}?`);
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
    return <><h1 className="sr-only">Plan</h1><EmptyState title="No plan days" text="Create a template day to start building workouts." /></>;
  }

  return (
    <div className="page-stack">
      <h1 className="sr-only">Plan</h1>

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
            {weekdayName(day.weekday)}
          </button>
        ))}
      </div>

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
            onSaveNotes={(notes) => saveData((current) => updateExerciseNotes(current, selectedDay.id, exercise.id, notes))}
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
  if (mode === 'other') return {};
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
    bandColourIds: existing.bandColourIds?.length ? existing.bandColourIds : [bandColours.find((band) => !band.archived)?.id].filter((id): id is string => Boolean(id)),
  };
}

function PlanExerciseEditor({
  exercise,
  exerciseIndex,
  bandColours,
  onChange,
  onSaveNotes,
  onRemove,
}: {
  exercise: TemplateExercise;
  exerciseIndex: number;
  bandColours: BandColour[];
  onChange: (updater: (exercise: TemplateExercise) => TemplateExercise) => void;
  onSaveNotes: (notes?: string) => Promise<boolean>;
  onRemove: () => void;
}) {
  function changeMode(mode: MetricMode) {
    onChange((current) => current.mode === mode ? current : ({
      ...current,
      mode,
      modifiers: undefined,
      sets: current.sets.map((set) => ({
        ...set,
        target: getDefaultTargetForMode(mode, exerciseIndex, bandColours, set.target),
      })),
    }));
  }

  function addModifier() {
    onChange((current) => {
      const fields = current.modifiers ?? [];
      if (current.mode !== 'other' || fields.length >= 2) return current;
      const label = fields.some((field) => field.label === 'Modifier 2') ? 'Modifier 1' : `Modifier ${fields.length + 1}`;
      return { ...current, modifiers: [...fields, { id: createId('modifier'), label, type: 'number' }] };
    });
  }

  function updateModifier(id: string, replacement?: Modifier) {
    onChange((current) => {
      const modifiers = (current.modifiers ?? []).flatMap((field) => field.id === id ? replacement ?? [] : field);
      if (replacement?.id === id) return { ...current, modifiers };
      const sets = current.sets.map((set) => ({
        ...set,
        target: { ...set.target, modifiers: changeModifierValue(set.target.modifiers, id, undefined) },
      }));
      return { ...current, modifiers, sets };
    });
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
            <ValidatedInput
              aria-label={`Exercise ${exerciseIndex + 1} name`}
              value={exercise.name}
              onValue={(name) => onChange((current) => ({ ...current, name }))}
            />
          </label>
          <button type="button" className="icon-button danger" onClick={onRemove} aria-label={`Remove ${exercise.name}`}>
            <Trash2 size={17} />
          </button>
        </div>

        <label className="inline-label">
          Rest Time (minutes)
          <ValidatedInput type="number" optional min={0} max={MAX_REST_SECONDS / 60} step="any"
            value={exercise.restSeconds === undefined ? undefined : Number((exercise.restSeconds / 60).toFixed(4))}
            onValue={(value) => onChange((current) => ({ ...current, restSeconds: value === '' ? undefined : Math.round(Number(value) * 60) }))} />
        </label>

        <div className="segmented-control" role="group" aria-label={`Metric for ${exercise.name}`}>
          {(['weighted_reps', 'band_reps', 'timed_hold', 'other'] as const).map((mode) => (
            <button key={mode} type="button" className={exercise.mode === mode ? 'active' : ''}
              aria-pressed={exercise.mode === mode} onClick={() => changeMode(mode)}>
              {formatModeLabel(mode)}
            </button>
          ))}
        </div>

        {exercise.mode === 'other' && (
          <div className="modifier-definitions">
            {(exercise.modifiers ?? []).map((field, index) => (
              <div className="modifier-definition" key={field.id}>
                <label>{`Modifier ${index + 1} label`}
                  <ValidatedInput value={field.label} onValue={(label) => updateModifier(field.id, { ...field, label })} />
                </label>
                <label>{`Modifier ${index + 1} type`}
                  <select value={field.type} onChange={(event) => updateModifier(field.id, { ...field, id: createId('modifier'), type: event.target.value as Modifier['type'] })}>
                    <option value="number">Number</option>
                    <option value="text">Text</option>
                  </select>
                </label>
                <button className="icon-button danger" type="button" onClick={() => updateModifier(field.id)}
                  aria-label={`Remove modifier ${field.label}`}><Trash2 size={16} /></button>
              </div>
            ))}
            {(exercise.modifiers?.length ?? 0) < 2 && <button className="small-button" type="button" onClick={addModifier}>
              <Plus size={16} /> Add modifier
            </button>}
          </div>
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
                    onClick={() => {
                      onChange((current) => current.sets.length <= 1 ? current : ({
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
                modifiers={exercise.modifiers}
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

        <ExerciseNotes notes={exercise.notes} onSave={onSaveNotes} />
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

function SetValueEditor({
  mode,
  modifiers,
  values,
  bandColours,
  onChange,
  disabled,
}: {
  mode: MetricMode;
  modifiers?: Modifier[];
  values: SetValues;
  bandColours: BandColour[];
  onChange: (values: SetValues) => void;
  disabled?: boolean;
}) {
  function patch(next: Partial<SetValues>) {
    onChange({ ...values, ...next });
  }

  if (mode === 'other') {
    return <div className="value-editor modifier-values">{(modifiers ?? []).map((field) => (
      <ModifierInput key={field.id} field={field} label={`Target ${field.label}`} value={modifierValue(values.modifiers, field.id)}
        onChange={(value) => patch({ modifiers: changeModifierValue(values.modifiers, field.id, value) })} />
    ))}</div>;
  }

  if (mode === 'timed_hold') {
    return (
      <label className="compact-field">
        Seconds
        <ValidatedInput
          className="numeric-input"
          style={getNumericInputStyle(values.seconds)}
          disabled={disabled}
          type="number"
          min={0}
          value={values.seconds ?? ''}
          whole onValue={(value) => patch({ seconds: Number(value) })}
        />
      </label>
    );
  }

  if (mode === 'band_reps') {
    return (
      <div className="value-editor">
        <label className="compact-field">
          Repetitions
          <ValidatedInput
            className="numeric-input"
            style={getNumericInputStyle(values.reps)}
            disabled={disabled}
            type="number"
            min={0}
            value={values.reps ?? ''}
            whole onValue={(value) => patch({ reps: Number(value) })}
          />
        </label>
        <div className="band-picker" aria-label="Band colours">
          {bandColours.filter((band) => !band.archived || values.bandColourIds?.includes(band.id)).map((band) => {
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
        KG
        <ValidatedInput
          className="numeric-input"
          style={getNumericInputStyle(values.weightKg)}
          disabled={disabled}
          type="number"
          min={0}
          step={0.5}
          value={values.weightKg ?? ''}
          onValue={(value) => patch({ weightKg: Number(value) })}
        />
      </label>
      <label className="compact-field">
        Repetitions
        <ValidatedInput
          className="numeric-input"
          style={getNumericInputStyle(values.reps)}
          disabled={disabled}
          type="number"
          min={0}
          value={values.reps ?? ''}
          whole onValue={(value) => patch({ reps: Number(value) })}
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
            {weekdayName(day.weekday)}
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
        <div className="metric-grid">
          <MetricTile label="Completed sessions" value={data.sessions.filter((session) => session.completedAt).length} />
          <MetricTile label="Completed sets" value={data.sessions.reduce((total, session) => total + session.sets.filter((set) => set.completedAt).length, 0)} />
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
                  <details className="recorded-session">
                    <summary>View recorded sets</summary>
                    {session.snapshot.exercises.map((exercise) => <div key={exercise.id}>
                      <strong>{exercise.name}</strong>
                      {exercise.notes && <p className="recorded-notes">{exercise.notes}</p>}
                      {session.sets.filter((set) => set.exerciseId === exercise.id).map((set) => <p key={set.id}>Set {set.setNumber}: {formatSetActual(set, data.bandColours, exercise.modifiers)}</p>)}
                    </div>)}
                  </details>
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
          .map((set) => formatSetActual(set, bandColours, session.snapshot.exercises[set.exerciseIndex]?.modifiers))
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
  return set.mode === exercise.mode && (set.exerciseId ? set.exerciseId === exercise.id : set.exerciseName === exercise.name);
}

function getPersonalBestLabels(mode: MetricMode, sets: SessionSet[], bandColours: BandColour[]): string[] {
  if (!sets.length || mode === 'other') return [];

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
  if (mode === 'other') return 'Other';
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
  const [draggingBandId, setDraggingBandId] = useState<string>();

  async function addBand() {
    const trimmedName = bandName.trim();
    if (!trimmedName) {
      setBandMessage({ tone: 'error', text: 'Enter a band name.' });
      return;
    }

    if (data.bandColours.some((band) => band.name.toLowerCase() === trimmedName.toLowerCase())) {
      setBandMessage({ tone: 'error', text: 'A band with that name already exists. If archived, restore it below.' });
      return;
    }

    if (trimmedName.length > 500 || data.bandColours.length >= 100) {
      setBandMessage({ tone: 'error', text: 'Use a name up to 500 characters. The palette supports 100 bands including archives.' });
      return;
    }
    const saved = await saveData((current) => ({
      ...current,
      bandColours: [...current.bandColours, { id: createId('band'), name: trimmedName, hex: bandHex }],
    }));
    if (saved) setBandName('');
    setBandMessage({ tone: saved ? 'success' : 'error', text: saved ? `${trimmedName} added.` : 'The new band could not be saved. Its name was kept.' });
  }

  function removeBand(band: BandColour) {
    if (!window.confirm(`Archive the ${band.name} band colour? It will be hidden from new selections. Existing plans and workout history will keep their recorded band values.`)) return;
    void saveData((current) => archiveBandColour(current, band.id)).then((saved) => {
      setBandMessage({ tone: saved ? 'success' : 'error', text: saved ? `${band.name} archived. Existing records were preserved.` : 'Band change could not be saved.' });
    });
  }

  function moveBand(bandId: string, targetBandId: string) {
    if (bandId === targetBandId) return;
    void saveData((current) => ({
      ...current,
      bandColours: reorderBandColours(current.bandColours, bandId, targetBandId),
    })).then((saved) => setBandMessage({ tone: saved ? 'success' : 'error', text: saved ? 'Band colour order saved.' : 'Band order could not be saved.' }));
  }

  function moveBandByOffset(bandId: string, offset: -1 | 1) {
    const activeBands = data.bandColours.filter((band) => !band.archived);
    const index = activeBands.findIndex((band) => band.id === bandId);
    const target = activeBands[index + offset];
    if (!target) return;
    moveBand(bandId, target.id);
  }

  function setHideRestTimes(hideRestTimes: boolean) {
    saveData((current) => ({
      ...current,
      settings: { hideRestTimes },
      ...(hideRestTimes && current.activeWorkout?.activeRest
        ? { activeWorkout: { ...current.activeWorkout, activeRest: undefined } }
        : {}),
    }));
  }

  async function resetData() {
    const confirmed = window.confirm('Replace the current plan, workouts and settings with a starter plan? Recovery checkpoints and independent backups will be kept. Remote uploads will pause.');
    if (!confirmed) return;

    const reset = await replaceData(createDefaultAppData(LOCAL_USER_ID), 'reset');
    setDataMessage(reset ? { tone: 'success', text: 'Local data reset.' } : { tone: 'error', text: 'Local data could not be reset.' });
  }

  return (
    <div className="page-stack">
      <h1 className="sr-only">Settings</h1>

      <section className="section-block">
        <div className="section-heading">
          <h2>Workout</h2>
        </div>
        <label className="toggle-setting">
          <span>
            <strong>Hide rest times</strong>
            <small>Go straight to the next set after completing one, without showing the rest countdown.</small>
          </span>
          <input
            type="checkbox"
            checked={data.settings.hideRestTimes}
            onChange={(event) => setHideRestTimes(event.target.checked)}
          />
        </label>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Band colours</h2>
        </div>
        <p className="muted-text band-order-help">Drag the handle to set the order used in plans and workouts.</p>
        <div className="band-list">
          {data.bandColours.filter((band) => !band.archived).map((band) => (
            <div
              className={draggingBandId === band.id ? 'band-row dragging' : 'band-row'}
              key={band.id}
              data-band-id={band.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const bandId = event.dataTransfer.getData('text/plain') || draggingBandId;
                if (bandId) moveBand(bandId, band.id);
                setDraggingBandId(undefined);
              }}
            >
              <button
                className="band-drag-handle"
                type="button"
                draggable
                aria-label={`Reorder ${band.name}; drag or use the arrow keys`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', band.id);
                  setDraggingBandId(band.id);
                }}
                onDragEnd={() => setDraggingBandId(undefined)}
                onPointerDown={(event) => {
                  if (event.pointerType === 'mouse') return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDraggingBandId(band.id);
                }}
                onPointerMove={(event) => {
                  if (event.pointerType === 'mouse' || draggingBandId !== band.id) return;
                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.band-row');
                  const targetBandId = target?.dataset.bandId;
                  if (targetBandId) moveBand(band.id, targetBandId);
                }}
                onPointerUp={(event) => {
                  if (event.pointerType === 'mouse') return;
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  setDraggingBandId(undefined);
                }}
                onPointerCancel={() => setDraggingBandId(undefined)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault();
                  moveBandByOffset(band.id, event.key === 'ArrowUp' ? -1 : 1);
                }}
              >
                <GripVertical size={18} aria-hidden="true" />
              </button>
              <span className="band-dot" style={{ '--band-color': band.hex } as React.CSSProperties} />
              <strong>{band.name}</strong>
              <button
                className="icon-button danger"
                type="button"
                aria-label={`Archive ${band.name}`}
                onClick={() => removeBand(band)}
              >
            <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
        {data.bandColours.some((band) => band.archived) && <details>
          <summary>Archived band colours</summary>
          {data.bandColours.filter((band) => band.archived).map((band) => <button type="button" key={band.id} className="ghost-button" onClick={() => void saveData((current) => ({ ...current, bandColours: current.bandColours.map((item) => item.id === band.id ? { ...item, archived: false } : item) }))}>Restore {band.name} band</button>)}
        </details>}
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
          <button className="secondary-button" type="button" onClick={() => downloadTextFile('exercise-tracker-sessions.csv', createCsvExport(data.sessions), 'text/csv')}>
            <Download size={18} />
            CSV
          </button>
          <button className="ghost-button danger" type="button" onClick={resetData}>
            <RotateCcw size={18} />
            Reset
          </button>
        </div>
      </section>
      <BackupPanel />
    </div>
  );
}

export default App;
