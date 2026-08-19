import React, { useState, useEffect, useCallback } from 'react';
import { pushAppNotification } from '../utils/notifications';
import {
  BookOpen,
  Loader2,
  FlaskConical,
  Stethoscope,
  ArrowRight,
  Check,
  GraduationCap,
  ListChecks,
  ChevronLeft,
  ChevronRight,
  Microscope,
  NotebookPen,
} from 'lucide-react';
import type { SyllabusTopic } from '../services/aiService';
import { AppLanguageContext } from '../App';
import { useUiText } from '../i18n/useUiText';
import {
  hasTranslations,
  localizedSubjectName,
  localizedTopicTitle,
  requestSyllabusTranslation,
} from '../utils/syllabusI18n';
import type { UserRole } from '../utils/localStaffAuth';
import {
  fetchMyCourseSelections,
  isSyncUnavailable,
  type CourseSyllabusRow,
  type StaffCourseSelectionRow,
} from '../utils/syllabusApi';
import { resolveSyllabusVariants, totalTopicCount } from '../utils/syllabusVariant';
import { formatTopicLessonLabel, topicNumberFromId } from '../utils/topicLessonLabel';
import {
  buildTopicContext,
  topicsMatch,
  type SyllabusTopicContext,
} from '../utils/syllabusTopicContext';
import {
  instructionLanguageBadge,
  resolveSyllabusInstructionLanguage,
} from '../utils/syllabusInstructionLanguage';
import { cacheSyllabusRows } from '../utils/syllabusRowCache';
import { PAGE_ROOT } from '../layout/pageContainer';
import { staffCardLg, STAFF_HEADING } from './staff/staffUi';

interface SyllabusViewProps {
  userRole: UserRole | null;
  selectedTopic: SyllabusTopicContext | null;
  onSelectTopic: (topic: SyllabusTopicContext) => void;
  onClearTopic: () => void;
  onOpenLectures: (topic: SyllabusTopicContext) => void;
}

