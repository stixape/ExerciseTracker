type WebkitWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

interface Sound {
  asset: string;
  buffer?: Promise<AudioBuffer>;
  fallback?: HTMLAudioElement;
  source?: AudioBufferSourceNode;
}

let alarmContext: AudioContext | undefined;
let bellGeneration = 0;
const restAlarm: Sound = { asset: 'alarm_sound.wav' };
const intervalBell: Sound = { asset: 'interval-bell.mp3' };
const ALARM_FETCH_ATTEMPTS = 2;

function soundUrl(sound: Sound): string {
  return import.meta.env.BASE_URL + sound.asset;
}

function getAudioContext(): AudioContext | undefined {
  const AudioContextConstructor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AudioContextConstructor) return undefined;

  try {
    alarmContext ??= new AudioContextConstructor();
    return alarmContext;
  } catch {
    return undefined;
  }
}

async function fetchAndDecodeSound(context: AudioContext, sound: Sound): Promise<AudioBuffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ALARM_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(soundUrl(sound), { cache: 'force-cache' });
      if (!response.ok) throw new Error('Sound request failed with status ' + response.status + '.');
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength) throw new Error('Sound response was empty.');
      return await context.decodeAudioData(bytes);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Sound could not be loaded.');
}

function loadBuffer(context: AudioContext, sound: Sound): Promise<AudioBuffer> {
  sound.buffer ??= fetchAndDecodeSound(context, sound).catch((error: unknown) => {
    sound.buffer = undefined;
    throw error;
  });
  return sound.buffer;
}

async function playFallback(sound: Sound): Promise<void> {
  const player = sound.fallback ??= new Audio(soundUrl(sound));
  try {
    player.currentTime = 0;
    await player.play();
  } catch {
    if (sound.fallback === player && player.paused) sound.fallback = undefined;
  }
}

function primeSound(sound: Sound): void {
  if (typeof window === 'undefined') return;
  const context = getAudioContext();
  if (context) {
    void loadBuffer(context, sound).catch(() => undefined);
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return;
  }

  try {
    sound.fallback ??= new Audio(soundUrl(sound));
    sound.fallback.preload = 'auto';
    sound.fallback.load();
  } catch {
    // Some test/browser environments expose Audio without implementing load.
  }
}

async function playSound(sound: Sound, isCurrent = () => true): Promise<void> {
  if (typeof window === 'undefined') return;
  const context = getAudioContext();
  if (context) {
    try {
      if (context.state === 'suspended') await context.resume();
      const buffer = await loadBuffer(context, sound);
      if (!isCurrent()) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      sound.source = source;
      source.start();
      return;
    } catch {
      // Use the media element if this browser cannot decode through Web Audio.
    }
  }
  if (isCurrent()) await playFallback(sound);
}

export function primeAlarmAudio(): void {
  primeSound(restAlarm);
}

export function primeIntervalAudio(): void {
  primeSound(restAlarm);
  primeSound(intervalBell);
}

function stopIntervalBell(): void {
  bellGeneration++;
  try { intervalBell.source?.stop(); } catch { /* The cue already ended. */ }
  intervalBell.source = undefined;
  intervalBell.fallback?.pause();
}

export function playIntervalBell(): Promise<void> {
  stopIntervalBell();
  const generation = bellGeneration;
  return playSound(intervalBell, () => generation === bellGeneration);
}

export function playIntervalFinishAlarm(): Promise<void> {
  stopIntervalBell();
  return playRestAlarm();
}

export async function playRestAlarm(): Promise<void> {
  if (typeof window === 'undefined') return;
  await playSound(restAlarm);

  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([160, 80, 160]);
    } catch {
      // Vibration is best-effort and can be blocked by browser policy.
    }
  }
}
