let alarmAudio: HTMLAudioElement | undefined;

export function primeAlarmAudio(): void {
  if (typeof window === 'undefined') return;

  alarmAudio ??= new Audio(`${import.meta.env.BASE_URL}alarm_sound.wav`);
  alarmAudio.preload = 'auto';
  alarmAudio.load();
}

export function playRestAlarm(): void {
  if (typeof window === 'undefined') return;
  primeAlarmAudio();
  if (alarmAudio) {
    alarmAudio.currentTime = 0;
    void alarmAudio.play().catch(() => undefined);
  }

  if ('vibrate' in navigator) {
    navigator.vibrate([160, 80, 160]);
  }
}
