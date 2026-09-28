/**
 * O'qituvchi sozlamalari — o'zi bajaradigan ishlar (backend `routes/staff_self.py`).
 * Hammasi faqat O'Z ma'lumotiga yoki O'Z kafedrasiga ta'sir qiladi.
 */
import { HttpError, httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return { Authorization: `Bearer ${token}` };
}

export function errorText(err: unknown, fallback: string): string {
  if (err instanceof HttpError) {
    const detail = (err.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string' && detail) return detail;
  }
  return fallback;
}

// ---------------------------------------------------------------- profil

export type MyProfile = {
  login: string;
  first_name: string;
  last_name: string;
  job_title: string;
  faculty: string;
  department_id: number | null;
  department: string;
  face_linked: boolean;
  pinfl_linked: boolean;
};

export type Department = { id: number; name: string };

export async function fetchMyProfile(): Promise<MyProfile> {
  return httpJson<MyProfile>(`${apiBaseUrl()}/v1/staff/me/profile/`, { headers: await authHeaders() });
}

export async function saveMyProfile(input: {
  first_name: string;
  last_name: string;
  job_title: string;
  department_id: number | null;
}): Promise<MyProfile> {
  return httpJson<MyProfile>(`${apiBaseUrl()}/v1/staff/me/profile/`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: input,
  });
}

export async function fetchDepartments(): Promise<Department[]> {
  return httpJson<Department[]>(`${apiBaseUrl()}/v1/staff/departments/`, {
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
}

// ---------------------------------------------------------------- kafedra kutubxonasi

export type LibraryItem = {
  id: number;
  title: string;
  kind: 'book' | 'protocol';
  status: 'ready' | 'processing' | 'failed';
  status_note: string;
  chunk_count: number;
  owner_key: string;
  uploader_name: string;
  can_delete: boolean;
  created_at: string | null;
};

export async function fetchLibrary(): Promise<{ department: string; items: LibraryItem[] }> {
  return httpJson(`${apiBaseUrl()}/v1/staff/library/`, { headers: await authHeaders(), timeoutMs: 30000 });
}

export async function uploadLibraryItem(file: File, kind: 'book' | 'protocol', title: string): Promise<LibraryItem> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  form.append('title', title);
  const res = await fetch(`${apiBaseUrl()}/v1/staff/library/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, body);
  return body as LibraryItem;
}

export async function deleteLibraryItem(id: number): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/staff/library/${id}/`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => null);
    throw new HttpError(`HTTP ${res.status}`, res.status, body);
  }
}
