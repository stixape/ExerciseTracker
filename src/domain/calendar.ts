import type { TemplateDay, WorkoutTemplate } from './types';

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
