import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { pushAppNotification } from '../utils/notifications';
import {
  Loader2,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  ListPlus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import StaffTeachingSubjectsPicker from './staff/StaffTeachingSubjectsPicker';
import OwnSubjectUpload from './staff/OwnSubjectUpload';
import type { SyllabusTopic } from '../services/aiService';
import { AppLanguageContext } from '../App';
import { useUiText } from '../i18n/useUiText';
import {
  hasTranslations,
  localizedSubjectName,
  localizedTopicTitle,
  requestSyllabusTranslation,
  retrySyllabusTranslation,
  subjectNameMissing,
  syllabusTranslationState,
  topicTitleMissing,
} from '../utils/syllabusI18n';
import { useSyllabusTranslationTick } from '../i18n/useSyllabusTranslationState';
import type { UserRole } from '../utils/localStaffAuth';
import {
  deleteOwnSyllabus,
  fetchMyCourseSelections,
  isSyncUnavailable,
  setMyTeachingSubjects,
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
import type { PreparedContentKind } from '../utils/preparedContentStore';
import {
  COVERAGE_KINDS,
  coveredKinds,
  coveredTopicCount,
  fetchTopicMaterialCoverage,
  type TopicMaterialCoverage,
} from '../utils/topicMaterialCoverage';
import { PAGE_ROOT } from '../layout/pageContainer';
import { PREPARED_CONTENT_CHANGED_EVENT } from '../utils/preparedContentStore';

interface SyllabusViewProps {
  userRole: UserRole | null;
  selectedTopic: SyllabusTopicContext | null;
  onSelectTopic: (topic: SyllabusTopicContext, opts?: { silent?: boolean }) => void;
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
  /** Qaysi mavzuga nima tayyorlangan. Yuklanmaguncha `null` — belgilar
   *  chizilmaydi, ro'yxat esa darhol ko'rinadi. */
  const [coverage, setCoverage] = useState<TopicMaterialCoverage | null>(null);
  /** Fan qo'shish oynasi: katalogdan tanlash yoki Excel'dan o'zi yuklash. */
  const [dialog, setDialog] = useState<'catalog' | 'upload' | 'edit' | null>(null);
  const [subjectBusy, setSubjectBusy] = useState(false);

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
  // serverdan tarjima so'raymiz (idempotent — bir necha o'qituvchi bir
  // vaqtda so'rasa ham xavfsiz). Tarjima kelguncha tarjimasiz nomlar o'rnida
  // "Tarjima qilinmoqda…" belgisi turadi — asl tildagi nom ko'rsatilmaydi.
  useSyllabusTranslationTick();
  useEffect(() => {
    const pending = mySubjects
      .map((s) => s.syllabus)
      .filter((syl) => syl && (!hasTranslations(syl, language) || subjectNameMissing(syl, language)));
    if (!pending.length) return;
    let cancelled = false;
    (async () => {
      // Fanlar parallel o'giriladi — ketma-ket bo'lsa oxirgi fan bir necha
      // daqiqa "Tarjima qilinmoqda…" holatida turardi.
      const results = await Promise.all(pending.map((syl) => requestSyllabusTranslation(syl.id, language)));
      const any = results.some(Boolean);
      if (any && !cancelled) void load();
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

  /* Materiallar ko'rsatkichi ro'yxatdan KEYIN keladi: to'rt so'rov
      qaytguncha mavzular allaqachon ekranda bo'ladi. Xato bo'lsa belgilar
      shunchaki chiqmaydi — sahifa ishlashda davom etadi. */
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void fetchTopicMaterialCoverage().then((map) => {
        if (alive) setCoverage(map);
      });
    };
    refresh();
    // Sahifa fonda ochiq turadi — boshqa bo'limda ma'ruza/test saqlanganda
    // yoki o'chirilganda nuqtalar shu hodisa orqali yangilanadi.
    window.addEventListener(PREPARED_CONTENT_CHANGED_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(PREPARED_CONTENT_CHANGED_EVENT, refresh);
    };
  }, [mySelections.length]);

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
    // Tanlangan mavzu ro'yxatda yo'q fanga tegishli (o'chirilgan / olib
    // tashlangan) — uni tozalaymiz, aks holda boshqa fanning mavzulari chiqardi.
    if (
      !loading &&
      !error &&
      selectedTopic?.syllabusId != null &&
      !mySelections.some((s) => s.syllabus.id === selectedTopic.syllabusId)
    ) {
      onClearTopic();
      return;
    }
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
  }, [mySelections, selectedTopic?.syllabusId, loading, error, onClearTopic]);

  const pickTopic = (
    topic: SyllabusTopic,
    syllabus: CourseSyllabusRow,
    variantLabel: string,
    silent = false,
  ) => {
    const instructionLanguage = resolveSyllabusInstructionLanguage(syllabus);
    const context = buildTopicContext(
      topic,
      syllabus.id,
      syllabus.subject_name,
      syllabus.subject_code,
      variantLabel,
      instructionLanguage,
      syllabus.department_name || '',
    );
    onSelectTopic(context, { silent });
    return context;
  };

  /**
   * O'qituvchi mavzuni O'ZI bosganda — darhol "Ma'ruza matni" sahifasiga o'tadi
   * (keyingi qadam doim shu edi va "Keyingi" tugmasini qidirib o'tirardi).
   * Sahifa ochilganda birinchi mavzuning avtomatik tanlanishi o'tkazmaydi.
   */
  const pickTopicAndOpen = (
    topic: SyllabusTopic,
    syllabus: CourseSyllabusRow,
    variantLabel: string,
  ) => {
    const context = pickTopic(topic, syllabus, variantLabel);
    if (userRole === 'hodim' || userRole === 'admin') onOpenLectures(context);
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
    // Avtomatik tanlov — "Mavzu tanlandi" bildirishnomasi chiqarilmaydi,
    // aks holda har fan almashganda tarix keraksiz yozuv bilan to'lardi.
    pickTopic(activeTopics[0], activeSyllabus, activeLabel, true);
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


  const activeSelection = mySubjects.find((s) => s.syllabus.id === activeSyllabusId) ?? null;

  const removeActiveSubject = async () => {
    if (!activeSelection) return;
    const name = localizedSubjectName(activeSelection.syllabus, language);
    const own = Boolean(activeSelection.is_own);
    const ok = window.confirm(
      own ? t('ownSubjects.deleteOwnConfirm', { name }) : t('ownSubjects.removeConfirm', { name }),
    );
    if (!ok) return;
    setSubjectBusy(true);
    try {
      if (own) {
        await deleteOwnSyllabus(activeSelection.syllabus.id);
      } else {
        const keep = mySubjects
          .map((s) => s.syllabus.id)
          .filter((id) => id !== activeSelection.syllabus.id);
        await setMyTeachingSubjects(keep);
      }
      if (selectedTopic?.syllabusId === activeSelection.syllabus.id) onClearTopic();
      setActiveSyllabusId(null);
      await load();
    } catch {
      setError(t('ownSubjects.actionFailed'));
    } finally {
      setSubjectBusy(false);
    }
  };

  const subjectActions = (
    <div className="mt-4 grid gap-2">
      <button
        type="button"
        onClick={() => setDialog('catalog')}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
      >
        <ListPlus size={15} />
        {t('ownSubjects.pickFromCatalog')}
      </button>
      <button
        type="button"
        onClick={() => setDialog('upload')}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
      >
        <FileSpreadsheet size={15} />
        {t('ownSubjects.uploadExcel')}
      </button>
      {activeSelection?.is_own && (
        <button
          type="button"
          onClick={() => setDialog('edit')}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-white"
        >
          <Pencil size={14} />
          {t('ownSubjects.edit')}
        </button>
      )}
      {activeSelection && (
        <button
          type="button"
          onClick={() => void removeActiveSubject()}
          disabled={subjectBusy}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          {subjectBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          {activeSelection.is_own ? t('ownSubjects.deleteOwn') : t('ownSubjects.removeFromList')}
        </button>
      )}
    </div>
  );

  const subjectDialog = dialog && (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) setDialog(null);
      }}
    >
      <div className="max-h-[min(90dvh,760px)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-black/5 bg-white p-5 shadow-2xl sm:p-7">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">
            {dialog === 'catalog'
              ? t('ownSubjects.pickFromCatalog')
              : dialog === 'edit'
                ? t('ownSubjects.edit')
                : t('ownSubjects.uploadExcel')}
          </h2>
          <button
            type="button"
            onClick={() => setDialog(null)}
            aria-label={t('ownSubjects.close')}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>
        {dialog === 'catalog' ? (
          <StaffTeachingSubjectsPicker
            variant="profile"
            showHeader={false}
            onSaved={() => {
              setDialog(null);
              void load();
            }}
          />
        ) : dialog === 'edit' && activeSelection ? (
          <OwnSubjectUpload
            editing={activeSelection.syllabus}
            onUpdated={(stats) => {
              setDialog(null);
              pushAppNotification({
                title: t('common.doneTitle'),
                body: t('ownSubjects.updated', {
                  added: String(stats.added ?? 0),
                  removed: String(stats.removed ?? 0),
                  kept: String(stats.kept_with_material ?? 0),
                }),
                titleKey: 'common.doneTitle',
                bodyKey: 'ownSubjects.updated',
                bodyParams: {
                  added: String(stats.added ?? 0),
                  removed: String(stats.removed ?? 0),
                  kept: String(stats.kept_with_material ?? 0),
                },
                level: 'success',
              });
              void load();
            }}
          />
        ) : (
          <OwnSubjectUpload
            onCreated={(syllabusId) => {
              setDialog(null);
              pushAppNotification({
                title: t('common.doneTitle'),
                body: t('ownSubjects.created'),
                titleKey: 'common.doneTitle',
                bodyKey: 'ownSubjects.created',
                level: 'success',
              });
              void load().then(() => setActiveSyllabusId(syllabusId));
            }}
          />
        )}
      </div>
    </div>
  );

  const topicGroups = [
    { key: 'lectures', title: t('syllabus.lectures'), topics: activeLectures },
    { key: 'practicals', title: t('syllabus.practicals'), topics: activePracticals },
    { key: 'clinicals', title: t('syllabus.clinicals'), topics: activeClinicals },
    { key: 'independents', title: t('syllabus.independents'), topics: activeIndependents },
    { key: 'labs', title: t('syllabus.labs'), topics: activeLabs },
  ].filter((g) => g.topics.length > 0);

  return (
    <div className={`${PAGE_ROOT} py-6 pb-10`}>
      {/*
       * Tinch joylashuv.
       *
       * Ilgari har element o'z qutisida edi: kartochka ichida kartochka,
       * chegara ustida chegara, rangli nishon va qalin soya. Yigirmata
       * mavzu shunday chizilganda sahifa og'irlashib ketardi va ko'z
       * qayerga qarashni bilmasdi.
       *
       * Endi quti yo'q. Bo'limlarni ingichka chiziq va bo'sh joy ajratadi,
       * holat esa rang bilan emas, og'irlik bilan ko'rsatiladi: tanlangan
       * narsa to'q, qolgani och. Shu tufayli mazmun oldinga chiqadi.
       */}
      <div className="grid items-start gap-x-12 gap-y-8 lg:grid-cols-[230px_1fr]">
        {/* ─────────── Fanlar ─────────── */}
        <aside className="lg:sticky lg:top-4">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {t('syllabus.step1')}
          </p>

          {mySelections.length > 0 ? (
            <nav className="-ml-3 space-y-0.5">
              {mySubjects.map((sel) => {
                const syllabus = sel.syllabus;
                const isActive = activeSyllabusId === syllabus.id;
                const variants = resolveSyllabusVariants(syllabus);
                const topics = totalTopicCount(variants);
                const doneTopics = coveredTopicCount(coverage, syllabus.id);
                return (
                  <button
                    key={sel.id}
                    type="button"
                    onClick={() => {
                      setActiveSyllabusId(syllabus.id);
                      if (selectedTopic?.syllabusId !== syllabus.id) onClearTopic();
                    }}
                    className={`relative block w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ${
                      isActive ? 'bg-white' : 'hover:bg-white/70'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="subject-active"
                        transition={{ type: 'spring', stiffness: 620, damping: 42 }}
                        className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-slate-900"
                      />
                    )}
                    <span
                      className={`block text-[13px] leading-snug ${
                        isActive ? 'font-semibold text-slate-900' : 'font-medium text-slate-500'
                      }`}
                    >
                      {subjectNameMissing(syllabus, language) &&
                      syllabusTranslationState(syllabus.id, language) === 'pending' ? (
                        <TranslatingText width="w-32" />
                      ) : (
                        localizedSubjectName(syllabus, language)
                      )}
                      {sel.is_own && (
                        <span className="ml-1.5 whitespace-nowrap rounded bg-emerald-50 px-1 py-px align-middle text-[9.5px] font-semibold text-emerald-700">
                          {t('ownSubjects.ownBadge')}
                        </span>
                      )}
                    </span>
                    {/* Nechta mavzuda material bor — fanni tanlamasdan turib
                        ko'rinadi. Ma'lumot kelmaguncha chiziq bo'sh turadi. */}
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="h-[3px] w-16 overflow-hidden rounded-full bg-slate-900/[0.07]">
                        <span
                          className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                          style={{
                            width: topics
                              ? `${Math.min(100, Math.round((doneTopics / topics) * 100))}%`
                              : '0%',
                          }}
                        />
                      </span>
                      <span className="text-[10.5px] tabular-nums text-slate-400">
                        {doneTopics}/{topics}
                      </span>
                      <span className="text-[10.5px] text-slate-300">
                        {instructionLanguageBadge(resolveSyllabusInstructionLanguage(syllabus))}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="space-y-1">
              <p className="text-[13px] font-semibold text-slate-800">{t('ownSubjects.emptyTitle')}</p>
              <p className="text-[12.5px] leading-relaxed text-slate-500">{t('ownSubjects.emptyHint')}</p>
            </div>
          )}
          {subjectActions}
        </aside>

        {/* ─────────── Mavzular ─────────── */}
        <section className="min-w-0">
          {error && (
            <p className="mb-6 text-[13px] font-medium text-rose-600">{error}</p>
          )}

          {!step1Done ? (
            mySelections.length === 0 ? (
              <div className="mx-auto grid max-w-2xl gap-3 py-10 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDialog('catalog')}
                  className="rounded-2xl bg-white p-5 text-left ring-1 ring-slate-900/[0.06] transition hover:ring-slate-900/20"
                >
                  <ListPlus size={22} className="text-slate-700" />
                  <p className="mt-3 text-[14px] font-semibold text-slate-900">{t('ownSubjects.pickFromCatalog')}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{t('ownSubjects.catalogHint')}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setDialog('upload')}
                  className="rounded-2xl bg-white p-5 text-left ring-1 ring-slate-900/[0.06] transition hover:ring-slate-900/20"
                >
                  <FileSpreadsheet size={22} className="text-emerald-600" />
                  <p className="mt-3 text-[14px] font-semibold text-slate-900">{t('ownSubjects.uploadExcel')}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{t('ownSubjects.uploadHint')}</p>
                </button>
              </div>
            ) : (
              <p className="py-20 text-center text-[13.5px] text-slate-400">
                {t('syllabus.stepTopicLocked')}
              </p>
            )
          ) : (
            <>
              {/* Tanlangan mavzu — baland lenta emas, tinch qator.
                  Amal matn tugmasi: e'tibor mavzuda qoladi, tugmada emas. */}
              {selectedTopic && (
                <div className="sticky top-0 z-20 -mx-2 mb-8 bg-[#f4f6fa]/95 px-2 py-3 backdrop-blur-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-slate-900/10 pb-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {formatTopicLessonLabel(selectedTopic.type, selectedTopic.id, t)}
                      </p>
                      {/* Ekran keng bo'lsa ham sarlavha 60ch dan oshmaydi:
                          bir metrlik satrni o'qib bo'lmaydi. */}
                      <h2 className="mt-1 line-clamp-2 max-w-[60ch] text-[16px] font-semibold leading-snug tracking-tight text-slate-900">
                        {topicTitleMissing(activeSyllabus, selectedTopic.title, language) &&
                        syllabusTranslationState(activeSyllabus?.id, language) === 'pending' ? (
                          <TranslatingText width="w-72" />
                        ) : (
                          localizedTopicTitle(activeSyllabus, selectedTopic.title, language)
                        )}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenLectures(selectedTopic)}
                      className="group inline-flex shrink-0 items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-slate-700"
                    >
                      {t('syllabus.next')}
                      <ArrowRight
                        size={14}
                        className="transition-transform duration-200 group-hover:translate-x-0.5"
                      />
                    </button>
                  </div>
                </div>
              )}

              {activeSyllabus && syllabusTranslationState(activeSyllabus.id, language) === 'pending' && (
                <p role="status" className="mb-6 flex items-center gap-2 text-[12.5px] font-medium text-sky-700">
                  <Loader2 size={14} className="animate-spin" />
                  {t('syllabus.titlesTranslating', {
                    lang: t(`common.languageName.${language}` as 'common.languageName.uz'),
                  })}
                </p>
              )}
              {activeSyllabus && syllabusTranslationState(activeSyllabus.id, language) === 'failed' && (
                <p role="alert" className="mb-6 flex flex-wrap items-center gap-3 text-[12.5px] font-medium text-rose-600">
                  {t('syllabus.titlesTranslateFailed', {
                    lang: t(`common.languageName.${language}` as 'common.languageName.uz'),
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      void retrySyllabusTranslation(activeSyllabus.id, language).then((ok) => {
                        if (ok) void load();
                      });
                    }}
                    className="font-semibold text-sky-700 underline-offset-2 hover:underline"
                  >
                    {t('common.retry')}
                  </button>
                </p>
              )}
              {activeSyllabus && topicGroups.length > 0 ? (
                <div className="space-y-10">
                  {topicGroups.map((group) => (
                    <TopicColumn
                      key={group.key}
                      title={group.title}
                      topics={group.topics}
                      selectedTopic={selectedTopic}
                      syllabus={activeSyllabus}
                      variantLabel={activeLabel}
                      coverage={coverage}
                      onPickTopic={pickTopicAndOpen}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-20 text-center text-[13.5px] text-slate-400">
                  {t('syllabus.noTopicsInTrack')}
                </p>
              )}
            </>
          )}
        </section>
      </div>
      {subjectDialog}
    </div>
  );
}

/**
 * Tarjimasi kelayotgan nom o'rnidagi belgi — asl tildagi nom ko'rsatilmaydi.
 */
function TranslatingText({ width = 'w-40' }: { width?: string }) {
  const { t } = useUiText();
  return (
    <span
      role="status"
      aria-label={t('common.translating')}
      title={t('common.translating')}
      className={`inline-block h-[0.9em] ${width} max-w-full animate-pulse rounded bg-slate-200 align-middle`}
    />
  );
}

/* Ikki ustunli ro'yxatda o'n mavzu bir ekranga sig'adi; qolgani
   sahifalanadi, chunki yigirmatasi birdan chiqsa ro'yxat cho'zilib
   ketadi va tanlash qiyinlashadi. */
const TOPICS_PER_PAGE = 10;

/**
 * Bir turdagi mavzular ro'yxati.
 *
 * Bu ro'yxatning butun qiyinligi — sarlavhalar. Tibbiy mavzu nomi ko'pincha
 * to'rt qatorlik jumla bo'ladi ("Nafas yo'li infeksiyalari epidemiologiyasi,
 * profilaktikasi va epidemiyaga qarshi chora-tadbirlarni tashkillashtirishning
 * o'ziga xos xususiyatlari va mazmuni: difteriya, qizamiq..."). O'ntasi
 * ketma-ket to'liq chiqarilsa, ro'yxat emas — matn devori hosil bo'ladi va
 * o'qituvchi qayerda bir mavzu tugab, ikkinchisi boshlanganini ko'rmaydi.
 *
 * Shuning uchun uchta qoida:
 *   1. sarlavha IKKI QATORGA qisqartiriladi — to'lig'i tanlangandan keyin
 *      tepadagi sarlavhada va sichqoncha ustida turganda chiqadi;
 *   2. har mavzu O'Z PLITKASIDA — orasidagi bo'sh joy chegarani aniq
 *      ko'rsatadi. Faqat chiziq bilan ajratilganda ikki ustundagi
 *      matnlar bir-biriga qo'shilib ketardi;
 *   3. chapda raqam nishoni — ko'z ilashadigan nuqta, ro'yxat sanaladigan
 *      bo'lib qoladi.
 *
 * Tanlangani: chap chekkada to'q chiziq, yengil fon, qalin matn.
 */
function TopicColumn({
  title,
  topics,
  selectedTopic,
  syllabus,
  variantLabel,
  coverage,
  onPickTopic,
}: {
  title: string;
  topics: SyllabusTopic[];
  selectedTopic: SyllabusTopicContext | null;
  syllabus: CourseSyllabusRow;
  variantLabel: string;
  coverage: TopicMaterialCoverage | null;
  onPickTopic: (topic: SyllabusTopic, syllabus: CourseSyllabusRow, variantLabel: string) => void;
}) {
  const { t } = useUiText();
  const [page, setPage] = React.useState(0);
  const totalPages = Math.max(1, Math.ceil(topics.length / TOPICS_PER_PAGE));
  const listKey = `${syllabus.id}-${variantLabel}-${topics.length}`;

  // Tanlangan mavzu turgan sahifa ochiladi. Ilgari har tanlovda 1-sahifaga
  // qaytardi va 2-sahifadagi tanlangan mavzu ko'rinmay qolardi.
  const selectedIndex = topics.findIndex(
    (topic) =>
      selectedTopic != null &&
      selectedTopic.syllabusId === syllabus.id &&
      topic.id === selectedTopic.id &&
      topic.type === selectedTopic.type,
  );
  React.useEffect(() => {
    setPage(selectedIndex >= 0 ? Math.floor(selectedIndex / TOPICS_PER_PAGE) : 0);
  }, [selectedIndex, listKey]);

  const pageStart = page * TOPICS_PER_PAGE;
  const visibleTopics = topics.slice(pageStart, pageStart + TOPICS_PER_PAGE);
  const showPagination = topics.length > TOPICS_PER_PAGE;

  const { language } = React.useContext(AppLanguageContext);

  const kindLabels: Record<string, string> = {
    lecture: t('nav.lectures'),
    presentation: t('nav.presentation'),
    case: t('nav.cases'),
    test: t('nav.tests'),
  };

  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          {title}
        </h3>
        <span className="h-px flex-1 bg-slate-900/[0.07]" />
        <span className="text-[11px] tabular-nums text-slate-400">{topics.length}</span>
      </div>

      {topics.length > 0 ? (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {visibleTopics.map((topic, index) => {
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
              const fullTitle = localizedTopicTitle(syllabus, topic.title, language);
              const titlePending =
                topicTitleMissing(syllabus, topic.title, language) &&
                syllabusTranslationState(syllabus.id, language) === 'pending';
              return (
                <motion.button
                  key={`${syllabus.id}-${variantLabel}-${topic.id}-${topic.title}`}
                  type="button"
                  onClick={() => onPickTopic(topic, syllabus, variantLabel)}
                  title={titlePending ? undefined : fullTitle}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.22, delay: Math.min(index * 0.018, 0.2) }}
                  className={`group relative flex h-full items-start gap-3.5 overflow-hidden rounded-xl bg-white px-4 py-3.5 text-left ring-1 transition-all duration-200 ${
                    isSelected
                      ? 'ring-slate-900/25'
                      : 'ring-slate-900/[0.06] hover:ring-slate-900/15'
                  }`}
                >
                  {/* Tanlangan plitkaning chap chekkasidagi belgisi. */}
                  <span
                    className={`absolute inset-y-0 left-0 w-[3px] transition-colors duration-200 ${
                      isSelected ? 'bg-slate-900' : 'bg-transparent group-hover:bg-slate-200'
                    }`}
                  />
                  <span
                    className={`mt-px w-5 shrink-0 text-right text-[12px] font-semibold tabular-nums transition-colors ${
                      isSelected ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-700'
                    }`}
                  >
                    {topicNumberFromId(topic.id) || topic.id}
                  </span>
                  {/* Ikki qator — uzun tibbiy sarlavhalar ro'yxatni matnga
                      aylantirib yubormasligi uchun. To'lig'i tanlangach
                      tepadagi sarlavhada chiqadi. */}
                  <span
                    className={`line-clamp-2 min-w-0 flex-1 text-[13px] leading-[1.5] transition-colors ${
                      isSelected
                        ? 'font-semibold text-slate-900'
                        : 'text-slate-700 group-hover:text-slate-900'
                    }`}
                  >
                    {titlePending ? <TranslatingText width="w-4/5" /> : fullTitle}
                  </span>
                  <MaterialDots
                    ready={coveredKinds(coverage, syllabus.id, topic.id)}
                    labels={kindLabels}
                  />
                </motion.button>
              );
            })}
          </div>

          {showPagination && (
            <div className="mt-5 flex items-center gap-4 text-[12px]">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="inline-flex items-center gap-1 font-medium text-slate-500 transition-colors hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft size={14} />
                {t('common.prev')}
              </button>
              <span className="tabular-nums text-slate-400">
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
                className="inline-flex items-center gap-1 font-medium text-slate-500 transition-colors hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
              >
                {t('common.next')}
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="py-4 text-[13px] text-slate-400">{t('syllabus.noTopicsInTrack')}</p>
      )}
    </section>
  );
}

/**
 * Mavzuga nima tayyorlangani — to'rtta nuqta.
 *
 * Ro'yxatda o'ttizta mavzu bor va o'qituvchining birinchi savoli hamisha
 * bitta: "buni tayyorlaganmidim?". Ilgari javobni faqat mavzuga kirib
 * bilish mumkin edi. Endi qatorning o'zi aytadi — to'q nuqta bor degani,
 * so'nigi yo'q degani. Yozuv emas, nuqta: o'ttizta qatorda o'ttizta yozuv
 * ro'yxatni yana matnga aylantirib yuborardi.
 *
 * `ready` null bo'lsa (ma'lumot hali kelmagan yoki so'rov yiqilgan) —
 * hech narsa chizilmaydi, bo'sh joy qoladi.
 */
function MaterialDots({
  ready,
  labels,
}: {
  ready: Set<PreparedContentKind> | null;
  labels: Record<string, string>;
}) {
  if (!ready) return <span className="w-[35px] shrink-0" />;
  const done = COVERAGE_KINDS.filter((k) => ready.has(k));
  const title = done.length
    ? done.map((k) => labels[k] || k).join(', ')
    : undefined;
  return (
    <span title={title} className="mt-[5px] flex w-[35px] shrink-0 items-center gap-[3px]">
      {COVERAGE_KINDS.map((kind) => (
        <span
          key={kind}
          className={`h-[5px] w-[5px] rounded-full transition-colors ${
            ready.has(kind) ? 'bg-emerald-500' : 'bg-slate-900/[0.09]'
          }`}
        />
      ))}
    </span>
  );
}
