import { sameBandSelection } from './bands';
import { modifierValue } from './modifiers';
import { getRecordedRangeMax } from './targetRange';
import type { SessionSet, WorkoutSession } from './types';

function matchesSetting(session: WorkoutSession, set: SessionSet, saved: WorkoutSession, recorded: SessionSet): boolean {
  switch (set.mode) {
    case 'weighted_reps':
      return recorded.actual.weightKg === set.actual.weightKg;
    case 'band_reps':
      return sameBandSelection(recorded.actual.bandColourIds, set.actual.bandColourIds);
    case 'timed_hold':
    case 'interval':
      return recorded.target.seconds === set.target.seconds && getRecordedRangeMax(session, set) === getRecordedRangeMax(saved, recorded);
    case 'other': {
      const fields = session.snapshot.exercises[set.exerciseIndex]?.modifiers ?? [];
      const savedFields = saved.snapshot.exercises[recorded.exerciseIndex]?.modifiers ?? [];
      return fields.length === savedFields.length && fields.some((field) => modifierValue(recorded.actual.modifiers, field.id) !== undefined) &&
        fields.every((field) => savedFields.some((known) => known.id === field.id && known.type === field.type) &&
          modifierValue(recorded.target.modifiers, field.id) === modifierValue(set.target.modifiers, field.id));
    }
  }
}

export function findPreviousSet(history: WorkoutSession[], session: WorkoutSession, set: SessionSet): SessionSet | undefined {
  let previous: SessionSet | undefined;
  let latest = -Infinity;
  for (const saved of history) {
    if (saved.id === session.id || saved.templateDayId !== session.templateDayId || !saved.completedAt) continue;
    const completed = Date.parse(saved.completedAt);
    if (completed <= latest) continue;
    const recorded = saved.sets.find((item) => item.completedAt && item.exerciseId === set.exerciseId &&
      item.mode === set.mode && item.setNumber === set.setNumber);
    if (recorded && matchesSetting(session, set, saved, recorded)) {
      latest = completed;
      previous = recorded;
    }
  }
  return previous;
}
