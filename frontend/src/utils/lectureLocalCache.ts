import { peekBackendUsername } from './backendAuth';

/**
 * Oxirgi ma'ruza matni — mavzu ochilganda server javobini kutmasdan ko'rsatish uchun.
 *
 * 2026-10-07: kalit endi O'QITUVCHI + mavzu. Ilgari faqat mavzu edi, sinfdagi
 * monitor esa bitta brauzer: rus tilida o'tadigan o'qituvchining ma'ruzasi
 * keyingi (o'zbek) o'qituvchiga shu mavzuda chiqib qolardi, taqdimot ham
 * o'sha begona matndan yasalardi.
 */
const LECTURE_BY_TOPIC_KEY = 'imentor-lecture-by-topic-v3';
/** Eski, o'qituvchiga bog'lanmagan kesh — o'qilmaydi, birinchi murojaatda o'chiriladi. */
const LEGACY_KEYS = ['imentor-lecture-by-topic-v2'];

function dropLegacy(): void {
  for (const key of LEGACY_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function cacheKey(topicNorm: string): string {
  const owner = peekBackendUsername();
  return owner && topicNorm ? `${owner}::${topicNorm}` : '';
}

function readMap(): Record<string, string> {
  dropLegacy();
  try {
    const raw = localStorage.getItem(LECTURE_BY_TOPIC_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function readLectureForTopic(topicNorm: string): string {
  const key = cacheKey(topicNorm);
  if (!key) return '';
  return readMap()[key] ?? '';
}

export function writeLectureForTopic(topicNorm: string, content: string): void {
  const key = cacheKey(topicNorm);
  if (!key) return;
  try {
    const map = readMap();
    map[key] = content;
    localStorage.setItem(LECTURE_BY_TOPIC_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

/**
 * O'qituvchi "Ma'ruza matni"da hozir ochib turgan versiya (shu sessiya
 * davomida, xotirada). Taqdimot shu versiyadan quriladi — ilgari doim eng
 * oxirgisi olinardi, o'qituvchi eski versiyani tanlagan bo'lsa ham.
 */
const activeLectureVersionByNorm = new Map<string, string>();

export function rememberActiveLectureVersion(topicNorm: string, versionId: string | null): void {
  if (!topicNorm) return;
  if (versionId) activeLectureVersionByNorm.set(topicNorm, versionId);
  else activeLectureVersionByNorm.delete(topicNorm);
}

export function activeLectureVersion(topicNorm: string): string | null {
  return topicNorm ? activeLectureVersionByNorm.get(topicNorm) ?? null : null;
}

/** Chiqishda: umumiy monitorda keyingi o'qituvchiga hech narsa qolmasin. */
export function clearLectureCache(): void {
  dropLegacy();
  try {
    localStorage.removeItem(LECTURE_BY_TOPIC_KEY);
  } catch {
    /* ignore */
  }
}
