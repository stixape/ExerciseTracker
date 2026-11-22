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
  const [badInput, setBadInput] = useState(false);
  if (value !== previous) { setPrevious(value); setDraft(String(value ?? '')); setBadInput(false); }
  const numeric = props.type === 'number';
  function isValid(text: string) {
    if (text === '') return optional;
    if (!numeric) return Boolean(text.trim()) && text.length <= 500;
    const number = Number(text);
    return Number.isFinite(number) && number >= Number(props.min ?? -Infinity) &&
      number <= Number(props.max ?? Infinity) && (!whole || Number.isInteger(number));
  }
  const valid = isValid(draft) && !badInput;
  return <input {...props} value={draft} aria-invalid={!valid} required={!optional} onChange={(event) => {
    const next = event.target.value;
    setDraft(next);
    setBadInput(event.target.validity.badInput);
    const acceptable = isValid(next) && !event.target.validity.badInput;
    event.target.setCustomValidity(acceptable ? '' : 'Enter a valid value. This unfinished edit has not been saved.');
    if (acceptable) onValue(next);
  }} />;
}
