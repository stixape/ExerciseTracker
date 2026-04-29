import type { AppData } from '../domain/types';
import { createDefaultAppData, createDefaultDayForWeekday } from '../domain/sampleData';

const storageKey = (userId: string) => `exercise-tracker:data:${userId}`;

export function loadLocalData(userId: string): AppData {
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return createDefaultAppData(userId);

  try {
    const data = JSON.parse(raw) as AppData;
    return normalizeLocalData(data, userId);
  } catch {
    return createDefaultAppData(userId);
  }
}

function normalizeLocalData(data: AppData, userId: string): AppData {
  const defaultData = createDefaultAppData(userId);
  const baseDays = data.template?.days ?? defaultData.template.days;
  const existingWeekdays = new Set(baseDays.map((day) => day.weekday));
  const missingDays = defaultData.template.days.filter((day) => !existingWeekdays.has(day.weekday));
  const days = [...baseDays, ...missingDays.map((day) => createDefaultDayForWeekday(day.weekday) ?? day)]
    .map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise, exerciseIndex) => ({
        ...exercise,
        sets: exercise.sets.map((set, setIndex) => ({
          ...set,
          setNumber: setIndex + 1,
          target: {
            ...set.target,
            reps:
              exercise.mode === 'weighted_reps' || exercise.mode === 'band_reps'
                ? exerciseIndex === 0
                  ? 5
                  : 10
                : set.target.reps,
          },
        })),
      })),
    }))
    .sort((a, b) => a.weekday - b.weekday);

  return {
    ...data,
    userId,
    bandColours: data.bandColours?.length ? data.bandColours : defaultData.bandColours,
    sessions: data.sessions ?? [],
    settings: {
      ...defaultData.settings,
      ...data.settings,
    },
    template: {
      ...data.template,
      days,
    },
  };
}

export function saveLocalData(data: AppData): void {
  localStorage.setItem(storageKey(data.userId), JSON.stringify(data));
}

export function clearLocalData(userId: string): void {
  localStorage.removeItem(storageKey(userId));
}
