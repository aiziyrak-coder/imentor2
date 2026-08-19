import { HttpError } from '../api/httpClient';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getBackendAccessToken } from './backendAuth';
import { normTopicKey } from './preparedContentStore';
import {
  primaryPresentationTopicNorm,
  resolvePresentationTopicNorms,
} from './presentationTopicNorm';
import type { SyllabusTopicContext } from './syllabusTopicContext';

export type PresentationKind = 'pdf' | 'ppt' | 'pptx';

export type TopicPresentationItem = {
  id: number;
  owner_key: string;
  author_name: string;
  topic: string;
  topic_norm: string;
  title: string;
  kind: PresentationKind;
  file_name: string;
  file_size: number;
  file_url: string;
  can_delete: boolean;
  sort_order: number;
  created_at: string;
};

const blobCache = new Map<number, string>();

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

export function resolvePresentationFileUrl(fileUrl: string): string {
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

export async function getPresentationFileBlobUrl(id: number): Promise<string> {
  const cached = blobCache.get(id);
  if (cached) return cached;
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const res = await fetchWithTimeout(`${apiBaseUrl()}/v1/presentations/${id}/file/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  blobCache.set(id, url);
  return url;
}

const previewBlobCache = new Map<number, string>();

/** Brauzer preview: backend LibreOffice orqali PPTX→PDF. */
export async function getPresentationPreviewBlobUrl(id: number): Promise<string> {
  const cached = previewBlobCache.get(id);
  if (cached) return cached;
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const res = await fetchWithTimeout(`${apiBaseUrl()}/v1/presentations/${id}/preview/`, {
    headers: { Authorization: `Bearer ${token}` },
  }, 180_000);
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  previewBlobCache.set(id, url);
  return url;
}

export function normPresentationTopic(topic: string): string {
  return normTopicKey(topic);
}

/**
 * Mavzu bo'yicha taqdimotlar.
 *
 * `onlyMine` (standart: false) — shu fan/mavzudagi barcha fayllar.
 * `onlyMine: true` — faqat joriy foydalanuvchiniki.
 */
export async function fetchPresentationsForTopic(
  topic: string | SyllabusTopicContext,
  options?: { onlyMine?: boolean },
): Promise<TopicPresentationItem[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const norms = resolvePresentationTopicNorms(topic);
  if (!norms.length) return [];
  const query = new URLSearchParams();
  if (
    typeof topic === 'object' &&
    topic &&
    'syllabusId' in topic &&
    topic.syllabusId != null &&
    topic.id
  ) {
    query.set('syllabus_id', String(topic.syllabusId));
    query.set('variant_label', topic.variantLabel || 'asosiy');
    query.set('topic_code', topic.id);
  }
  for (const norm of norms) {
    query.append('topic_norm', norm);
  }
  if (options?.onlyMine) query.set('mine', '1');
  const res = await fetchWithTimeout(`${apiBaseUrl()}/v1/presentations/?${query.toString()}`, {
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
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, data);
  const rows = Array.isArray(data) ? (data as TopicPresentationItem[]) : [];
  const allowed = new Set(norms.map((n) => n.trim().toLowerCase()));
  return rows.filter((row) => allowed.has((row.topic_norm || '').trim().toLowerCase()));
}

function clipField(value: string, max: number): string {
  const s = value.trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

export async function uploadPresentation(params: {
  topic: string;
  file: File;
  title?: string;
  context?: SyllabusTopicContext;
}): Promise<TopicPresentationItem> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const topicNorm = params.context
    ? primaryPresentationTopicNorm(params.context)
    : normPresentationTopic(params.topic);
  // Backend CharField max_length=255 — uzun syllabus sarlavhalari 400 bermasin
  const topic = clipField(params.topic, 255);
  const title = params.title?.trim() ? clipField(params.title, 255) : '';
  const form = new FormData();
  form.append('topic', topic);
  form.append('topic_norm', clipField(topicNorm, 255));
  form.append('file', params.file);
  if (title) form.append('title', title);
  if (params.context && params.context.syllabusId != null && params.context.id) {
    form.append('syllabus_id', String(params.context.syllabusId));
    form.append('variant_label', params.context.variantLabel || 'asosiy');
    form.append('topic_code', params.context.id);
  }

  const res = await fetch(`${apiBaseUrl()}/v1/presentations/`, {
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
  return data as TopicPresentationItem;
}

export async function deletePresentation(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const res = await fetch(`${apiBaseUrl()}/v1/presentations/${id}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new HttpError(`HTTP ${res.status}`, res.status, null);
  }
  const cached = blobCache.get(id);
  if (cached) {
    URL.revokeObjectURL(cached);
    blobCache.delete(id);
  }
}

export function isAllowedPresentationFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ['.pdf', '.ppt', '.pptx'].some((e) => name.endsWith(e));
}
