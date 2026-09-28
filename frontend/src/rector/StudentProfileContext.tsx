import { createContext, useContext } from 'react';

/** Talaba ismi bosilganda uning to'liq hisobotini ochish. `key` — ro'yxatdagi `student_id`. */
export type OpenStudent = (student: { key: string; name: string }) => void;

export const StudentProfileContext = createContext<OpenStudent | null>(null);

export function useOpenStudent(): OpenStudent | null {
  return useContext(StudentProfileContext);
}
