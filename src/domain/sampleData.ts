import { createId } from './ids';
import type { AppData, BandColour, MetricMode, TemplateDay, TemplateExercise, TemplateSet, WorkoutTemplate } from './types';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const starterExercises: Array<Array<{ name: string; mode: MetricMode; weight?: number; reps?: number; seconds?: number }>> = [
  [
    { name: 'Back Squat', mode: 'weighted_reps', weight: 60, reps: 5 },
    { name: 'Romanian Deadlift', mode: 'weighted_reps', weight: 45, reps: 10 },
    { name: 'Walking Lunge', mode: 'weighted_reps', weight: 12, reps: 10 },
    { name: 'Wall Sit', mode: 'timed_hold', seconds: 45 },
    { name: 'Band Lateral Walk', mode: 'band_reps', reps: 10 },
  ],
  [
    { name: 'Bench Press', mode: 'weighted_reps', weight: 40, reps: 5 },
    { name: 'Incline Dumbbell Press', mode: 'weighted_reps', weight: 18, reps: 10 },
    { name: 'Shoulder Press', mode: 'weighted_reps', weight: 20, reps: 10 },
    { name: 'Plank', mode: 'timed_hold', seconds: 60 },
    { name: 'Band Triceps Pressdown', mode: 'band_reps', reps: 10 },
  ],
  [
    { name: 'Deadlift', mode: 'weighted_reps', weight: 80, reps: 5 },
    { name: 'Lat Pulldown', mode: 'weighted_reps', weight: 45, reps: 10 },
    { name: 'Seated Row', mode: 'weighted_reps', weight: 40, reps: 10 },
    { name: 'Hollow Hold', mode: 'timed_hold', seconds: 35 },
    { name: 'Band Face Pull', mode: 'band_reps', reps: 10 },
  ],
  [
    { name: 'Front Squat', mode: 'weighted_reps', weight: 45, reps: 5 },
    { name: 'Hip Thrust', mode: 'weighted_reps', weight: 70, reps: 10 },
    { name: 'Leg Press', mode: 'weighted_reps', weight: 100, reps: 10 },
    { name: 'Side Plank', mode: 'timed_hold', seconds: 40 },
    { name: 'Band Glute Bridge', mode: 'band_reps', reps: 10 },
  ],
  [
    { name: 'Overhead Press', mode: 'weighted_reps', weight: 30, reps: 6 },
    { name: 'Pull Variation', mode: 'weighted_reps', weight: 35, reps: 10 },
    { name: 'Dumbbell Row', mode: 'weighted_reps', weight: 24, reps: 10 },
    { name: 'Farmer Hold', mode: 'timed_hold', seconds: 45 },
    { name: 'Band Curl', mode: 'band_reps', reps: 10 },
  ],
  [
    { name: 'Pause Bench Press', mode: 'weighted_reps', weight: 35, reps: 5 },
    { name: 'Goblet Squat', mode: 'weighted_reps', weight: 22, reps: 10 },
    { name: 'Cable Row', mode: 'weighted_reps', weight: 35, reps: 10 },
    { name: 'Dead Hang', mode: 'timed_hold', seconds: 40 },
    { name: 'Band Pull Apart', mode: 'band_reps', reps: 10 },
  ],
];

export const defaultBandColours: BandColour[] = [
  { id: 'band_yellow', name: 'Yellow', hex: '#f4c542' },
  { id: 'band_red', name: 'Red', hex: '#d64242' },
  { id: 'band_green', name: 'Green', hex: '#2f9e60' },
  { id: 'band_blue', name: 'Blue', hex: '#2d6cdf' },
  { id: 'band_black', name: 'Black', hex: '#242424' },
];

function createTemplateSet(setNumber: number, mode: MetricMode, values: { weight?: number; reps?: number; seconds?: number }): TemplateSet {
  const bandColourIds = mode === 'band_reps' ? ['band_red'] : undefined;

  return {
    id: createId('template_set'),
    setNumber,
    target: {
      weightKg: mode === 'weighted_reps' ? values.weight : undefined,
      reps: mode === 'weighted_reps' || mode === 'band_reps' ? values.reps : undefined,
      seconds: mode === 'timed_hold' ? values.seconds : undefined,
      bandColourIds,
    },
  };
}

function createExercise(input: { name: string; mode: MetricMode; weight?: number; reps?: number; seconds?: number }): TemplateExercise {
  return {
    id: createId('exercise'),
    name: input.name,
    mode: input.mode,
    sets: [1, 2, 3].map((setNumber) => createTemplateSet(setNumber, input.mode, input)),
  };
}

function createDay(label: string, weekday: number, index: number): TemplateDay {
  return {
    id: createId('day'),
    label,
    weekday,
    exercises: starterExercises[index].map(createExercise),
  };
}

export function createDefaultDayForWeekday(weekday: number): TemplateDay | undefined {
  const index = weekday - 1;
  const label = weekdays[index];
  if (!label || !starterExercises[index]) return undefined;
  return createDay(label, weekday, index);
}

export function createDefaultTemplate(): WorkoutTemplate {
  return {
    id: createId('template'),
    name: 'Weekly Strength Plan',
    days: weekdays.map((label, index) => createDay(label, index + 1, index)),
  };
}

export function createDefaultAppData(userId = 'demo-user'): AppData {
  return {
    userId,
    template: createDefaultTemplate(),
    bandColours: defaultBandColours,
    sessions: [],
    settings: {
      theme: 'light',
    },
  };
}
