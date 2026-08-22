/** Smart qidiruv sintaksisi: tier:active dept:ichki flag:no_tests risk gps */

export type TeacherSortKey =
  | 'minutes_desc'
  | 'minutes_asc'
  | 'name'
  | 'geofence_asc'
  | 'alerts_desc'
  | 'risk_desc';

export type TeacherFilterState = {
  smartQuery: string;
  department: string;
  tiers: string[];
  flags: string[];
  riskOnly: boolean;
  minGeofence: number | null;
  sort: TeacherSortKey;
};

export const DEFAULT_TEACHER_FILTERS: TeacherFilterState = {
  smartQuery: '',
  department: '',
  tiers: [],
  flags: [],
  riskOnly: false,
  minGeofence: null,
  sort: 'minutes_desc',
};

const TIER_ALIASES: Record<string, string> = {
  inactive: 'inactive',
  faol_emas: 'inactive',
  'faol emas': 'inactive',
  low: 'low',
  kam: 'low',
  sufficient: 'sufficient',
  yetarli: 'sufficient',
  active: 'active',
  faol: 'active',
};

const FLAG_ALIASES: Record<string, string> = {
  no_cases: 'no_cases',
  keys: 'no_cases',
  no_tests: 'no_tests',
  test: 'no_tests',
  no_live_tests: 'no_live_tests',
  jonli: 'no_live_tests',
  inactive: 'inactive',
};

export type ParsedSmartQuery = {
  text: string;
  tiers: string[];
  flags: string[];
  department: string;
  riskOnly: boolean;
  minGeofence: number | null;
};

export function parseSmartQuery(raw: string): ParsedSmartQuery {
  const tiers: string[] = [];
  const flags: string[] = [];
  let department = '';
  let riskOnly = false;
  let minGeofence: number | null = null;
  const textParts: string[] = [];

  for (const part of raw.trim().split(/\s+/)) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower === 'risk' || lower === 'xavf') {
      riskOnly = true;
      continue;
    }
    if (lower === 'gps' || lower === 'gps_past') {
      minGeofence = 50;
      continue;
    }
    const tierMatch = lower.match(/^tier[:=](.+)$/) || lower.match(/^daraja[:=](.+)$/);
    if (tierMatch) {
      const t = TIER_ALIASES[tierMatch[1].trim()] || tierMatch[1].trim();
      if (t) tiers.push(t);
      continue;
    }
    const flagMatch = lower.match(/^flag[:=](.+)$/) || lower.match(/^belgi[:=](.+)$/);
    if (flagMatch) {
      const f = FLAG_ALIASES[flagMatch[1].trim()] || flagMatch[1].trim();
      if (f) flags.push(f);
      continue;
    }
    const deptMatch = part.match(/^dept[:=](.+)$/i) || part.match(/^kafedra[:=](.+)$/i);
    if (deptMatch) {
      department = deptMatch[1].trim();
      continue;
    }
    const geoMatch = lower.match(/^geo[<>=]+(\d+)$/);
    if (geoMatch) {
      minGeofence = Number(geoMatch[1]);
      continue;
    }
    const bareTier = TIER_ALIASES[lower];
    if (bareTier && !lower.includes(':')) {
      tiers.push(bareTier);
      continue;
    }
    textParts.push(part);
  }

  return {
    text: textParts.join(' '),
    tiers,
    flags,
    department,
    riskOnly,
    minGeofence,
  };
}

export function filtersToApiParams(filters: TeacherFilterState): Record<string, string> {
  const parsed = parseSmartQuery(filters.smartQuery);
  const params: Record<string, string> = { sort: filters.sort };
  const q = parsed.text.trim();
  if (q) params.q = q;
  const dept = filters.department || parsed.department;
  if (dept) params.department = dept;
  const tiers = [...new Set([...filters.tiers, ...parsed.tiers])];
  if (tiers.length) params.tier = tiers.join(',');
  const flags = [...new Set([...filters.flags, ...parsed.flags])];
  if (flags.length) params.flags = flags.join(',');
  if (filters.riskOnly || parsed.riskOnly) params.risk_only = 'true';
  const geo = filters.minGeofence ?? parsed.minGeofence;
  if (geo != null) params.min_geofence = String(geo);
  return params;
}

export function activeFilterCount(filters: TeacherFilterState): number {
  const parsed = parseSmartQuery(filters.smartQuery);
  let n = 0;
  if (parsed.text.trim()) n += 1;
  if (filters.department || parsed.department) n += 1;
  if (filters.tiers.length || parsed.tiers.length) n += 1;
  if (filters.flags.length || parsed.flags.length) n += 1;
  if (filters.riskOnly || parsed.riskOnly) n += 1;
  if (filters.minGeofence != null || parsed.minGeofence != null) n += 1;
  if (filters.sort !== 'minutes_desc') n += 1;
  return n;
}
