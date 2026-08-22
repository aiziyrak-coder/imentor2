import { getCurrentLocalUser } from './localStaffAuth';
import { HttpError, httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import { topicNormLookupKeys, topicNormsOverlap } from './syllabusTopicContext';
import type { SyllabusTopic } from '../services/aiService';
import type { SyllabusTopicContext } from './syllabusTopicContext';

export type PreparedContentKind = 'lecture' | 'presentation' | 'case' | 'test';

export type PreparedContentMeta = {
  authorDisplayName?: string;
  subjectName?: string;
  subjectCode?: string;
  variantLabel?: string;
  topicCode?: string;
  topicNorm?: string;
};

export type PreparedContentSummary = {
  id: string;
  topic: string;
  topicNorm?: string;
  createdAt: number;
  source: 'local' | 'cloud';
  /** Kim yaratgan — versiyalar ro'yxatida ko'rsatiladi. */
  author?: string;
  /** False bo'lsa o'chirish tugmasi chiqmaydi (boshqa o'qituvchiniki). */
  canDelete?: boolean;
};

const CLOUD_ID_PREFIX = 'cloud_';

function ownerKey(): string | null {
  const u = getCurrentLocalUser();
  if (!u) return null;
  return u.phoneDigits || u.uid || null;
}

export function normTopicKey(topic: string): string {
  return topic.trim().toLowerCase();
}

function normTopic(topic: string): string {
  return normTopicKey(topic);
}

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function requireAuthToken(): Promise<string> {
  const token = await getBackendAccessToken();
  if (!token) {
    throw new Error('Tizimga kiring — kontent FastAPI bazasiga saqlanadi.');
  }
  return token;
}

/** data:URL rasmlar JSON ni shishiradi — PPTXda allaqachon bor, bazaga yozilmaydi. */
function stripHeavyMediaFromPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const deck = payload as { slides?: unknown };
  if (!Array.isArray(deck.slides)) return payload;
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      if (!slide || typeof slide !== 'object') return slide;
      const s = slide as Record<string, unknown>;
      const imageUrl = typeof s.imageUrl === 'string' ? s.imageUrl : '';
      if (!imageUrl.startsWith('data:')) return slide;
      const { imageUrl: _drop, ...rest } = s;
      return rest;
    }),
  };
}

function cloudId(numericId: number | string): string {
  return `${CLOUD_ID_PREFIX}${numericId}`;
}

function parseCloudNumericId(id: string): string | null {
  if (id.startsWith(CLOUD_ID_PREFIX)) return id.slice(CLOUD_ID_PREFIX.length);
  if (/^\d+$/.test(id)) return id;
  return null;
}

type CloudRow = {
  id: number;
  topic: string;
  topic_norm?: string;
  payload?: unknown;
  created_at: string;
};

/** Saqlash — AI generatsiyasidan keyingi eng muhim qadam: bu yerda yiqilsa
 * o'qituvchining bir necha daqiqalik ishi yo'qoladi. Shuning uchun:
 *  - timeout uzun (payload katta, mobil internet sekin bo'lishi mumkin),
 *  - vaqtinchalik xatolarda (tarmoq, timeout, 5xx) qisqa kutib qayta uriniladi.
 * 4xx (validatsiya/autentifikatsiya) da qayta urinilmaydi — natija o'zgarmaydi. */
