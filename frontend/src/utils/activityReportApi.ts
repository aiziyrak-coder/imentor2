import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

/** Bo'lim ichida o'tkazilgan vaqt. */
export type PageTime = {
  page: string;
  minutes: number;
  seconds: number;
  /** Bo'lim necha marta ochilgan. */
  opens: number;
};

export type ActivityRow = {
  owner_key: string;
  display_name: string;
  department: string;
  minutes: number;
  /** Oraliqdagi nechta kunda ishlagan. */
  active_days: number;
  pages: PageTime[];
  videos_viewed: number;
  handouts_viewed: number;
  cases_created: number;
  tests_created: number;
  live_sessions: number;
};

export type ActivityOverview = {
  from: string;
  to: string;
  teachers: ActivityRow[];
  total: number;
  totals: {
    minutes: number;
    videos_viewed: number;
    handouts_viewed: number;
    cases_created: number;
    tests_created: number;
    active_teachers: number;
  };
};

export type ActivityDay = {
  date: string;
  minutes: number;
  pages: PageTime[];
  videos_viewed: number;
  handouts_viewed: number;
  cases_created: number;
  tests_created: number;
  live_sessions: number;
};

export type ActivityDetail = {
  owner_key: string;
  display_name: string;
  department: string;
  from: string;
  to: string;
  total_minutes: number;
  pages: PageTime[];
  days: ActivityDay[];
  videos_viewed: number;
  handouts_viewed: number;
  cases_created: number;
  tests_created: number;
  live_sessions: number;
};

export async function fetchActivityOverview(
  from: string,
  to: string,
  q?: string,
  sort?: string,
): Promise<ActivityOverview> {
  const token = await getBackendAccessToken();
  const params = new URLSearchParams({ from, to });
  if (q) params.set('q', q);
  if (sort) params.set('sort', sort);
  return httpJson(`${apiBaseUrl()}/v1/admin/reports/activity/?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 60000,
  });
}

export async function fetchActivityDetail(
  ownerKey: string,
  from: string,
  to: string,
): Promise<ActivityDetail> {
  const token = await getBackendAccessToken();
  const params = new URLSearchParams({ from, to });
  return httpJson(
    `${apiBaseUrl()}/v1/admin/reports/activity/${encodeURIComponent(ownerKey)}/?${params}`,
    { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 60000 },
  );
}

/** `1 s 05 daq` — hisobotda soatlab vaqtlar ham uchraydi. */
export function formatMinutes(total: number): string {
  if (total <= 0) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} daq`;
  return `${h} s ${String(m).padStart(2, '0')} daq`;
}
