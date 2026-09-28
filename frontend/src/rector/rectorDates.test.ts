import { expect, it } from 'vitest';
import { shiftDays, monthStart, monthEnd } from './rectorDates';
it('uses the Tashkent date when UTC is still yesterday', () => {
  const now = new Date('2026-08-31T20:30:00Z');
  expect(shiftDays(0, now)).toBe('2026-09-01');
  expect(shiftDays(-1, now)).toBe('2026-08-31');
  expect(monthStart(0, now)).toBe('2026-09-01');
  expect(monthEnd(-1, now)).toBe('2026-08-31');
});
it('handles leap months and year boundaries', () => {
  expect(monthEnd(-1, new Date('2024-03-01T10:00:00Z'))).toBe('2024-02-29');
  expect(monthStart(-1, new Date('2026-01-01T10:00:00Z'))).toBe('2025-12-01');
});
