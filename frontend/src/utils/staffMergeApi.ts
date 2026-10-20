import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

/** Admin: o'qituvchi hisoblarini birlashtirish, xodim to'liq ma'lumoti, JSHSHIR holati. */

export type MergeAccount = {
  username: string;
  first_name: string;
  last_name: string;
  display_name: string;
  department: string;
  pinfl: string;
  last_login: string | null;
  date_joined: string;
  /** Tanlangan fanlar + tayyor kontent soni. */
  activity: number;
  login_kind: 'phone' | 'staff_id';
  password_is_initial: boolean;
  /** Mahalliy paroli bor (JSHSHIR/yuz bilan ochilgan hisobda yo'q). */
  has_password: boolean;
};

export type MergeGroup = {
  accounts: MergeAccount[];
  /** Server tavsiya qilgan, qoladigan hisob. */
  primary: string;
  similarity: number;
  /** To'ldirilgan bo'lsa birlashtirib bo'lmaydi (sabab matni). */
  blocked: string;
  suggest_copy_password: boolean;
};

export type MergeResult = {
  merged: string;
  into: string;
  moved: Record<string, number>;
  skipped_duplicates: number;
};

export type MergeLogEntry = {
  id: number;
  primary: string;
  merged: string;
  merged_name: string;
  pinfl: string;
  moved: Record<string, number>;
  skipped_duplicates: number;
  actor: string;
  note: string;
  merged_at: string;
};

export type StaffDetail = {
  account: {
    username: string;
    login_kind: 'phone' | 'staff_id';
    first_name: string;
    last_name: string;
    role: string;
    is_active: boolean;
    date_joined: string;
    last_login: string | null;
    password_is_initial: boolean;
  };
  profile: {
    faculty: string;
    department: string;
    department_id: number | null;
    direction: string;
    job_title: string;
    participant_kind: string;
    hemis_status: string;
    has_photo: boolean;
  } | null;
  pinfl: { pinfl: string; source: string; full_name: string; synced_at: string } | null;
  cam_fermi: {
    full_name: string;
    passport: string;
    hemis_id: string;
    kind: string;
    synced_at: string;
  } | null;
  face: { templates: number; positions: string[] };
  activity: { courses: number; prepared_content: number };
  merge_history: { primary: string; merged: string; moved: Record<string, number>; actor: string; merged_at: string }[];
  duplicates: MergeAccount[];
};

export type PinflStatus = {
  pinfl_records: number;
  pinfl_linked: number;
  pinfl_unlinked: number;
  cam_staff: number;
  cam_staff_with_pinfl: number;
  last_synced_at: string | null;
  teachers_total: number;
  teachers_with_pinfl: number;
  teachers_without_pinfl: { username: string; display_name: string; department: string; last_login: string | null }[];
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return { Authorization: `Bearer ${token}` };
}

export async function fetchMergeCandidates(): Promise<{ threshold: number; groups: MergeGroup[] }> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-merge/candidates/`, {
    headers: await authHeaders(),
    timeoutMs: 60000,
  });
}

export async function mergeAccounts(input: {
  primary: string;
  secondaries: string[];
  copy_password: boolean;
  note?: string;
}): Promise<{ primary: string; results: MergeResult[] }> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-merge/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: input,
    timeoutMs: 60000,
  });
}

export async function fetchMergeLog(): Promise<MergeLogEntry[]> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-merge/log/`, {
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
}

export async function fetchStaffDetail(username: string): Promise<StaffDetail> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff/${encodeURIComponent(username)}/detail/`, {
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
}

export async function fetchPinflStatus(): Promise<PinflStatus> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-pinfl/status/`, {
    headers: await authHeaders(),
    timeoutMs: 60000,
  });
}
