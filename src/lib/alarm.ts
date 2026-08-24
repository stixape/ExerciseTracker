type WebkitWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let alarmContext: AudioContext | undefined;
let alarmBufferPromise: Promise<AudioBuffer> | undefined;
let fallbackAudio: HTMLAudioElement | undefined;
const ALARM_FETCH_ATTEMPTS = 2;

function getAlarmUrl(): string {
  return `${import.meta.env.BASE_URL}alarm_sound.wav`;
}

function getAudioContext(): AudioContext | undefined {
  const AudioContextConstructor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AudioContextConstructor) return undefined;

  alarmContext ??= new AudioContextConstructor();
  return alarmContext;
}

async function fetchAndDecodeAlarm(context: AudioContext): Promise<AudioBuffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ALARM_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(getAlarmUrl(), { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Alarm request failed with status ${response.status}.`);
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength) throw new Error('Alarm response was empty.');
      return await context.decodeAudioData(bytes);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Alarm sound could not be loaded.');
}

function loadAlarmBuffer(context: AudioContext): Promise<AudioBuffer> {
  if (!alarmBufferPromise) {
    const pending = fetchAndDecodeAlarm(context);
    const guarded = pending.catch((error: unknown) => {
      if (alarmBufferPromise === guarded) alarmBufferPromise = undefined;
      throw error;
    });
    alarmBufferPromise = guarded;
  }

  return alarmBufferPromise;
}

async function playFallbackAudio(): Promise<void> {
  fallbackAudio ??= new Audio(getAlarmUrl());
  fallbackAudio.currentTime = 0;
  try {
    await fallbackAudio.play();
  } catch {
    // Recreate the element next time in case this one retained a failed network state.
    fallbackAudio = undefined;
  }
}

export function primeAlarmAudio(): void {
  if (typeof window === 'undefined') return;

  const context = getAudioContext();
  if (context) {
    void loadAlarmBuffer(context).catch(() => undefined);
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
      await playFallbackAudio();
    }
  } else {
    await playFallbackAudio();
  }

  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([160, 80, 160]);
    } catch {
      // Vibration is best-effort and can be blocked by browser policy.
    }
  }
}
