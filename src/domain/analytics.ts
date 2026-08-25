import type { PersonalBest, Plateau, SessionSet, WorkoutSession } from './types';

function completedSets(sessions: WorkoutSession[]): SessionSet[] {
  return sessions
    .filter((session) => session.completedAt)
    .flatMap((session) => session.sets.filter((set) => set.completedAt));
}

function safeMetric(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function getPerformedRepCount(set: SessionSet): number {
  return safeMetric(set.actual.reps);
}

export function calculateSetVolume(set: SessionSet): number {
  if (set.mode !== 'weighted_reps') return 0;
  return safeMetric(set.actual.weightKg) * getPerformedRepCount(set);
}

function scoreSet(set: SessionSet): number {
  if (set.mode === 'weighted_reps') return calculateSetVolume(set);
  if (set.mode === 'timed_hold') return safeMetric(set.actual.seconds);
  return getPerformedRepCount(set) + (set.actual.bandColourIds?.length ?? 0) * 100;
}

function exerciseKey(set: SessionSet): string {
  const identity = set.exerciseId.trim() ? `id:${set.exerciseId}` : `name:${set.exerciseName.trim().toLocaleLowerCase()}`;
  return `${set.mode}:${identity}`;
}

function repsLabel(set: SessionSet): string {
  return `${safeMetric(set.actual.reps)}`;
}

export function calculatePersonalBests(sessions: WorkoutSession[]): PersonalBest[] {
  const bests = new Map<string, PersonalBest>();
  const weightTieVolumes = new Map<string, number>();

  for (const set of completedSets(sessions)) {
    const achievedAt = set.completedAt!;
    const identity = exerciseKey(set);

    if (set.mode === 'weighted_reps') {
      const weightKey = `${identity}:weight`;
      const weight = safeMetric(set.actual.weightKg);
      const volume = calculateSetVolume(set);
      const currentWeight = bests.get(weightKey);
      if (!currentWeight || weight > currentWeight.value || (weight === currentWeight.value && volume > (weightTieVolumes.get(weightKey) ?? 0))) {
        bests.set(weightKey, {
          exerciseId: set.exerciseId || undefined,
          exerciseName: set.exerciseName,
          mode: set.mode,
          label: `Highest load: ${weight} kg x ${repsLabel(set)}`,
          value: weight,
          achievedAt,
        });
        weightTieVolumes.set(weightKey, volume);
      }

      const volumeKey = `${identity}:volume`;
      const currentVolume = bests.get(volumeKey);
      if (!currentVolume || volume > currentVolume.value) {
        bests.set(volumeKey, {
          exerciseId: set.exerciseId || undefined,
          exerciseName: set.exerciseName,
          mode: set.mode,
          label: `Best set volume: ${volume} kg·reps`,
          value: volume,
          achievedAt,
        });
      }
    }

    if (set.mode === 'timed_hold') {
      const key = `${identity}:time`;
      const seconds = safeMetric(set.actual.seconds);
      const current = bests.get(key);
      if (!current || seconds > current.value) {
        bests.set(key, {
          exerciseId: set.exerciseId || undefined,
          exerciseName: set.exerciseName,
          mode: set.mode,
          label: `Longest hold: ${seconds}s`,
          value: seconds,
          achievedAt,
        });
      }
    }

    if (set.mode === 'band_reps') {
      const key = `${identity}:bands`;
      const score = scoreSet(set);
      const current = bests.get(key);
      if (!current || score > current.value) {
        const bandCount = set.actual.bandColourIds?.length ?? 0;
        bests.set(key, {
          exerciseId: set.exerciseId || undefined,
          exerciseName: set.exerciseName,
          mode: set.mode,
          label: `Best band set: ${bandCount} band${bandCount === 1 ? '' : 's'} x ${repsLabel(set)}`,
          value: score,
          achievedAt,
        });
      }
    }
  }

  return [...bests.values()].sort((a, b) => b.achievedAt.localeCompare(a.achievedAt));
}

export function calculateVolumeTrend(sessions: WorkoutSession[]): Array<{ date: string; volume: number }> {
  return sessions
    .filter((session) => session.completedAt)
    .map((session) => ({
      timestamp: new Date(session.completedAt!).getTime(),
      date: new Date(session.completedAt!).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      volume: session.sets.reduce((total, set) => (set.completedAt ? total + calculateSetVolume(set) : total), 0),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(({ date, volume }) => ({ date, volume }));
}

interface ExerciseAppearance {
  score: number;
  occurredAt: string;
  set: SessionSet;
}

export function detectPlateaus(sessions: WorkoutSession[], appearanceThreshold = 3): Plateau[] {
  if (!Number.isInteger(appearanceThreshold) || appearanceThreshold < 2) {
    throw new RangeError('Appearance threshold must be a whole number of 2 or higher.');
  }

  const grouped = new Map<string, ExerciseAppearance[]>();

  for (const session of sessions.filter((item) => item.completedAt)) {
    const bestForSession = new Map<string, SessionSet>();
    for (const set of session.sets.filter((item) => item.completedAt)) {
      const key = exerciseKey(set);
      const current = bestForSession.get(key);
      if (!current || scoreSet(set) > scoreSet(current)) bestForSession.set(key, set);
    }

    for (const [key, set] of bestForSession) {
      const appearance: ExerciseAppearance = {
        score: scoreSet(set),
        occurredAt: session.completedAt!,
        set,
      };
      grouped.set(key, [...(grouped.get(key) ?? []), appearance]);
    }
  }

  const plateaus: Plateau[] = [];
  for (const appearances of grouped.values()) {
    const sorted = [...appearances].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    if (sorted.length < appearanceThreshold) continue;

    const recent = sorted.slice(-appearanceThreshold);
    const earlier = sorted.slice(0, -appearanceThreshold);
    const comparisonBest = earlier.length ? Math.max(...earlier.map((item) => item.score)) : recent[0].score;
    const comparisonCandidates = earlier.length ? recent : recent.slice(1);
    const improved = comparisonCandidates.some((item) => item.score > comparisonBest);
    if (improved) continue;

    const latest = recent.at(-1)!;
    plateaus.push({
      exerciseId: latest.set.exerciseId || undefined,
      exerciseName: latest.set.exerciseName,
      mode: latest.set.mode,
      appearances: recent.length,
      latestScore: latest.score,
    });
  }

  return plateaus.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}
