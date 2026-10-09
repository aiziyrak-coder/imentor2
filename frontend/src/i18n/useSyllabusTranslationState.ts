import { useEffect, useState } from 'react';
import { subscribeSyllabusTranslationState } from '../utils/syllabusI18n';

/**
 * Fan/mavzu nomlari tarjimasi holati o'zgarganda (boshlandi, tugadi, yiqildi)
 * komponentni qayta chizadi. Holatning o'zi `syllabusTranslationState()` dan o'qiladi.
 */
export function useSyllabusTranslationTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeSyllabusTranslationState(() => setTick((n) => n + 1)), []);
  return tick;
}
