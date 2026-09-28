import { createContext, useContext } from 'react';
import type { MonitorSlot } from './rectorApi';

/**
 * Hisobotning istalgan joyida o'qituvchi ustiga bosilganda uning to'liq
 * hisobotini ochish. `key` — iMentor login; jadvalda bor-u hisobi topilmagan
 * o'qituvchida bo'sh bo'ladi (unda faqat monitor jadvali ko'rsatiladi).
 */
export type OpenTeacher = (teacher: { key: string; name: string; slots?: MonitorSlot[] }) => void;

export const TeacherProfileContext = createContext<OpenTeacher | null>(null);

/** Provider yo'q joyda (masalan testda) `null` — ism oddiy matn bo'lib qoladi. */
export function useOpenTeacher(): OpenTeacher | null {
  return useContext(TeacherProfileContext);
}
