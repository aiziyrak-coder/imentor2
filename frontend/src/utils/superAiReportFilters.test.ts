import { describe, expect, it } from 'vitest';
import { filtersToApiParams, parseSmartQuery } from './superAiReportFilters';

describe('parseSmartQuery', () => {
  it('parses tier and flag tokens', () => {
    const p = parseSmartQuery('tier:active flag:no_tests ichki');
    expect(p.tiers).toEqual(['active']);
    expect(p.flags).toEqual(['no_tests']);
    expect(p.text).toBe('ichki');
  });

  it('parses risk and gps shortcuts', () => {
    const p = parseSmartQuery('risk gps');
    expect(p.riskOnly).toBe(true);
    expect(p.minGeofence).toBe(50);
  });

  it('builds api params', () => {
    const params = filtersToApiParams({
      smartQuery: 'dept:Terapiya tier:low',
      department: '',
      tiers: [],
      flags: [],
      riskOnly: false,
      minGeofence: null,
      sort: 'name',
    });
    expect(params.department).toBe('Terapiya');
    expect(params.tier).toBe('low');
    expect(params.sort).toBe('name');
  });
});
