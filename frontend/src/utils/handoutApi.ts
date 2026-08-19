import { HttpError, httpJson } from '../api/httpClient';
import { fetchWithTimeout } from './fetchWithTimeout';
import { unwrapPagedResults, type PagedResponse } from '../api/pagedResults';
import { getBackendAccessToken } from './backendAuth';
import { normTopicKey } from './preparedContentStore';
import {
  handoutMatchesTopic,
  isTopicContextComplete,
  resolveTopicNorm,
  topicNormLookupKeys,
  type SyllabusTopicContext,
} from './syllabusTopicContext';
import type { SyllabusTopic } from '../services/aiService';

export type HandoutKind = 'pdf' | 'image';

export type TopicHandoutItem = {
  id: number;
  owner_key: string;
  author_name: string;
  topic: string;
  topic_norm: string;
  title: string;
  kind: HandoutKind;
  file_name: string;
  file_size: number;
  file_url: string;
  can_delete: boolean;
  sort_order: number;
  created_at: string;
  language?: 'uz' | 'ru' | 'en' | string;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

/** Brauzerda ko‘rish: /media/ har doim frontend domeni orqali (nginx proxy). */
const handoutBlobCache = new Map<number, string>();

export async function getHandoutFileBlobUrl(id: number): Promise<string> {
  const cached = handoutBlobCache.get(id);
  if (cached) return cached;
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const res = await fetchWithTimeout(`${apiBaseUrl()}/v1/handouts/${id}/file/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  handoutBlobCache.set(id, url);
  return url;
}

export function revokeHandoutBlobUrl(id: number): void {
  const url = handoutBlobCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    handoutBlobCache.delete(id);
  }
}

export function resolveHandoutFileUrl(fileUrl: string): string {
  if (!fileUrl) return '';
  try {
    const u = new URL(fileUrl, window.location.origin);
    if (u.pathname.startsWith('/media/')) {
      return `${window.location.origin}${u.pathname}${u.search}`;
    }
    return u.href;
  } catch {
    if (fileUrl.startsWith('/')) return `${window.location.origin}${fileUrl}`;
    return fileUrl;
  }
}

export function normHandoutTopic(topic: string | SyllabusTopic | SyllabusTopicContext): string {
  if (typeof topic === 'string') return normTopicKey(topic);
  return resolveTopicNorm(topic) || normTopicKey(topic.title);
}

export function handoutLanguage(item: TopicHandoutItem | { language?: string } | null | undefined): 'uz' | 'ru' | 'en' {
  const raw = (item?.language || 'uz').trim().toLowerCase();
  if (raw === 'ru' || raw === 'en') return raw;
  return 'uz';
}

export async function fetchHandoutsForTopic(
  topic: string | SyllabusTopic | SyllabusTopicContext,
  language?: string,
): Promise<TopicHandoutItem[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const lookupKeys = topicNormLookupKeys(topic);
  if (
    lookupKeys.length === 0 &&
    (typeof topic === 'string' ||
      !isTopicContextComplete(topic))
  ) {
    return [];
  }
  const params = new URLSearchParams();
  if (typeof topic !== 'string' && isTopicContextComplete(topic)) {
    params.set('syllabus_id', String(topic.syllabusId));
    params.set('variant_label', topic.variantLabel || 'asosiy');
    params.set('topic_code', topic.id);
  }
  for (const key of lookupKeys) params.append('topic_norm', key);
  const lang = (language || '').trim().toLowerCase();
  if (lang === 'uz' || lang === 'ru' || lang === 'en') params.set('language', lang);
  const res = await fetchWithTimeout(`${apiBaseUrl()}/v1/handouts/?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data: unknown = [];
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, res.status, data);
  }
  const rows = Array.isArray(data) ? (data as TopicHandoutItem[]) : [];
  const wanted = lang === 'ru' || lang === 'en' || lang === 'uz' ? lang : '';
  return rows.filter((row) => {
    if (!handoutMatchesTopic(row, topic)) return false;
    if (!wanted) return true;
    return handoutLanguage(row) === wanted;
  });
}

export async function uploadHandout(params: {
  topic: string | SyllabusTopic | SyllabusTopicContext;
  file: File;
  title?: string;
  language?: string;
}): Promise<TopicHandoutItem> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const displayTopic =
    typeof params.topic === 'string' ? params.topic.trim() : params.topic.title.trim();
  const form = new FormData();
  form.append('topic', displayTopic);
  if (typeof params.topic !== 'string' && isTopicContextComplete(params.topic)) {
    form.append('syllabus_id', String(params.topic.syllabusId));
    form.append('variant_label', params.topic.variantLabel || 'asosiy');
    form.append('topic_code', params.topic.id);
  }
  form.append('topic_norm', normHandoutTopic(params.topic));
  form.append('file', params.file);
  form.append('language', (params.language || 'uz').trim().toLowerCase() || 'uz');
  if (params.title?.trim()) form.append('title', params.title.trim());

  const res = await fetch(`${apiBaseUrl()}/v1/handouts/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, res.status, data);
  }
  return data as TopicHandoutItem;
}

export async function deleteHandout(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const res = await fetch(`${apiBaseUrl()}/v1/handouts/${id}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore */
    }
    throw new HttpError(`HTTP ${res.status}`, res.status, data);
  }
}

// ——— Admin: tarqatmalarni boshqarish (o'qituvchi faqat ko'radi) ———

export async function fetchAdminHandouts(): Promise<TopicHandoutItem[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<TopicHandoutItem[] | PagedResponse<TopicHandoutItem>>(
    `${apiBaseUrl()}/v1/admin/handouts/?page_size=500`,
    { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 30000 },
  );
  return unwrapPagedResults(data);
}

export async function uploadAdminHandout(params: {
  syllabusId: number;
  variantLabel: string;
  topicCode: string;
  topic: string;
  title?: string;
  language?: string;
  file: File;
}): Promise<TopicHandoutItem> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const form = new FormData();
  form.append('topic', params.topic.trim());
  form.append('syllabus_id', String(params.syllabusId));
  form.append('variant_label', params.variantLabel);
  form.append('topic_code', params.topicCode);
  form.append('file', params.file);
  form.append('language', (params.language || 'uz').trim().toLowerCase() || 'uz');
  if (params.title?.trim()) form.append('title', params.title.trim());

  const res = await fetch(`${apiBaseUrl()}/v1/admin/handouts/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, data);
  return data as TopicHandoutItem;
}

export async function deleteAdminHandout(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/handouts/${Number(id)}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 20000,
  });
}

export { isAllowedHandoutFile, HANDOUT_FILE_ACCEPT, handoutFileTypeLabel } from './handoutFileTypes';