async function postWithRetry(
  url: string,
  token: string,
  body: unknown,
): Promise<{ id?: number } | null> {
  const delaysMs = [800, 2500];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await httpJson<{ id?: number }>(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
        timeoutMs: 60_000,
      });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 0;
      const retriable = status === 0 || status === 429 || status >= 500;
      if (!retriable || attempt >= delaysMs.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

/** Asosiy saqlash — FastAPI `/v1/prepared-content/` (Postgres). localStorage ishlatilmaydi.
 * Qaytaradi: yaratilgan yozuvning Baza id'si (`cloud_<n>`) — chaqiruvchi uni
 * keyinroq yangilashi (PATCH) yoki fayl bilan bog'lashi mumkin. Server id
 * qaytarmasa `null`. */
export async function savePreparedContent(
  kind: PreparedContentKind,
  topic: string,
  payload: unknown,
  meta?: PreparedContentMeta,
): Promise<string | null> {
  const owner = ownerKey();
  if (!owner) {
    throw new Error('Tizimga kiring — kontent FastAPI bazasiga saqlanadi.');
  }
  const token = await requireAuthToken();
  const topicNorm = meta?.topicNorm?.trim() || normTopic(topic);
  const lightPayload = stripHeavyMediaFromPayload(payload);

  const created = await postWithRetry(`${apiBaseUrl()}/v1/prepared-content/`, token, {
      owner_key: owner,
      kind,
      topic: topic.trim() || 'Nomsiz',
      topic_norm: topicNorm,
      author_display_name: meta?.authorDisplayName?.trim() || '',
      subject_name: meta?.subjectName?.trim() || '',
      subject_code: meta?.subjectCode?.trim() || '',
      variant_label: meta?.variantLabel?.trim() || '',
      topic_code: meta?.topicCode?.trim() || '',
      payload: lightPayload,
  });
  return created?.id != null ? cloudId(created.id) : null;
}

/** Mavjud yozuvning payload'ini almashtirish — Bazada nusxa ko'paymasligi uchun.
 * Masalan test avval asosiy tilda saqlanadi, tarjimalar tayyor bo'lgach
 * SHU yozuv yangilanadi. */
export async function updatePreparedContentPayload(
  id: string,
  payload: unknown,
): Promise<boolean> {
  const numericId = parseCloudNumericId(id);
  if (!numericId) return false;
  const token = await getBackendAccessToken();
  if (!token) return false;
  try {
    await httpJson(`${apiBaseUrl()}/v1/prepared-content/${numericId}/`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: { payload: stripHeavyMediaFromPayload(payload) },
      timeoutMs: 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** `cloud_12` → `12` (Baza id'sini fayl nomiga bog'lash uchun). */
export function preparedContentNumericId(id: string): string | null {
  return parseCloudNumericId(id);
}

/** @deprecated Faqat sync ro'yxatdan foydalaning — localStorage o'chirilgan. */
export function listPreparedForTopic(
  _kind: PreparedContentKind,
  _topic: SyllabusTopic | SyllabusTopicContext | string,
): PreparedContentSummary[] {
  return [];
}

/** @deprecated localStorage o'rniga `listAllPreparedForKindSynced` ishlating. */
export function listAllPreparedForKind(_kind: PreparedContentKind): PreparedContentSummary[] {
  return [];
}

type MineRow = {
  id: number;
  topic: string;
  topic_norm?: string;
  author_display_name?: string;
  created_at: string;
  can_delete?: boolean;
};

const MINE_PAGE_SIZE = 300;
/** Xavfsizlik chegarasi — server nosoz javob bersa cheksiz aylanmaslik uchun. */
const MINE_MAX_PAGES = 20;

/** `/v1/prepared-content/mine/` — BARCHA sahifalarni yig'ib oladi.
 * Ilgari faqat birinchi 200 ta yozuv olinardi va faol o'qituvchida eski
 * materiallar Bazadan butunlay yo'qolganday ko'rinardi. */
async function fetchMineRows(
  kind: PreparedContentKind,
  topicNorms?: string[],
  options?: {
    shared?: boolean;
    syllabusId?: number;
    topicCode?: string;
    variantLabel?: string;
  },
): Promise<PreparedContentSummary[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const out: PreparedContentSummary[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= MINE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      kind,
      page: String(page),
      page_size: String(MINE_PAGE_SIZE),
    });
    if (options?.shared) params.set('shared', '1');
    if (options?.syllabusId) params.set('syllabus_id', String(options.syllabusId));
    if (options?.topicCode) params.set('topic_code', options.topicCode);
    if (options?.variantLabel) params.set('variant_label', options.variantLabel);
    for (const norm of topicNorms || []) params.append('topic_norm', norm);
    const data = await httpJson<{ results?: MineRow[]; count?: number }>(
      `${apiBaseUrl()}/v1/prepared-content/mine/?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const rows = data.results || [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({
        id: cloudId(r.id),
        topic: r.topic,
        topicNorm: r.topic_norm || normTopic(r.topic),
        author: r.author_display_name || '',
        createdAt: new Date(r.created_at).getTime(),
        source: 'cloud' as const,
        canDelete: r.can_delete !== false,
      });
    }
    // Backend `paginate` javobi: {count, page, page_size, results} — `next` yo'q,
    // shuning uchun to'xtash sharti sonlar bo'yicha.
    if (rows.length < MINE_PAGE_SIZE) break;
    if (typeof data.count === 'number' && out.length >= data.count) break;
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** FastAPI `/v1/prepared-content/mine/` — foydalanuvchi tarixi bazadan. */
export async function listAllPreparedForKindSynced(
  kind: PreparedContentKind,
): Promise<PreparedContentSummary[]> {
  try {
    return await fetchMineRows(kind);
  } catch {
    return [];
  }
}

/** Mavzu bo'yicha FastAPI tarix — filtrlash SERVERDA, aniq `topic_norm`
 * tenglik bo'yicha. Faqat tuzilmali kalit (`fan::variant::kod`) — sarlavha
 * bo'yicha qidiruv fanlarni aralashtirardi. */
export async function listPreparedForTopicSynced(
  kind: PreparedContentKind,
  topic: SyllabusTopic | SyllabusTopicContext | string,
  options?: { shared?: boolean },
): Promise<PreparedContentSummary[]> {
  const wantedKeys = (
    typeof topic === 'string' ? [normTopic(topic)] : topicNormLookupKeys(topic)
  )
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.includes('::'));
  const syllabusId =
    typeof topic === 'object' && topic && 'syllabusId' in topic ? topic.syllabusId : undefined;
  const topicCode =
    typeof topic === 'object' && topic?.id
      ? topic.id.trim().toLowerCase().replace(/\s+/g, '')
      : '';
  const variantLabel =
    typeof topic === 'object' && topic && 'variantLabel' in topic ? topic.variantLabel || '' : '';
  if (!wantedKeys.length && !(syllabusId && topicCode)) return [];
  try {
    const rows = await fetchMineRows(kind, wantedKeys, {
      ...options,
      syllabusId,
      topicCode,
      variantLabel,
    });
    if (!wantedKeys.length) return rows;
    return rows.filter((r) => topicNormsOverlap(r.topicNorm || '', wantedKeys));
  } catch {
    return [];
  }
}

/** @deprecated local id endi yo'q — `loadPreparedByIdSynced` ishlating. */
export function loadPreparedById<T>(_kind: PreparedContentKind, _id: string): T | null {
  return null;
}

/** FastAPI `/v1/prepared-content/{id}/` — to'liq payload. */
export async function loadPreparedByIdSynced<T>(
  kind: PreparedContentKind,
  id: string,
): Promise<T | null> {
  const numericId = parseCloudNumericId(id);
  if (!numericId) return null;
  try {
    const token = await getBackendAccessToken();
    if (!token) return null;
    const data = await httpJson<{ payload?: T; kind?: string }>(
      `${apiBaseUrl()}/v1/prepared-content/${numericId}/`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (data.kind && data.kind !== kind) return null;
    return data.payload ?? null;
  } catch {
    return null;
  }
}

export async function deletePreparedContent(kind: PreparedContentKind, id: string): Promise<void> {
  const numericId = parseCloudNumericId(id);
  if (!numericId) return;
  const token = await requireAuthToken();
  await httpJson(`${apiBaseUrl()}/v1/prepared-content/${numericId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  void kind;
}

/** FastAPI latest by topic_norm — birinchi mos kelgan kalit. */
export async function loadLatestPreparedContent<T>(
  kind: PreparedContentKind,
  topic: SyllabusTopic | SyllabusTopicContext | string,
): Promise<T | null> {
  const lookupKeys = (
    typeof topic === 'string' ? [normTopic(topic)] : topicNormLookupKeys(topic)
  )
    .map((k) => k.toLowerCase())
    .filter((k) => k.includes('::'));
  const syllabusId =
    typeof topic === 'object' && topic && 'syllabusId' in topic ? topic.syllabusId : undefined;
  const topicCode =
    typeof topic === 'object' && topic?.id
      ? topic.id.trim().toLowerCase().replace(/\s+/g, '')
      : '';
  if (!lookupKeys.length && !(syllabusId && topicCode)) return null;

  try {
    const token = await getBackendAccessToken();
    if (!token) return null;
    const params = new URLSearchParams({ kind });
    if (lookupKeys[0]) params.set('topic_norm', lookupKeys[0]);
    if (syllabusId) params.set('syllabus_id', String(syllabusId));
    if (topicCode) params.set('topic_code', topicCode);
    const data = await httpJson<{
      id?: number;
      payload?: unknown;
      created_at?: string;
    } & CloudRow>(
      `${apiBaseUrl()}/v1/prepared-content/?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (data.payload == null) return null;
    return data.payload as T;
  } catch {
    return null;
  }
}
