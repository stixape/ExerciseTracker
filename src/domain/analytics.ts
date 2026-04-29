import type { PersonalBest, Plateau, SessionSet, WorkoutSession } from './types';

function completedSets(sessions: WorkoutSession[]): SessionSet[] {
  return sessions.flatMap((session) => session.sets.filter((set) => set.completedAt));
}

function scoreSet(set: SessionSet): number {
  if (set.mode === 'weighted_reps') {
    return (set.actual.weightKg ?? 0) * (set.actual.reps ?? 0);
  }

  if (set.mode === 'timed_hold') {
    return set.actual.seconds ?? 0;
  }

  return (set.actual.reps ?? 0) + (set.actual.bandColourIds?.length ?? 0) * 100;
}

export function calculatePersonalBests(sessions: WorkoutSession[]): PersonalBest[] {
  const bests = new Map<string, PersonalBest>();

  for (const set of completedSets(sessions)) {
    const achievedAt = set.completedAt ?? new Date().toISOString();

    if (set.mode === 'weighted_reps') {
      const weightKey = `${set.exerciseName}:weight`;
      const weight = set.actual.weightKg ?? 0;
      const reps = set.actual.reps ?? 0;
      const currentWeight = bests.get(weightKey);
      if (!currentWeight || weight > currentWeight.value) {
        bests.set(weightKey, {
          exerciseName: set.exerciseName,
          mode: set.mode,
          label: `Highest load: ${weight} kg x ${reps}`,
          value: weight,
          achievedAt,
        });
      }

      const volumeKey = `${set.exerciseName}:volume`;
      const volume = weight * reps;
      const currentVolume = bests.get(volumeKey);
      if (!currentVolume || volume > currentVolume.value) {
        bests.set(volumeKey, {
          exerciseName: set.exerciseName,
          mode: set.mode,
          label: `Best set volume: ${volume} kg`,
          value: volume,
          achievedAt,
        });
      }
    }

    if (set.mode === 'timed_hold') {
      const key = `${set.exerciseName}:time`;
      const seconds = set.actual.seconds ?? 0;
      const current = bests.get(key);
      if (!current || seconds > current.value) {
        bests.set(key, {
          exerciseName: set.exerciseName,
          mode: set.mode,
          label: `Longest hold: ${seconds}s`,
          value: seconds,
          achievedAt,
        });
      }
    }

    if (set.mode === 'band_reps') {
      const key = `${set.exerciseName}:bands`;
      const score = scoreSet(set);
      const current = bests.get(key);
      if (!current || score > current.value) {
        const bandCount = set.actual.bandColourIds?.length ?? 0;
        bests.set(key, {
          exerciseName: set.exerciseName,
          mode: set.mode,
          label: `Best band set: ${bandCount} band${bandCount === 1 ? '' : 's'} x ${set.actual.reps ?? 0}`,
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
      date: new Date(session.completedAt ?? session.startedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      volume: session.sets.reduce((total, set) => {
        if (!set.completedAt || set.mode !== 'weighted_reps') return total;
        return total + (set.actual.weightKg ?? 0) * (set.actual.reps ?? 0);
      }, 0),
    }));
}

export function detectPlateaus(sessions: WorkoutSession[], appearanceThreshold = 3): Plateau[] {
  const grouped = new Map<string, SessionSet[]>();

  for (const set of completedSets(sessions)) {
    const key = `${set.exerciseName}:${set.mode}`;
    grouped.set(key, [...(grouped.get(key) ?? []), set]);
  }

  const plateaus: Plateau[] = [];

  for (const sets of grouped.values()) {
    const sorted = [...sets].sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
    if (sorted.length < appearanceThreshold) continue;

    const recent = sorted.slice(-appearanceThreshold);
    const recentScores = recent.map(scoreSet);
    const bestBeforeRecent = Math.max(0, ...sorted.slice(0, -appearanceThreshold).map(scoreSet));
    const bestRecent = Math.max(...recentScores);
    const hasRecentImprovement = recentScores.some((score, index) => index > 0 && score > recentScores[index - 1]);

    if (bestRecent <= bestBeforeRecent || !hasRecentImprovement) {
      const latest = recent[recent.length - 1];
      plateaus.push({
        exerciseName: latest.exerciseName,
        mode: latest.mode,
        appearances: recent.length,
        latestScore: recentScores[recentScores.length - 1],
      });
    }
  }

  return plateaus.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}
