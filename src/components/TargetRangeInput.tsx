import { useId, useState } from 'react';
import { formatTargetRange, parseTargetRange, type TargetRange } from '../domain/targetRange';

export function TargetRangeInput({ label, min, max, seconds = false, onValue }: {
  label: string;
  min: number;
  max?: number;
  seconds?: boolean;
  onValue: (range: TargetRange) => void;
}) {
  const inputId = useId();
  const saved = formatTargetRange(min, max);
  const [previous, setPrevious] = useState(saved);
  const [draft, setDraft] = useState(saved);
  if (previous !== saved) {
    setPrevious(saved);
    setDraft(saved);
  }
  const range = parseTargetRange(draft, seconds);

  return <div className="compact-field">
    <label htmlFor={inputId}>{label}</label>
    <input
      id={inputId}
      className="target-range-input"
      type="text"
      value={draft}
      placeholder={seconds ? '40 or 20-60' : '5 or 3-5'}
      aria-invalid={!range}
      aria-describedby={range ? undefined : inputId + '-error'}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      onBlur={() => {
        if (!range) return;
        setDraft(formatTargetRange(range.min, range.max));
        if (range.min !== min || range.max !== max) onValue(range);
      }}
    />
    {!range && <small id={inputId + '-error'} className="form-message">Enter a whole number or an ascending range.</small>}
  </div>;
}
