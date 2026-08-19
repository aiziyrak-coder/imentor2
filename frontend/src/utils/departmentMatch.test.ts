import { describe, expect, it } from 'vitest';

import { matchDepartmentByName, namesSoftMatch } from './departmentMatch';

describe('departmentMatch', () => {
  it('Kommunal gigiyena = Kommunal va mehnat gigiyenasi', () => {
    expect(namesSoftMatch('Kommunal gigiyena', 'Kommunal va mehnat gigiyenasi')).toBe(true);
    const hit = matchDepartmentByName('Kommunal gigiyena', 'KG', [
      { id: 56, name: 'Kommunal gigiyena', subjects_count: 0 },
      { id: 12, name: 'Kommunal va mehnat gigiyenasi', subjects_count: 21 },
    ]);
    expect(hit?.id).toBe(12);
  });

  it('Urologiya = Urologiya va onkologiya', () => {
    expect(namesSoftMatch('Urologiya', 'Urologiya va onkologiya')).toBe(true);
  });
});
