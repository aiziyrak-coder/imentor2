import { httpJson } from '../api/httpClient';
import { unwrapPagedResults, type PagedResponse } from '../api/pagedResults';
import type { AppLanguage } from '../i18n/language';
import { translate } from '../i18n/translations';
import { getBackendAccessToken } from './backendAuth';
import type { CaseStudySession, TestSession } from '../services/aiService';

export type CatalogKind = 'case' | 'test';

export type CatalogItemSummary = {
  id: number;
  kind: CatalogKind;
  topic: string;
  topic_norm: string;
  subject_name: string;
  subject_code: string;
  /** Kafedra — public katalogda filtrlash uchun (API `catalog_item_summary` beradi). */
  department_name?: string;
  department_code?: string;
  variant_label: string;
  topic_code: string;
  syllabus_id: number | null;
  author_display_name: string;
  owner_key: string;
  created_at: string;
  question_count: number;
  is_published: boolean;
  publish_at: string;
};

export type CatalogStatsTotals = {
  case_count: number;
  test_count: number;
  total_count: number;
  questions_total: number;
  published_count: number;
  pending_publish_count: number;
  authors_distinct: number;
  subjects_distinct: number;
  variants_distinct: number;
  topics_distinct: number;
  created_last_7d: number;
  created_last_30d: number;
};

export type CatalogStatsSubjectRow = {
  subject_code: string;
  subject_name: string;
  case_count: number;
  test_count: number;
  total_count: number;
  questions_total: number;
  pending_publish_count: number;
  variants_distinct: number;
  topics_distinct: number;
};

export type CatalogStatsVariantRow = {
  subject_code: string;
  subject_name: string;
  variant_label: string;
  case_count: number;
  test_count: number;
  total_count: number;
  questions_total: number;
  topics_distinct: number;
};

export type CatalogStatsTopicRow = {
  subject_code: string;
  subject_name: string;
  variant_label: string;
  topic_code: string;
  topic: string;
  case_count: number;
  test_count: number;
  total_count: number;
  questions_total: number;
};

export type CatalogStatsAuthorRow = {
  owner_key: string;
  author_display_name: string;
  case_count: number;
  test_count: number;
  total_count: number;
  questions_total: number;
};

export type CatalogStats = {
  generated_at: string;
  kind: string;
  totals: CatalogStatsTotals;
  by_subject: CatalogStatsSubjectRow[];
  by_variant: CatalogStatsVariantRow[];
  by_topic: CatalogStatsTopicRow[];
  by_author: CatalogStatsAuthorRow[];
  recent: CatalogItemSummary[];
};

export type CatalogSubjectRow = {
  subject_code: string;
  subject_name: string;
  case_count: number;
  test_count: number;
  total_count: number;
};

export type CatalogItemDetail = CatalogItemSummary & {
  payload: CaseStudySession | TestSession;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchCatalogSubjects(): Promise<CatalogSubjectRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const rows = await httpJson<CatalogSubjectRow[]>(`${apiBaseUrl()}/v1/content-catalog/subjects/`, {
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchCatalogItems(params: {
  kind?: CatalogKind | '';
  subjectCode?: string;
  q?: string;
  author?: string;
  sort?: 'subject' | 'topic' | 'newest';
}): Promise<CatalogItemSummary[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const query = new URLSearchParams();
  if (params.kind) query.set('kind', params.kind);
  if (params.subjectCode) query.set('subject_code', params.subjectCode);
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.author?.trim()) query.set('author', params.author.trim());
  if (params.sort) query.set('sort', params.sort);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const data = await httpJson<CatalogItemSummary[] | PagedResponse<CatalogItemSummary>>(
    `${apiBaseUrl()}/v1/content-catalog/${suffix}`,
    {
      headers: authHeaders(token),
      timeoutMs: 30000,
    },
  );
  return unwrapPagedResults(data);
}

export async function fetchCatalogItemDetail(id: number): Promise<CatalogItemDetail | null> {
  const token = await getBackendAccessToken();
  if (!token) return null;
  try {
    return await httpJson<CatalogItemDetail>(`${apiBaseUrl()}/v1/content-catalog/${id}/`, {
      headers: authHeaders(token),
      timeoutMs: 30000,
    });
  } catch {
    return null;
  }
}

// ——— Admin: cheklovsiz (1 soatlik e'lon kechikishisiz) ko'rish va o'chirish ———

export async function fetchAdminCatalogItems(params: {
  kind?: CatalogKind | '';
  subjectCode?: string;
  q?: string;
}): Promise<CatalogItemSummary[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const query = new URLSearchParams();
  if (params.kind) query.set('kind', params.kind);
  if (params.subjectCode) query.set('subject_code', params.subjectCode);
  if (params.q?.trim()) query.set('q', params.q.trim());
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const data = await httpJson<CatalogItemSummary[] | PagedResponse<CatalogItemSummary>>(
    `${apiBaseUrl()}/v1/admin/content-catalog/${suffix}`,
    {
      headers: authHeaders(token),
      timeoutMs: 30000,
    },
  );
  return unwrapPagedResults(data);
}

export async function fetchAdminCatalogItemDetail(id: number): Promise<CatalogItemDetail | null> {
  const token = await getBackendAccessToken();
  if (!token) return null;
  try {
    return await httpJson<CatalogItemDetail>(`${apiBaseUrl()}/v1/admin/content-catalog/${id}/`, {
      headers: authHeaders(token),
      timeoutMs: 30000,
    });
  } catch {
    return null;
  }
}

export async function deleteAdminCatalogItem(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/content-catalog/${id}/`, {
    method: 'DELETE',
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
}

/** Ochiq baza umumiy raqamlari — landing sahifa uchun, token talab qilinmaydi. */
export async function fetchPublicCatalogTotals(): Promise<CatalogStatsTotals | null> {
  const stats = await httpJson<CatalogStats>(`${apiBaseUrl()}/v1/public/content-catalog/stats/`, {
    timeoutMs: 15000,
  });
  return stats?.totals ?? null;
}

export async function fetchAdminCatalogStats(params?: {
  kind?: CatalogKind | '';
}): Promise<CatalogStats | null> {
  const token = await getBackendAccessToken();
  if (!token) return null;
  const query = new URLSearchParams();
  if (params?.kind) query.set('kind', params.kind);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return httpJson<CatalogStats>(`${apiBaseUrl()}/v1/admin/content-catalog/stats/${suffix}`, {
    headers: authHeaders(token),
    timeoutMs: 30000,
  });
}

export function groupCatalogBySubject(
  items: CatalogItemSummary[],
  lang: AppLanguage = 'uz',
): Map<string, CatalogItemSummary[]> {
  const map = new Map<string, CatalogItemSummary[]>();
  const fallbackSubject = translate(lang, 'catalog.otherTopics');
  for (const item of items) {
    const key = item.subject_name?.trim() || fallbackSubject;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  for (const [key, list] of map) {
    list.sort((a, b) => a.topic.localeCompare(b.topic, 'uz'));
    map.set(key, list);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'uz')));
}
