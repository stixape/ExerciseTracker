import type { TemplateDay, WorkoutTemplate } from './types';

export function getTodayWeekday(date = new Date()): number {
  return date.getDay();
}

export function getTemplateDayForToday(template: WorkoutTemplate, date = new Date()): TemplateDay | undefined {
  const weekday = getTodayWeekday(date);
  return template.days.find((day) => day.weekday === weekday) ?? template.days[0];
}
