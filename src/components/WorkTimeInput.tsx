import { MAX_INTERVAL_SECONDS } from '../domain/interval';
import { ValidatedInput } from './ValidatedInput';

export function WorkTimeInput({ label, seconds, placeholderSeconds, onValue }: {
  label: string;
  seconds?: number;
  placeholderSeconds?: number;
  onValue: (seconds: number | undefined) => void;
}) {
  const minutes = seconds === undefined ? undefined : Number((seconds / 60).toFixed(4));
  const placeholder = placeholderSeconds === undefined ? undefined : String(Number((placeholderSeconds / 60).toFixed(4)));
  return (
    <label className="compact-field">
      {label}
      <ValidatedInput type="number" inputMode="decimal" min={0.5 / 60} max={MAX_INTERVAL_SECONDS / 60} step="any"
        value={minutes} placeholder={placeholder} optional={placeholderSeconds !== undefined}
        commitOnBlur onValue={(value) => onValue(value === '' ? undefined : Math.round(Number(value) * 60))} />
    </label>
  );
}
