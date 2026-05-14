type WebkitWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let alarmContext: AudioContext | undefined;
let alarmBufferPromise: Promise<AudioBuffer> | undefined;
let fallbackAudio: HTMLAudioElement | undefined;

function getAlarmUrl(): string {
  return `${import.meta.env.BASE_URL}alarm_sound.wav`;
}

function getAudioContext(): AudioContext | undefined {
  const AudioContextConstructor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AudioContextConstructor) return undefined;

  alarmContext ??= new AudioContextConstructor();
  return alarmContext;
}

function loadAlarmBuffer(context: AudioContext): Promise<AudioBuffer> {
  alarmBufferPromise ??= fetch(getAlarmUrl())
    .then((response) => response.arrayBuffer())
    .then((buffer) => context.decodeAudioData(buffer));

  return alarmBufferPromise;
}

function playFallbackAudio(): void {
  fallbackAudio ??= new Audio(getAlarmUrl());
  fallbackAudio.currentTime = 0;
  const playResult = fallbackAudio.play();
  if (playResult) void playResult.catch(() => undefined);
}

export function primeAlarmAudio(): void {
  if (typeof window === 'undefined') return;

  const context = getAudioContext();
  if (context) {
    void loadAlarmBuffer(context);
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return;
  }

  fallbackAudio ??= new Audio(getAlarmUrl());
  fallbackAudio.preload = 'auto';
  try {
    fallbackAudio.load();
  } catch {
    // Some test/browser environments expose Audio without implementing load.
  }
}

export async function playRestAlarm(): Promise<void> {
  if (typeof window === 'undefined') return;

  const context = getAudioContext();
  if (context) {
    try {
      if (context.state === 'suspended') await context.resume();
      const buffer = await loadAlarmBuffer(context);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
    } catch {
      playFallbackAudio();
    }
  } else {
    playFallbackAudio();
  }

  if ('vibrate' in navigator) {
    navigator.vibrate([160, 80, 160]);
  }
}