export default function SyllabusView({
  userRole,
  selectedTopic,
  onSelectTopic,
  onClearTopic,
  onOpenLectures,
}: SyllabusViewProps) {
  const { language } = React.useContext(AppLanguageContext);
  const { t } = useUiText();
  const steps = [t('syllabus.step1'), t('syllabus.stepTopic')];

  const [loading, setLoading] = useState(true);
  const [mySelections, setMySelections] = useState<StaffCourseSelectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeSyllabusId, setActiveSyllabusId] = useState<number | null>(null);

  // Bitta fan bir nechta qatorga biriktirilgan bo'lishi mumkin — chiplar uchun noyob.
  const mySubjects = (() => {
    const seen = new Set<number>();
    const out: StaffCourseSelectionRow[] = [];
    for (const s of mySelections) {
      if (!seen.has(s.syllabus.id)) {
        seen.add(s.syllabus.id);
        out.push(s);
      }
    }
    return out;
  })();

  // Interfeys tili almashganda, tarjimasi yetishmayotgan fanlar uchun
  // serverdan tarjima so'raymiz. Natija darhol kerak emas — server uni
  // bazaga yozadi va keyingi yuklashda tayyor bo'ladi (idempotent, shuning
  // uchun bir necha o'qituvchi bir vaqtda so'rasa ham xavfsiz).
  useEffect(() => {
    const pending = mySubjects
      .map((s) => s.syllabus)
      .filter((syl) => syl && !hasTranslations(syl, language));
    if (!pending.length) return;
    let cancelled = false;
    (async () => {
      // Tarjima fonda ketadi — "kuting, tarjima qilinmoqda" alerti
      // ko'rsatilmaydi (foydalanuvchi so'rovi), faqat tugagani bildiriladi.
      let any = false;
      for (const syl of pending) {
        if (cancelled) return;
        const ok = await requestSyllabusTranslation(syl.id, language);
        if (ok && !cancelled) {
          any = true;
          void load();
        }
      }
      if (any && !cancelled) {
        pushAppNotification({
          title: t('common.doneTitle'),
          body: t('syllabus.translated'),
          titleKey: 'common.doneTitle',
          bodyKey: 'syllabus.translated',
          level: 'success',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `load` ataylab bog'liqlikda emas — u har renderda yangilanadi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, mySelections]);

  const load = useCallback(async () => {
    if (userRole !== 'hodim') {
      setLoading(false);
      setMySelections([]);
      setError(t('syllabus.errorRole'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const mine = await fetchMyCourseSelections();
      setMySelections(mine);
      // Boshqa sahifalar (Ma'ruza, Taqdimot, Keys, Test) tanlangan mavzu
      // sarlavhasini interfeys tilida ko'rsatishi uchun shu qatorlar kerak.
      cacheSyllabusRows(mine.map((s) => s.syllabus).filter(Boolean));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'no-backend-token') {
        setError(t('syllabus.errorLogin'));
      } else if (isSyncUnavailable(err)) {
        setError(t('syllabus.errorRole'));
      } else {
        setError(t('syllabus.errorLoad'));
      }
    } finally {
      setLoading(false);
    }
  }, [userRole, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onTeachingSubjectsChanged = () => {
      void load();
    };
    window.addEventListener('imentor:teaching-subjects-changed', onTeachingSubjectsChanged);
    return () => {
      window.removeEventListener('imentor:teaching-subjects-changed', onTeachingSubjectsChanged);
    };
  }, [load]);

  useEffect(() => {
    if (selectedTopic?.syllabusId != null) {
      setActiveSyllabusId(selectedTopic.syllabusId);
      return;
    }
    if (mySelections.length === 0) {
      setActiveSyllabusId(null);
      return;
    }
    setActiveSyllabusId((prev) => {
      if (prev != null && mySelections.some((s) => s.syllabus.id === prev)) return prev;
      return mySelections[0].syllabus.id;
    });
  }, [mySelections, selectedTopic?.syllabusId]);

  const pickTopic = (
    topic: SyllabusTopic,
    syllabus: CourseSyllabusRow,
    variantLabel: string,
  ) => {
    const instructionLanguage = resolveSyllabusInstructionLanguage(syllabus);
    onSelectTopic(
      buildTopicContext(
        topic,
        syllabus.id,
        syllabus.subject_name,
        syllabus.subject_code,
        variantLabel,
        instructionLanguage,
        syllabus.department_name || '',
      ),
    );
  };

  // Faol fanning biriktirish qatorlari
  const activeRows = mySelections.filter((s) => s.syllabus.id === activeSyllabusId);
  const activeSyllabus = activeRows[0]?.syllabus ?? mySelections[0]?.syllabus ?? null;
  const allActiveVariants = activeSyllabus ? resolveSyllabusVariants(activeSyllabus) : [];
  const assignedLabels = new Set(
    activeRows.map((r) => (r.variant_label || '').trim()).filter(Boolean),
  );
  const adminAssignedAllDirections =
    activeRows.length > 0 && activeRows.some((r) => !(r.variant_label || '').trim());
  const allowedVariants =
    adminAssignedAllDirections || assignedLabels.size === 0
      ? allActiveVariants
      : allActiveVariants.filter((v) => assignedLabels.has(v.label));
  const activeVariants = allowedVariants.length > 0 ? allowedVariants : allActiveVariants;
  // Yo'nalish UI yo'q — birinchi (yoki yagona) PDF/variant mavzulari.
  const activeVariant = activeVariants[0] ?? null;
  const activeLabel = activeVariant?.label ?? '';
  const activeTopics = activeVariant?.topics ?? [];
  const activeLectures = activeTopics.filter((topic) => topic.type === 'lecture');
  const activePracticals = activeTopics.filter((topic) => topic.type === 'practical');
  const activeClinicals = activeTopics.filter((topic) => topic.type === 'clinical');
  const activeIndependents = activeTopics.filter((topic) => topic.type === 'independent');
  const activeLabs = activeTopics.filter((topic) => topic.type === 'lab');
  const topicColumnCount = [
    activeLectures,
    activePracticals,
    activeClinicals,
    activeIndependents,
    activeLabs,
  ].filter((g) => g.length > 0).length;

  const step1Done = mySelections.length > 0 && activeSyllabus != null;
  const step2Done = selectedTopic != null;

  /**
   * Hodim birinchi marta kirganda hech qanday mavzu tanlanmagan bo'ladi —
   * "Test yaratish"/"Taqdimotlar" kabi sahifalar bo'sh/chalkash ko'rinadi.
   * Fan ro'yxati keldi-yu, mavzu hali tanlanmagan bo'lsa — birinchi mavzuni
   * avtomatik tanlab qo'yamiz (foydalanuvchi istasa keyin o'zi almashtiradi).
   */
  useEffect(() => {
    if (loading || selectedTopic || !activeSyllabus || activeTopics.length === 0) return;
    pickTopic(activeTopics[0], activeSyllabus, activeLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- faqat birinchi bo'sh holatda ishga tushsin
  }, [loading, selectedTopic, activeSyllabus, activeTopics, activeLabel]);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 size={40} className="animate-spin text-blue-500" />
        <p className="text-sm font-medium">{t('syllabus.loading')}</p>
      </div>
    );
  }

  return (
    <div className={`${PAGE_ROOT} py-2 sm:py-3 pb-6`}>
      <div className={`${staffCardLg} overflow-hidden`}>
        <div className="px-3 sm:px-4 py-3 border-b border-white/60 bg-white/30">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="min-w-0">
              <h2 className={`text-base sm:text-lg font-bold tracking-tight flex items-center gap-2 ${STAFF_HEADING}`}>
                <GraduationCap className="text-[#083047] shrink-0" size={20} />
                {t('syllabus.title')}
              </h2>
              <p className="text-black/50 mt-0.5 text-[11px] sm:text-xs leading-snug">{t('syllabus.subtitle')}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 shrink-0">
              {steps.map((label, i) => {
                const done = i === 0 ? step1Done : step2Done;
                const active =
                  (i === 0 && !step1Done) || (i === 1 && step1Done && !step2Done);
                return (
                  <span
                    key={label}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] sm:text-[11px] font-semibold ${
                      done
                        ? 'bg-[#083047]/10 text-[#083047] border border-[#083047]/20'
                        : active
                          ? 'bg-white/80 text-[#083047] border border-black/10'
                          : 'bg-white/50 text-black/55 border border-black/8'
                    }`}
                  >
                    {done ? <Check size={12} /> : <ListChecks size={12} />}
                    {label}
                    {i < steps.length - 1 && <ChevronRight size={10} className="opacity-40 hidden sm:inline" />}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-3 sm:mx-4 mt-2 bg-rose-50 text-rose-700 px-3 py-2 rounded-lg text-xs font-medium border border-rose-100">
            {error}
          </div>
        )}

        <div className="border-b border-slate-100">
        {/* 1-bosqich: Fan tanlash */}
        <SyllabusStepSection
          step={1}
          title={t('syllabus.step1')}
          done={step1Done}
          active={!step1Done}
        >
          {mySelections.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {mySubjects.map((sel) => {
                const syllabus = sel.syllabus;
                const isActive = activeSyllabusId === syllabus.id;
                const variants = resolveSyllabusVariants(syllabus);
                const topics = totalTopicCount(variants);
                return (
                  <button
                    key={sel.id}
                    type="button"
                    onClick={() => {
                      setActiveSyllabusId(syllabus.id);
                      if (selectedTopic?.syllabusId !== syllabus.id) onClearTopic();
                    }}
                    className={`inline-flex items-center gap-1.5 pl-2.5 pr-2.5 py-1.5 rounded-lg border text-[12px] transition ${
                      isActive
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-slate-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <span className="font-semibold text-slate-900 truncate max-w-[160px] sm:max-w-[220px]">
                      {localizedSubjectName(syllabus, language)}
                    </span>
                    <span className="text-[9px] text-slate-500 shrink-0">
                      {instructionLanguageBadge(resolveSyllabusInstructionLanguage(syllabus))}
                    </span>
                    <span className="text-[9px] text-slate-400 shrink-0">
                      {topics} {t('syllabus.topics')}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-3 space-y-1">
              <p className="text-[12px] font-semibold text-amber-900">{t('syllabus.noAssignedCourses')}</p>
              <p className="text-[11px] text-amber-800 leading-relaxed">{t('syllabus.noAssignedCoursesHint')}</p>
            </div>
          )}
        </SyllabusStepSection>
        </div>

        {/* 2-bosqich: Mavzu tanlash */}
        <SyllabusStepSection
          step={2}
          title={t('syllabus.stepTopic')}
          done={step2Done}
          active={step1Done && !step2Done}
          muted={!step1Done}
        >
          {!step1Done ? (
            <p className="text-sm text-slate-400 italic">{t('syllabus.stepTopicLocked')}</p>
          ) : activeSyllabus ? (
            <div className="space-y-3">
              {selectedTopic && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">
                        {t('syllabus.selectedTopic')}
                      </p>
                      <p className="text-[12px] font-semibold text-gray-900 mt-0.5 leading-snug">
                        <span className="text-blue-700">
                          {formatTopicLessonLabel(selectedTopic.type, selectedTopic.id, t)}
                        </span>
                        {' — '}
                        {localizedTopicTitle(activeSyllabus, selectedTopic.title, language)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenLectures(selectedTopic)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-semibold shrink-0"
                    >
                      {t('syllabus.next')}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}

              <div
                className={
                  topicColumnCount >= 3
                    ? 'grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3'
                    : topicColumnCount === 2
                      ? 'grid grid-cols-1 xl:grid-cols-2 gap-3'
                      : 'space-y-3'
                }
              >
                {activeLectures.length > 0 && (
                  <TopicColumn
                    title={t('syllabus.lectures')}
                    icon={<BookOpen size={18} />}
                    iconBg="bg-blue-50 text-blue-600"
                    topics={activeLectures}
                    selectedTopic={selectedTopic}
                    syllabus={activeSyllabus}
                    variantLabel={activeLabel}
                    onPickTopic={pickTopic}
                    accent="blue"
                  />
                )}
                {activePracticals.length > 0 && (
                  <TopicColumn
                    title={t('syllabus.practicals')}
                    icon={<FlaskConical size={18} />}
                    iconBg="bg-indigo-50 text-indigo-600"
                    topics={activePracticals}
                    selectedTopic={selectedTopic}
                    syllabus={activeSyllabus}
                    variantLabel={activeLabel}
                    onPickTopic={pickTopic}
                    accent="indigo"
                  />
                )}
                {activeClinicals.length > 0 && (
                  <TopicColumn
                    title={t('syllabus.clinicals')}
                    icon={<Stethoscope size={18} />}
                    iconBg="bg-teal-50 text-teal-600"
                    topics={activeClinicals}
                    selectedTopic={selectedTopic}
                    syllabus={activeSyllabus}
                    variantLabel={activeLabel}
                    onPickTopic={pickTopic}
                    accent="teal"
                  />
                )}
                {activeIndependents.length > 0 && (
                  <TopicColumn
                    title={t('syllabus.independents')}
                    icon={<NotebookPen size={18} />}
                    iconBg="bg-amber-50 text-amber-700"
                    topics={activeIndependents}
                    selectedTopic={selectedTopic}
                    syllabus={activeSyllabus}
                    variantLabel={activeLabel}
                    onPickTopic={pickTopic}
                    accent="amber"
                  />
                )}
                {activeLabs.length > 0 && (
                  <TopicColumn
                    title={t('syllabus.labs')}
                    icon={<Microscope size={18} />}
                    iconBg="bg-slate-100 text-slate-700"
                    topics={activeLabs}
                    selectedTopic={selectedTopic}
                    syllabus={activeSyllabus}
                    variantLabel={activeLabel}
                    onPickTopic={pickTopic}
                    accent="slate"
                  />
                )}
              </div>
            </div>
          ) : null}
        </SyllabusStepSection>
      </div>
    </div>
  );
}

function SyllabusStepSection({
  step,
  title,
  done,
  active,
  muted,
  className,
  children,
}: {
  step: number;
  title: string;
  done: boolean;
  active: boolean;
  muted?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`px-3 sm:px-4 py-3 ${muted ? 'opacity-70' : ''} ${className ?? ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
            done
              ? 'bg-emerald-500 text-white'
              : active
                ? 'bg-blue-600 text-white ring-2 ring-blue-200'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {done ? <Check size={14} /> : step}
        </span>
        <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
      </div>
      {children}
    </section>
  );
}

type TopicAccent = 'blue' | 'indigo' | 'teal' | 'amber' | 'slate';

const ACCENT_STYLES: Record<
  TopicAccent,
  { selected: string; hover: string; badgeOn: string; badgeOff: string; check: string }
> = {
  blue: {
    selected: 'border-2 ring-blue-200 border-blue-500 bg-blue-50/80',
    hover: 'hover:border-blue-300 hover:bg-blue-50/50',
    badgeOn: 'bg-blue-600 text-white',
    badgeOff: 'bg-blue-50 text-blue-700',
    check: 'text-blue-600',
  },
  indigo: {
    selected: 'border-2 ring-indigo-200 border-indigo-500 bg-indigo-50/80',
    hover: 'hover:border-indigo-300 hover:bg-indigo-50/50',
    badgeOn: 'bg-indigo-600 text-white',
    badgeOff: 'bg-indigo-50 text-indigo-700',
    check: 'text-indigo-600',
  },
  teal: {
    selected: 'border-2 ring-teal-200 border-teal-500 bg-teal-50/80',
    hover: 'hover:border-teal-300 hover:bg-teal-50/50',
    badgeOn: 'bg-teal-600 text-white',
    badgeOff: 'bg-teal-50 text-teal-700',
    check: 'text-teal-600',
  },
  amber: {
    selected: 'border-2 ring-amber-200 border-amber-500 bg-amber-50/80',
    hover: 'hover:border-amber-300 hover:bg-amber-50/50',
    badgeOn: 'bg-amber-600 text-white',
    badgeOff: 'bg-amber-50 text-amber-800',
    check: 'text-amber-700',
  },
  slate: {
    selected: 'border-2 ring-slate-200 border-slate-500 bg-slate-50',
    hover: 'hover:border-slate-300 hover:bg-slate-50',
    badgeOn: 'bg-slate-700 text-white',
    badgeOff: 'bg-slate-100 text-slate-700',
    check: 'text-slate-700',
  },
};

const TOPICS_PER_PAGE = 10;

function TopicColumn({
  title,
  icon,
  iconBg,
  topics,
  selectedTopic,
  syllabus,
  variantLabel,
  onPickTopic,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  iconBg: string;
  topics: SyllabusTopic[];
  selectedTopic: SyllabusTopicContext | null;
  syllabus: CourseSyllabusRow;
  variantLabel: string;
  onPickTopic: (topic: SyllabusTopic, syllabus: CourseSyllabusRow, variantLabel: string) => void;
  accent: TopicAccent;
}) {
  const { t } = useUiText();
  const [page, setPage] = useState(0);
  const listKey = `${syllabus.id}::${variantLabel}::${accent}`;
  const totalPages = Math.max(1, Math.ceil(topics.length / TOPICS_PER_PAGE));

  useEffect(() => {
    setPage(0);
  }, [listKey]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  useEffect(() => {
    if (!selectedTopic) return;
    const instructionLanguage = resolveSyllabusInstructionLanguage(syllabus);
    const idx = topics.findIndex((topic) =>
      topicsMatch(
        selectedTopic,
        buildTopicContext(topic, syllabus.id, syllabus.subject_name, syllabus.subject_code, variantLabel, instructionLanguage, syllabus.department_name || ''),
      ),
    );
    if (idx >= 0) setPage(Math.floor(idx / TOPICS_PER_PAGE));
    // Faqat tanlangan mavzu yoki ro'yxat o'zgarganda — sahifa almashtirishda qayta ishlamasin
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topics listKey bilan birga yangilanadi
  }, [selectedTopic, listKey]);

  const pageStart = page * TOPICS_PER_PAGE;
  const visibleTopics = topics.slice(pageStart, pageStart + TOPICS_PER_PAGE);
  const showPagination = topics.length > TOPICS_PER_PAGE;

  const { language } = React.useContext(AppLanguageContext);
  const tone = ACCENT_STYLES[accent];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1 rounded-md shrink-0 ${iconBg}`}>{icon}</div>
          <h4 className="text-[13px] font-bold text-gray-800 truncate">{title}</h4>
        </div>
        {topics.length > 0 && (
          <span className="text-[10px] font-semibold text-gray-400 shrink-0">
            {topics.length} {t('syllabus.topics')}
          </span>
        )}
      </div>
      {topics.length > 0 ? (
        <div className="space-y-2">
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleTopics.map((topic) => {
            const ctx = buildTopicContext(
              topic,
              syllabus.id,
              syllabus.subject_name,
              syllabus.subject_code,
              variantLabel,
              resolveSyllabusInstructionLanguage(syllabus),
              syllabus.department_name || '',
            );
            const isSelected = topicsMatch(selectedTopic, ctx);
            return (
              <button
                key={`${syllabus.id}-${variantLabel}-${topic.id}-${topic.title}`}
                type="button"
                onClick={() => onPickTopic(topic, syllabus, variantLabel)}
                className={`flex items-start gap-2 p-2 sm:p-2.5 text-left rounded-xl border shadow-sm transition-all ${
                  isSelected ? tone.selected : `bg-white border-gray-100 ${tone.hover}`
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[11px] shrink-0 ${
                    isSelected ? tone.badgeOn : tone.badgeOff
                  }`}
                >
                  {topicNumberFromId(topic.id) || topic.id}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-gray-500 leading-tight">
                    {formatTopicLessonLabel(topic.type, topic.id, t)}
                  </p>
                  <p className="font-medium text-gray-800 text-[12px] leading-snug break-words line-clamp-2">
                    {localizedTopicTitle(syllabus, topic.title, language)}
                  </p>
                </div>
                {isSelected ? (
                  <Check size={20} className={tone.check} />
                ) : (
                  <ArrowRight size={18} className="text-gray-300 shrink-0 mt-1" />
                )}
              </button>
            );
          })}
        </div>
        {showPagination && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
              {t('common.prev')}
            </button>
            <span className="text-[12px] font-medium text-gray-500 tabular-nums">
              {t('syllabus.topicRange', {
                from: pageStart + 1,
                to: Math.min(pageStart + TOPICS_PER_PAGE, topics.length),
                total: topics.length,
              })}
            </span>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('common.next')}
              <ChevronRight size={16} />
            </button>
          </div>
        )}
        </div>
      ) : (
        <p className="text-gray-400 text-sm italic">{t('syllabus.noTopicsInTrack')}</p>
      )}
    </div>
  );
}
