import type { AppLanguage } from '../i18n/language';
import type { CourseSyllabusRow } from './syllabusApi';

/**
 * O'qituvchining sillabus qatorlari uchun jarayon ichidagi kesh.
 *
 * Nima uchun kerak: mavzu sarlavhasini interfeys tiliga o'girish uchun
 * sillabus qatori kerak (`topics_i18n` + `instruction_language`). Tanlangan
 * mavzu konteksti (`SyllabusTopicContext`) esa faqat ASL matnni saqlaydi —
 * u saqlash kaliti va AI promptlari uchun ishlatilgani sababli ataylab
 * tarjima qilinmaydi.
 *
 * Shu sababli "Mening fanlarim" sahifasi yuklagan qatorlar shu yerda
 * saqlanadi va "Ma'ruza matni", "Taqdimotlar", "Keys"/"Test" sahifalari
 * ularni qayta so'ramasdan ishlatadi.
 */

let rows = new Map<number, CourseSyllabusRow>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function cacheSyllabusRows(list: CourseSyllabusRow[]): void {
  let changed = false;
  for (const row of list) {
    if (row?.id == null) continue;
    if (rows.get(row.id) !== row) {
      rows.set(row.id, row);
      changed = true;
    }
  }
  if (changed) emit();
}

export function getCachedSyllabusRow(id: number | null | undefined): CourseSyllabusRow | null {
  if (id == null) return null;
  return rows.get(id) ?? null;
}

/**
 * Sillabus ID'si noma'lum bo'lganda mavzu sarlavhasini tarjima qiladi.
 *
 * "Baza" ro'yxatida faqat asl sarlavha saqlanadi (u qidiruv kaliti), qaysi
 * sillabusdan ekani esa yozilmaydi — shuning uchun keshdagi barcha qatorlar
 * bo'ylab shu sarlavha tarjimasi qidiriladi.
 */
export function localizedTitleFromCache(title: string, lang: AppLanguage): string {
  const original = (title || '').trim();
  if (!original) return title;
  for (const row of rows.values()) {
    const hit = row.topics_i18n?.[lang]?.[original];
    if (hit && hit.trim()) return hit.trim();
  }
  return title;
}

export function subscribeSyllabusRows(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Chiqishda keshni tozalash — boshqa hisob eski nomlarni ko'rmasin. */
export function clearSyllabusRowCache(): void {
  if (rows.size === 0) return;
  rows = new Map();
  emit();
}
