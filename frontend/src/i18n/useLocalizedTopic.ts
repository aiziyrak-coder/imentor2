import { useEffect, useMemo, useState } from 'react';

import { useUiText } from './useUiText';
import {
  localizedSubjectName,
  localizedTopicTitle,
  requestSyllabusTranslation,
  subjectNameMissing,
  syllabusTranslationState,
  topicTitleMissing,
} from '../utils/syllabusI18n';
import { useSyllabusTranslationTick } from './useSyllabusTranslationState';
import {
  cacheSyllabusRows,
  getCachedSyllabusRow,
  subscribeSyllabusRows,
} from '../utils/syllabusRowCache';
import { fetchMyCourseSelections } from '../utils/syllabusApi';
import type { SyllabusTopicContext } from '../utils/syllabusTopicContext';
import type { StaffTopicInfo } from '../components/staff/StaffTopicHeader';

/**
 * Tanlangan mavzuni interfeys tilida ko'rsatish uchun.
 *
 * `SyllabusTopicContext` ichida ASL (o'zbekcha) sarlavha turadi — u
 * saqlash kaliti va AI prompti sifatida ishlatilgani uchun ataylab
 * tarjima qilinmaydi. Ekranda esa foydalanuvchi tanlagan tildagi matn
 * ko'rinishi kerak, shu hook o'shani beradi.
 *
 * Sillabus qatori keshda bo'lmasa (masalan, foydalanuvchi to'g'ridan-to'g'ri
 * "Ma'ruza matni" sahifasini ochgan bo'lsa) bir marta yuklab olinadi.
 */
export function useLocalizedTopic(topic: SyllabusTopicContext | null): StaffTopicInfo | null {
  const { language } = useUiText();
  const syllabusId = topic?.syllabusId ?? null;
  const [row, setRow] = useState(() => getCachedSyllabusRow(syllabusId));

  useEffect(() => {
    setRow(getCachedSyllabusRow(syllabusId));
    return subscribeSyllabusRows(() => setRow(getCachedSyllabusRow(syllabusId)));
  }, [syllabusId]);

  useEffect(() => {
    if (syllabusId == null || getCachedSyllabusRow(syllabusId)) return;
    let cancelled = false;
    void fetchMyCourseSelections()
      .then((selections) => {
        if (cancelled) return;
        cacheSyllabusRows(selections.map((s) => s.syllabus).filter(Boolean));
      })
      .catch(() => {
        /* tarjima bo'lmasa asl nom ko'rsatiladi — sahifa ishlayveradi */
      });
    return () => {
      cancelled = true;
    };
  }, [syllabusId]);

  // Direct navigation and leaving the subject page must not strand a missing translation.
  useEffect(() => {
    if (!row || !topic) return;
    if (topicTitleMissing(row, topic.title, language) || subjectNameMissing(row, language)) {
      void requestSyllabusTranslation(row.id, language);
    }
  }, [row, topic, language]);

  // Tarjima kelguncha sarlavha o'rnida "Tarjima qilinmoqda…" belgisi turadi.
  const tick = useSyllabusTranslationTick();
  const translating =
    Boolean(row && topic) &&
    syllabusTranslationState(row?.id, language) === 'pending' &&
    (topicTitleMissing(row, topic?.title || '', language) || subjectNameMissing(row, language));

  return useMemo(() => {
    if (!topic) return null;
    return {
      id: topic.id,
      type: topic.type,
      title: localizedTopicTitle(row, topic.title, language),
      subjectName: row ? localizedSubjectName(row, language) : topic.subjectName,
      variantLabel: topic.variantLabel,
      translating,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, row, language, translating, tick]);
}
