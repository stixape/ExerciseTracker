export type MetricMode = 'weighted_reps' | 'timed_hold' | 'band_reps';
export type ThemeMode = 'light' | 'dark';

export interface BandColour {
  id: string;
  name: string;
  hex: string;
}

export interface SetValues {
  weightKg?: number;
  reps?: number;
  leftReps?: number;
  rightReps?: number;
  seconds?: number;
  bandColourIds?: string[];
}

export interface TemplateSet {
  id: string;
  setNumber: number;
  target: SetValues;
}

export interface TemplateExercise {
  id: string;
  name: string;
  mode: MetricMode;
  tracksSides?: boolean;
  sets: TemplateSet[];
}

export interface TemplateDay {
  id: string;
  weekday: number;
  label: string;
  exercises: TemplateExercise[];
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
  tracksSides?: boolean;
  target: SetValues;
  actual: SetValues;
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
}

export interface AppData {
  userId: string;
  template: WorkoutTemplate;
  bandColours: BandColour[];
  sessions: WorkoutSession[];
  activeWorkout?: ActiveWorkout;
  settings: {
    theme: ThemeMode;
  };
}

export interface QueuedSyncItem {
  id: string;
  userId: string;
  createdAt: string;
  type: 'session_completed';
  payload: WorkoutSession;
}

export interface PersonalBest {
  exerciseName: string;
  mode: MetricMode;
  label: string;
  value: number;
  achievedAt: string;
}

export interface Plateau {
  exerciseName: string;
  mode: MetricMode;
  appearances: number;
  latestScore: number;
}
