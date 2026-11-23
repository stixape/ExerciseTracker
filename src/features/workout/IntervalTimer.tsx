import { useEffect, useState, type ReactNode } from 'react';
import { formatDuration } from '../../domain/rest';
import type { ActiveInterval, SessionSet } from '../../domain/types';

export function IntervalTimer({ interval, set, setCount, previous, ready, onDue, onPause, onResume, onSkip }: {
  interval: ActiveInterval;
  set: SessionSet;
  setCount: number;
  previous?: ReactNode;
  ready: boolean;
  onDue: (live: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
}) {
  const [clock, setClock] = useState(Date.now);
  const deadline = interval.endsAt ? Date.parse(interval.endsAt) : undefined;
  const paused = deadline === undefined;
  const remaining = Math.max(0, Math.ceil((interval.remainingMs ?? Date.parse(interval.endsAt!) - clock) / 1000));

  useEffect(() => {
    if (deadline === undefined) return;
    const display = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(display);
  }, [deadline]);

  useEffect(() => {
    if (!ready || deadline === undefined) return;
    const endsAt = deadline;
    let timeout: number;
    function schedule() {
      const delay = endsAt - Date.now();
      timeout = window.setTimeout(() => {
        const lateBy = Date.now() - endsAt;
        if (lateBy < 0) schedule();
        else onDue(delay > 0 && lateBy < 1000);
      }, Math.max(0, delay));
    }
    schedule();
    function catchUp() {
      if (document.visibilityState === 'visible' && Date.now() >= endsAt) onDue(false);
    }
    document.addEventListener('visibilitychange', catchUp);
    document.addEventListener('resume', catchUp);
    window.addEventListener('pageshow', catchUp);
    window.addEventListener('focus', catchUp);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', catchUp);
      document.removeEventListener('resume', catchUp);
      window.removeEventListener('pageshow', catchUp);
      window.removeEventListener('focus', catchUp);
    };
  }, [deadline, onDue, ready]);

  return (
    <article className="active-set-panel interval-panel" aria-label="Interval timer">
      <div aria-live="polite">
        <p className="eyebrow">{interval.phase === 'work' ? 'Work' : 'Rest'}{paused ? ' · Paused' : ''}</p>
        <h1>{set.exerciseName}</h1>
        <p>Set {set.setNumber} of {setCount}</p>
      </div>
      <strong className="interval-countdown" role="timer" aria-label={remaining + ' seconds remaining'}>
        {formatDuration(remaining)}
      </strong>
      {previous}
      <div className="interval-actions">
        <button className="primary-button" type="button" disabled={!ready} onClick={paused ? () => {
          setClock(Date.now());
          onResume();
        } : onPause}>
          {paused ? 'Resume interval' : 'Pause interval'}
        </button>
        {interval.phase === 'rest' && (
          <button className="secondary-button" type="button" disabled={!ready} onClick={onSkip}>Skip rest</button>
        )}
      </div>
    </article>
  );
}
