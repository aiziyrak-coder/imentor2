import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

/** Admin: cam.fermi.uz'dan nusxalangan yuz va unga bog'langan iMentor hisobi. */
export type FaceLink = {
  id: number;
  full_name: string;
  position: string;
  owner_key: string;
  owner_name: string;
  owner_department: string;
  /** "auto" — ism-familiya bo'yicha; "admin" — qo'lda; "" — bog'lanmagan. */
  link_source: string;
  is_active: boolean;
  suggestions: { username: string; name: string; department: string }[];
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

export async function fetchFaceLinks(): Promise<FaceLink[]> {
  return httpJson<FaceLink[]>(`${apiBaseUrl()}/v1/admin/face-links/`, {
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
}

/** `ownerKey` bo'sh — bog'lanishni olib tashlash. */
export async function updateFaceLink(id: number, ownerKey: string): Promise<FaceLink> {
  return httpJson<FaceLink>(`${apiBaseUrl()}/v1/admin/face-links/${id}/`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: { owner_key: ownerKey },
    timeoutMs: 20000,
  });
}
