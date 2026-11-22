import type { Modifier, ModifierValue } from '../domain/types';
import { ValidatedInput } from './ValidatedInput';

export function ModifierInput({ field, label, value, onChange, placeholder }: {
  field: Modifier;
  label: string;
  value?: ModifierValue;
  placeholder?: string;
  onChange: (value?: ModifierValue) => void;
}) {
  return <label>{label}
    <ValidatedInput optional type={field.type} step={field.type === 'number' ? 'any' : undefined}
      maxLength={field.type === 'text' ? 500 : undefined}
      value={value} placeholder={placeholder}
      onValue={(text) => onChange(text === '' ? undefined : field.type === 'number' ? Number(text) : text)} />
  </label>;
}
