import { afterEach, describe, expect, it, vi } from 'vitest';

function installAudioEnvironment() {
  const start = vi.fn();
  const connect = vi.fn();
  const createBufferSource = vi.fn(() => ({ buffer: undefined, connect, start }));
  const decodeAudioData = vi.fn().mockResolvedValue({ duration: 1.2 });
  const resume = vi.fn().mockResolvedValue(undefined);
  class MockAudioContext {
    state = 'suspended';
    destination = {};
    createBufferSource = createBufferSource;
    decodeAudioData = decodeAudioData;
    resume = resume;
  }
  const fallbackPlay = vi.fn().mockResolvedValue(undefined);
  class MockAudio {
    currentTime = 0;
    preload = '';
    load = vi.fn();
    play = fallbackPlay;
  }

  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('webkitAudioContext', undefined);
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('navigator', { vibrate: vi.fn() });
  return { start, decodeAudioData, resume, fallbackPlay };
}

function successfulResponse(): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  } as unknown as Response;
}

describe('rest alarm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('loads and plays the bundled wav through an unlocked audio context', async () => {
    const { start, decodeAudioData, resume } = installAudioEnvironment();
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { playRestAlarm, primeAlarmAudio } = await import('./alarm');

    primeAlarmAudio();
    await playRestAlarm();

    expect(fetchMock).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}alarm_sound.wav`, { cache: 'force-cache' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalled();
    expect(decodeAudioData).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('clears a fully failed load so a later alarm can fetch and play again', async () => {
    const { start, fallbackPlay } = installAudioEnvironment();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ ok: false, status: 503, arrayBuffer: vi.fn() } as unknown as Response)
      .mockResolvedValueOnce(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { playRestAlarm } = await import('./alarm');

    await playRestAlarm();
    expect(fallbackPlay).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();

    await playRestAlarm();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
