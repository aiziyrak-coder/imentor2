import { httpJson } from '../api/httpClient';
import { unwrapPagedResults, type PagedResponse } from '../api/pagedResults';
import { getBackendAccessToken } from './backendAuth';
import { isStructuredTopicNorm } from './syllabusTopicContext';

export type TopicVideo = {
  id: number;
  topic: string;
  topic_norm: string;
  title: string;
  youtube_id: string;
  youtube_url: string;
  embed_url: string;
  author_name: string;
  created_at: string;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function matchesTopic(row: TopicVideo, syllabusId: number, variantLabel: string, topicCode: string): boolean {
  const norm = (row.topic_norm || '').trim().toLowerCase();
  if (!isStructuredTopicNorm(norm)) return false;
  const variant = (variantLabel || '').trim().toLowerCase() || 'asosiy';
  const code = topicCode.trim().toLowerCase().replace(/\s+/g, '');
  const expected = `${syllabusId}::${variant}::${code}`;
  const emptyVariant = `${syllabusId}::::${code}`;
  return norm === expected || (variant === 'asosiy' && norm === emptyVariant);
}

/** O'qituvchi: mavzu bo'yicha videolar (embed uchun) */
export async function fetchTopicVideos(params: {
  syllabusId: number;
  variantLabel: string;
  topicCode: string;
}): Promise<TopicVideo[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const variantLabel = params.variantLabel.trim() || 'asosiy';
  const query = new URLSearchParams({
    syllabus_id: String(params.syllabusId),
    variant_label: variantLabel,
    topic_code: params.topicCode,
  });
  try {
    const data = await httpJson<TopicVideo[]>(
      `${apiBaseUrl()}/v1/topic-videos/?${query.toString()}`,
      { headers: authHeaders(token), timeoutMs: 20000 },
    );
    const rows = Array.isArray(data) ? data : [];
    return rows.filter((row) => matchesTopic(row, params.syllabusId, variantLabel, params.topicCode));
  } catch {
    return [];
  }
}

/** Admin: barcha videolar */
export async function fetchAdminTopicVideos(): Promise<TopicVideo[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<TopicVideo[] | PagedResponse<TopicVideo>>(
    `${apiBaseUrl()}/v1/admin/topic-videos/?page_size=500`,
    { headers: authHeaders(token), timeoutMs: 30000 },
  );
  return unwrapPagedResults(data);
}

export async function createAdminTopicVideo(payload: {
  syllabusId: number;
  variantLabel: string;
  topicCode: string;
  topic: string;
  title?: string;
  youtubeUrl: string;
}): Promise<TopicVideo> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<TopicVideo>(`${apiBaseUrl()}/v1/admin/topic-videos/`, {
    method: 'POST',
    headers: authHeaders(token),
    body: {
      syllabus_id: payload.syllabusId,
      variant_label: payload.variantLabel,
      topic_code: payload.topicCode,
      topic: payload.topic,
      title: payload.title || '',
      youtube_url: payload.youtubeUrl,
    },
    timeoutMs: 20000,
  });
}

export async function deleteAdminTopicVideo(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const pk = Number(id);
  if (!Number.isFinite(pk) || pk <= 0) throw new Error('invalid-video-id');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/topic-videos/${pk}/`, {
    method: 'DELETE',
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
}
