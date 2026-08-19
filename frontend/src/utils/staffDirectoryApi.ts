import { httpJson } from '../api/httpClient';
import { unwrapPagedResults, type PagedResponse } from '../api/pagedResults';
import { getBackendAccessToken } from './backendAuth';
import type { UserRole } from './localStaffAuth';

/** Admin panel: FastAPI `/api/v1/admin/staff/` — localStorage emas. */
export type StaffDirectoryEntry = {
  phone_digits: string;
  phone_display: string;
  first_name: string;
  last_name: string;
  display_name: string;
  role: UserRole | '';
  faculty: string;
  department: string;
  department_id?: number | null;
  direction: string;
  participant_kind: 'student' | 'employee' | '';
  study_group: string;
  job_title: string;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchStaffDirectory(): Promise<StaffDirectoryEntry[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const pageSize = 1000;
  const first = await httpJson<StaffDirectoryEntry[] | PagedResponse<StaffDirectoryEntry>>(
    `${apiBaseUrl()}/v1/admin/staff/?page_size=${pageSize}&page=1`,
    {
      headers: authHeaders(token),
      timeoutMs: 30000,
    },
  );
  const rows = unwrapPagedResults(first);
  if (Array.isArray(first)) return rows;
  const total = typeof first.count === 'number' ? first.count : rows.length;
  if (rows.length >= total) return rows;
  const all = [...rows];
  let page = 2;
  while (all.length < total) {
    const next = await httpJson<StaffDirectoryEntry[] | PagedResponse<StaffDirectoryEntry>>(
      `${apiBaseUrl()}/v1/admin/staff/?page_size=${pageSize}&page=${page}`,
      {
        headers: authHeaders(token),
        timeoutMs: 30000,
      },
    );
    const chunk = unwrapPagedResults(next);
    if (!chunk.length) break;
    all.push(...chunk);
    page += 1;
  }
  return all;
}

export type StaffUpsertInput = {
  phone_digits: string;
  password?: string;
  role?: UserRole;
  first_name?: string;
  last_name?: string;
  faculty?: string;
  department?: string;
  department_id?: number | null;
  direction?: string;
  participant_kind?: 'student' | 'employee';
  study_group?: string;
  job_title?: string;
};

/** FastAPI: POST `/api/v1/auth/admin-provision-staff/` — yaratish yoki tahrirlash. */
export async function upsertStaffMember(
  input: StaffUpsertInput,
): Promise<{ username: string; role: string; created: boolean }> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-admin-token');
  return httpJson(`${apiBaseUrl()}/v1/auth/admin-provision-staff/`, {
    method: 'POST',
    headers: authHeaders(token),
    body: {
      ...input,
      // Bo'sh parol = tahrirda o'zgarmasin (FastAPI default "").
      password: input.password ?? '',
    },
    timeoutMs: 20000,
  });
}

/** FastAPI: POST `/api/v1/auth/admin-deprovision-staff/` — 204. */
export async function removeStaffMember(phoneDigits: string): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-admin-token');
  await httpJson(`${apiBaseUrl()}/v1/auth/admin-deprovision-staff/`, {
    method: 'POST',
    headers: authHeaders(token),
    body: { phone_digits: phoneDigits },
    timeoutMs: 20000,
  });
}
