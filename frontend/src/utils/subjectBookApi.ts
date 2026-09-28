import { HttpError, httpJson } from '../api/httpClient';
import { unwrapPagedResults, type PagedResponse } from '../api/pagedResults';
import { getBackendAccessToken } from './backendAuth';

export type SubjectBookItem = {
  id: number;
  department: number;
  department_name: string;
  department_code: string;
  title: string;
  source_archive: string;
  language: string;
  page_count: number;
  chunk_count: number;
  file_url: string;
  file_size: number;
  is_active: boolean;
  /** "book" — darslik; "protocol" — milliy klinik protokol, SanPin, SSV buyrug'i. */
  kind?: 'book' | 'protocol';
  created_at: string;
};

export type SubjectBookDepartmentStat = {
  id: number;
  code: string;
  name: string;
  books_count: number;
  chunks_count: number;
  protocols_count?: number;
};

export type SubjectBookStats = {
  departments_count: number;
  books_count: number;
  by_department: SubjectBookDepartmentStat[];
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

export async function fetchAdminSubjectBookStats(): Promise<SubjectBookStats> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<SubjectBookStats>(`${apiBaseUrl()}/v1/admin/subject-books/stats/`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
}

export async function fetchAdminSubjectBooks(): Promise<SubjectBookItem[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<SubjectBookItem[] | PagedResponse<SubjectBookItem>>(
    `${apiBaseUrl()}/v1/admin/subject-books/?page_size=300`,
    { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 30000 },
  );
  return unwrapPagedResults(data);
}

export async function deleteAdminSubjectBook(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const res = await fetch(`${apiBaseUrl()}/v1/admin/subject-books/${id}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new HttpError(`HTTP ${res.status}`, res.status, text || null);
  }
}
