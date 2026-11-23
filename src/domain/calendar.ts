import type { TemplateDay, WorkoutSession, WorkoutTemplate } from './types';

export function localWorkoutDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
}

export function sessionWorkoutDate(session: WorkoutSession): string {
  return session.workoutDate ?? localWorkoutDate(new Date(session.startedAt));
}

export function hasSavedWorkoutOn(sessions: WorkoutSession[], date: Date): boolean {
  const today = localWorkoutDate(date);
  return sessions.some((session) => session.completedAt && sessionWorkoutDate(session) === today);
}

export function getTodayWeekday(date = new Date()): number {
  return date.getDay() || 7;
}

export function weekdayName(weekday: number): string {
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][weekday - 1];
}

export function getTemplateDayForToday(template: WorkoutTemplate, date = new Date()): TemplateDay | undefined {
  const weekday = getTodayWeekday(date);
  return template.days.find((day) => day.weekday === weekday);
}
