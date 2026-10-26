import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string | number | undefined;
  onValue: (value: string) => void;
  optional?: boolean;
  whole?: boolean;
};
/** Incomplete text belongs to the field, never to the canonical workout state. */
export function ValidatedInput({ value, onValue, optional = false, whole = false, ...props }: Props) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const [previous, setPrevious] = useState(value);
  if (value !== previous) { setPrevious(value); setDraft(String(value ?? '')); }
  const numeric = props.type === 'number';
  const valid = draft === '' ? optional : numeric ? Number.isFinite(Number(draft)) && Number(draft) >= Number(props.min ?? 0) && (!whole || Number.isInteger(Number(draft))) : Boolean(draft.trim()) && draft.length <= 500;
  return <input {...props} value={draft} aria-invalid={!valid} required={!optional} onChange={(event) => {
    const next = event.target.value;
    setDraft(next);
    const acceptable = next === '' ? optional : numeric ? Number.isFinite(Number(next)) && Number(next) >= Number(props.min ?? 0) && (!whole || Number.isInteger(Number(next))) : Boolean(next.trim()) && next.length <= 500;
    event.target.setCustomValidity(acceptable ? '' : 'Enter a valid value. This unfinished edit has not been saved.');
    if (acceptable) onValue(next);
  }} />;
}
