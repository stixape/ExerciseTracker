import { describe, expect, it } from 'vitest';
import { getTemplateDayForToday } from './calendar';
import { createDefaultTemplate } from './sampleData';

describe('default template', () => {
  it('includes Saturday as a planned day', () => {
    const template = createDefaultTemplate();
    expect(template.days.map((day) => day.label)).toContain('Saturday');
  });

  it('defaults first exercise reps to 5 and other rep-based exercises to 10', () => {
    const monday = createDefaultTemplate().days.find((day) => day.label === 'Monday');
    expect(monday?.exercises[0].sets.map((set) => set.target.reps)).toEqual([5, 5, 5]);
    expect(monday?.exercises[1].sets.map((set) => set.target.reps)).toEqual([10, 10, 10]);
    expect(monday?.exercises[4].sets.map((set) => set.target.reps)).toEqual([10, 10, 10]);
  });

  it('selects the template day matching the current weekday', () => {
    const template = createDefaultTemplate();
    const saturday = getTemplateDayForToday(template, new Date('2026-05-02T12:00:00'));
    expect(saturday?.label).toBe('Saturday');
  });
});
