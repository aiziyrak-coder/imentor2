import { useEffect, useState } from 'react';
import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import type { AppLanguage } from '../i18n/language';

/**
 * Fan va kafedra NOMLARI interfeys tilida (fan tanlash ro'yxati, sozlamalar).
 *
 * Butun sillabusni (yuzlab mavzu) o'girish o'rniga faqat nomlar bitta
 * so'rovda o'giriladi va bazaga yoziladi. Javob kelguncha nom o'rnida
 * "Tarjima qilinmoqda…" belgisi turadi — asl tildagi nom ko'rsatilmaydi.
 */

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

type LangCache = {
  syllabi: Map<string, string>;
  departments: Map<string, string>;
  /** So'ralgan (javobi kelgan yoki kutilayotgan) kalitlar. */
  askedSyllabi: Set<string>;
  askedDepartments: boolean;
  pending: number;
  failed: boolean;
};

const caches = new Map<AppLanguage, LangCache>();
const listeners = new Set<() => void>();

function cacheFor(lang: AppLanguage): LangCache {
  let c = caches.get(lang);
  if (!c) {
    c = {
      syllabi: new Map(),
      departments: new Map(),
      askedSyllabi: new Set(),
      askedDepartments: false,
      pending: 0,
      failed: false,
    };
    caches.set(lang, c);
  }
  return c;
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

async function fetchNames(lang: AppLanguage, syllabusIds: string[], departments: boolean): Promise<void> {
  const c = cacheFor(lang);
  c.pending += 1;
  c.failed = false;
  notify();
  try {
    const token = await getBackendAccessToken();
    if (!token) throw new Error('no-backend-token');
    const data = await httpJson<{ syllabi?: Record<string, string>; departments?: Record<string, string> }>(
      `${apiBaseUrl()}/v1/course-syllabuses/translate-names/`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { lang, syllabus_ids: syllabusIds.map(Number), departments },
        timeoutMs: 180_000,
      },
    );
    for (const [id, name] of Object.entries(data.syllabi || {})) c.syllabi.set(id, name);
    for (const [orig, name] of Object.entries(data.departments || {})) c.departments.set(orig, name);
  } catch {
    // Keyingi chaqiruvda qayta so'ralsin.
    syllabusIds.forEach((id) => c.askedSyllabi.delete(id));
    if (departments) c.askedDepartments = false;
    c.failed = true;
  } finally {
    c.pending -= 1;
    notify();
  }
}

/** Yetishmayotgan nomlarni so'raydi (allaqachon so'ralganlari qayta yuborilmaydi). */
export function requestNames(lang: AppLanguage, syllabusIds: Array<number | string>, departments: boolean): void {
  const c = cacheFor(lang);
  const ids = syllabusIds.map(String).filter((id) => id && !c.askedSyllabi.has(id));
  const wantDepartments = departments && !c.askedDepartments;
  if (!ids.length && !wantDepartments) return;
  ids.forEach((id) => c.askedSyllabi.add(id));
  if (wantDepartments) c.askedDepartments = true;
  void fetchNames(lang, ids, wantDepartments);
}

/** Qayta urinish — yiqilgan so'rovni yana yuboradi. */
export function retryNames(lang: AppLanguage, syllabusIds: Array<number | string>, departments: boolean): void {
  requestNames(lang, syllabusIds, departments);
}

/**
 * Nomlarni interfeys tilida qaytaruvchi hook.
 *
 * `subjectName` / `departmentName` — tarjima tayyor bo'lsa uni, kutilayotgan
 * bo'lsa `null` (chaqiruvchi "Tarjima qilinmoqda…" belgisini chizadi), tarjima
 * yiqilgan bo'lsa asl nomni qaytaradi.
 */
export function useLocalizedNames(
  lang: AppLanguage,
  syllabusIds: Array<number | string>,
  departments: boolean,
) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const idsKey = syllabusIds.map(String).sort().join(',');
  useEffect(() => {
    requestNames(lang, syllabusIds, departments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, idsKey, departments]);

  const c = cacheFor(lang);
  const waiting = c.pending > 0;
  return {
    pending: waiting,
    failed: c.failed && !waiting,
    subjectName(id: number | string, original: string): string | null {
      const hit = c.syllabi.get(String(id));
      if (hit) return hit;
      return waiting ? null : original;
    },
    departmentName(original: string): string | null {
      if (!original) return original;
      const hit = c.departments.get(original);
      if (hit) return hit;
      return waiting ? null : original;
    },
    retry: () => retryNames(lang, syllabusIds, departments),
  };
}
