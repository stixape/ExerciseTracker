import type { AppData, BandColour } from './types';

export function sameBandSelection(left: string[] = [], right: string[] = []): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function reorderBandColours(bands: BandColour[], bandId: string, targetBandId: string): BandColour[] {
  const from = bands.findIndex((band) => band.id === bandId);
  const to = bands.findIndex((band) => band.id === targetBandId);
  if (from < 0 || to < 0 || from === to) return bands;
  const next = [...bands];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function archiveBandColour(data: AppData, bandId: string): AppData {
  return { ...data, bandColours: data.bandColours.map((band) => band.id === bandId ? { ...band, archived: true } : band) };
}
