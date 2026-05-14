import { afterEach, describe, expect, it, vi } from 'vitest';
import { playRestAlarm, primeAlarmAudio } from './alarm';

describe('rest alarm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and plays the bundled wav through an unlocked audio context', async () => {
    const start = vi.fn();
    const connect = vi.fn();
    const createBufferSource = vi.fn(() => ({ buffer: undefined, connect, start }));
    const decodeAudioData = vi.fn().mockResolvedValue({ duration: 1.2 });
    const resume = vi.fn().mockResolvedValue(undefined);
    const audioContext = {
      state: 'suspended',
      destination: {},
      createBufferSource,
      decodeAudioData,
      resume,
    };
    class MockAudioContext {
      state = audioContext.state;
      destination = audioContext.destination;
      createBufferSource = audioContext.createBufferSource;
      decodeAudioData = audioContext.decodeAudioData;
      resume = audioContext.resume;
    }
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as Response);
    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('webkitAudioContext', undefined);
    vi.stubGlobal('navigator', { vibrate: vi.fn() });

    primeAlarmAudio();
    await playRestAlarm();

    expect(fetchSpy).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}alarm_sound.wav`);
    expect(resume).toHaveBeenCalled();
    expect(decodeAudioData).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });
});
