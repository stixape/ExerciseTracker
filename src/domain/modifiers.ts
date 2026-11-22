import type { Modifier, SetValues } from './types';

export const MAX_REST_SECONDS = 24 * 60 * 60;
export const MAX_NOTE_LENGTH = 4000;

export function modifierValue<T>(values: Record<string, T> | undefined, id: string): T | undefined {
  return values && Object.hasOwn(values, id) ? values[id] : undefined;
}

export function changeModifierValue<T>(values: Record<string, T> | undefined, id: string, value: T | undefined) {
  if (value !== undefined) return { ...values, [id]: value };
  const next = { ...values };
  delete next[id];
  return Object.keys(next).length ? next : undefined;
}

export function validModifierValue(type: Modifier['type'], value: unknown): boolean {
  return type === 'number'
    ? typeof value === 'number' && Number.isFinite(value)
    : typeof value === 'string' && Boolean(value.trim()) && value.length <= 500 && !/[\u0000-\u001f\u007f]/u.test(value); // eslint-disable-line no-control-regex
}

export function formatModifierValues(values: SetValues, fields: Modifier[] | undefined): string {
  return (fields ?? []).flatMap((field) => {
    const value = modifierValue(values.modifiers, field.id);
    return value === undefined ? [] : [`${field.label}: ${value}`];
  }).join(' · ');
}
