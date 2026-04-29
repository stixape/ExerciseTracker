import type { SessionSet, WorkoutSession } from './types';

export function getRestDurationSeconds(exerciseIndex: number, hasNextSet: boolean): number {
  if (!hasNextSet) return 0;
  return exerciseIndex === 0 ? 180 : 120;
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(totalSeconds, 0) / 60);
  const seconds = Math.max(totalSeconds, 0) % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getNextIncompleteSet(session: WorkoutSession, afterSetId?: string): SessionSet | undefined {
  const startIndex = afterSetId ? session.sets.findIndex((set) => set.id === afterSetId) + 1 : 0;
  return session.sets.slice(Math.max(startIndex, 0)).find((set) => !set.completedAt);
}

export function isFinalSet(session: WorkoutSession, setId: string): boolean {
  return session.sets.filter((set) => set.id !== setId).every((set) => set.completedAt);
}
