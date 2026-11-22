export type MetricMode = 'weighted_reps' | 'timed_hold' | 'band_reps' | 'other';

export interface Modifier {
  id: string;
  label: string;
  type: 'number' | 'text';
}

export type ModifierValue = number | string;

export interface BandColour {
  id: string;
  name: string;
  hex: string;
  /** Hide from new selections without rewriting historical records. */
  archived?: boolean;
}

export interface SetValues {
  weightKg?: number;
  reps?: number;
  seconds?: number;
  bandColourIds?: string[];
  modifiers?: Record<string, ModifierValue>;
}

export interface TemplateSet {
  id: string;
  setNumber: number;
  target: SetValues;
  /** Optional upper end for planned reps or seconds. The numeric target stores the lower end. */
  rangeMax?: number;
}

export interface TemplateExercise {
  id: string;
  name: string;
  mode: MetricMode;
  restSeconds?: number;
  notes?: string;
  modifiers?: Modifier[];
  sets: TemplateSet[];
}

export interface TemplateDay {
  id: string;
  weekday: number;
  label: string;
  exercises: TemplateExercise[];
}

export interface PlannedSetProgression {
  weightKg?: number;
  reps?: number;
  seconds?: number;
  bandColourIds?: string[];
  /** Null clears a target; an absent key leaves it alone. */
  modifiers?: Record<string, ModifierValue | null>;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  days: TemplateDay[];
}

export interface SessionSet {
  id: string;
  templateSetId: string;
  exerciseId: string;
  exerciseName: string;
  exerciseIndex: number;
  setNumber: number;
  mode: MetricMode;
  target: SetValues;
  actual: SetValues;
  /** A reviewed target for the next workout. It is not applied until the session is saved. */
  proposedNextTarget?: PlannedSetProgression;
  completedAt?: string;
}

export interface RestEvent {
  id: string;
  afterSessionSetId: string;
  exerciseIndex: number;
  setNumber: number;
  durationSeconds: number;
  startedAt: string;
  endedAt?: string;
  skipped: boolean;
}

export interface ActiveRest {
  afterSessionSetId: string;
  durationSeconds: number;
  startedAt: string;
  endsAt: string;
  nextSetId?: string;
  completed: boolean;
}

export interface WorkoutSession {
  id: string;
  templateDayId: string;
  label: string;
  startedAt: string;
  completedAt?: string;
  snapshot: TemplateDay;
  sets: SessionSet[];
  restEvents: RestEvent[];
}

export interface ActiveWorkout {
  session: WorkoutSession;
  activeRest?: ActiveRest;
  selectedExerciseId?: string;
  selectedSetId?: string;
}

export interface AppData {
  userId: string;
  template: WorkoutTemplate;
  bandColours: BandColour[];
  sessions: WorkoutSession[];
  activeWorkout?: ActiveWorkout;
  settings: {
    hideRestTimes: boolean;
  };
}

export interface PersonalBest {
  exerciseId?: string;
  exerciseName: string;
  mode: MetricMode;
  label: string;
  value: number;
  achievedAt: string;
}

export interface Plateau {
  exerciseId?: string;
  exerciseName: string;
  mode: MetricMode;
  appearances: number;
  latestScore: number;
}
