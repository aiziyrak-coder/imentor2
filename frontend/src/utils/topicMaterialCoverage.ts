import { listAllPreparedForKindSynced, type PreparedContentKind } from './preparedContentStore';
import { parseTopicNormParts } from './syllabusTopicContext';

/**
 * Qaysi mavzuga nima tayyorlangan.
 *
 * "Mening fanlarim" sahifasi o'ttizta mavzu nomini ko'rsatardi va tamom —
 * o'qituvchi qaysinisiga ma'ruza yozganini, qaysinisi hali bo'shligini
 * faqat har biriga birma-bir kirib bilardi. Endi ro'yxatning o'zi aytadi.
 *
 * Ma'lumot bitta joydan olinadi: `/v1/prepared-content/mine/` har bir tur
 * uchun BIR marta so'raladi (mavzu boshiga emas — o'ttiz mavzu × to'rt tur
 * = 120 so'rov bo'lardi). Javob `syllabusId::mavzuKodi` kaliti bo'yicha
 * indekslanadi, shuning uchun qatorni chizishda qidiruv O(1).
 *
 * Variant (`asosiy`, `qayta o'qish`) kalitga KIRMAYDI: bitta mavzuning
 * materiali variantlar orasida umumiy va `topicNormsOverlap` ham xuddi
 * shunday — faqat fan va mavzu kodi bo'yicha solishtiradi.
 */

/** Ro'yxatda chapdan o'ngga shu tartibda chiziladi. */
export const COVERAGE_KINDS: readonly PreparedContentKind[] = [
  'lecture',
  'presentation',
  'case',
  'test',
] as const;

export type TopicMaterialCoverage = Map<string, Set<PreparedContentKind>>;

/** Mavzu kaliti — `topicNormForStorage` dagi kod bilan bir xil qirqiladi. */
export function coverageKey(syllabusId: number | string, topicId: string): string {
  const code = (topicId || '').replace(/\s+/g, '').trim().toLowerCase().slice(0, 16);
  return `${syllabusId}::${code}`;
}

export function coveredKinds(
  coverage: TopicMaterialCoverage | null,
  syllabusId: number | string,
  topicId: string,
): Set<PreparedContentKind> | null {
  if (!coverage) return null;
  return coverage.get(coverageKey(syllabusId, topicId)) || null;
}

/**
 * To'rt turni parallel so'raydi. Bittasi yiqilsa — `listAllPreparedForKindSynced`
 * bo'sh ro'yxat qaytaradi, ya'ni sahifa baribir chiziladi, shunchaki o'sha
 * turning belgisi so'nik qoladi. Bu ko'rsatkich, ish qurollari emas.
 */
export async function fetchTopicMaterialCoverage(): Promise<TopicMaterialCoverage> {
  const lists = await Promise.all(COVERAGE_KINDS.map((k) => listAllPreparedForKindSynced(k)));
  const map: TopicMaterialCoverage = new Map();
  lists.forEach((rows, index) => {
    const kind = COVERAGE_KINDS[index];
    for (const row of rows) {
      const parts = parseTopicNormParts(row.topicNorm || '');
      if (!parts) continue;
      const key = `${parts.syllabusId}::${parts.topicCode}`;
      let set = map.get(key);
      if (!set) {
        set = new Set<PreparedContentKind>();
        map.set(key, set);
      }
      set.add(kind);
    }
  });
  return map;
}

/**
 * Fan bo'yicha nechta mavzuda material bor.
 *
 * Fanlar ro'yxatidagi ingichka chiziq shu sondan chiziladi: o'qituvchi
 * ro'yxatga bir qarab qaysi faniga hali qo'l urmaganini ko'radi.
 */
export function coveredTopicCount(
  coverage: TopicMaterialCoverage | null,
  syllabusId: number | string,
): number {
  if (!coverage) return 0;
  const prefix = `${syllabusId}::`;
  let n = 0;
  for (const key of coverage.keys()) if (key.startsWith(prefix)) n += 1;
  return n;
}
