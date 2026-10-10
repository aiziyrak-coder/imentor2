import { contentLanguageFor } from '../utils/syllabusInstructionLanguage';
import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { buildPreparedContentMeta } from '../utils/preparedContentMeta';
import { pushAppNotification } from '../utils/notifications';
import {
  FileText,
  Sparkles,
  Loader2,
  Download,
  Copy,
  CheckCircle2,
  BookOpen,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { motion } from 'motion/react';
import LectureMarkdown from './staff/LectureMarkdown';
import { aiService, LectureNote } from '../services/aiService';
import {
  GlobalTopicContext,
  GlobalLectureContext,
  AppLanguageContext,
  AppNavigationContext,
} from '../App';
import { useUiText } from '../i18n/useUiText';
import { formatTopicLessonLabel } from '../utils/topicLessonLabel';
import { isTopicContextComplete, topicContextKey, resolveTopicNorm } from '../utils/syllabusTopicContext';
import {
  readLectureForTopic,
  rememberActiveLectureVersion,
  writeLectureForTopic,
} from '../utils/lectureLocalCache';
import {
  listPreparedForTopicSynced,
  loadPreparedByIdSynced,
  savePreparedContent,
  updatePreparedContentPayload,
  deletePreparedContent,
  type PreparedContentMeta,
  type PreparedContentSummary,
} from '../utils/preparedContentStore';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import { copyTextToClipboard } from '../utils/copyText';
import StaffPageLayout from './staff/StaffPageLayout';
import SavedWorkList from './staff/SavedWorkList';
import StaffSectionLabel from './staff/StaffSectionLabel';
import StaffTopicHeader from './staff/StaffTopicHeader';
import StaffEmptyState from './staff/StaffEmptyState';
import StaffErrorAlert from './staff/StaffErrorAlert';
import StaffLoading from './staff/StaffLoading';
import StaffPanel from './staff/StaffPanel';
import TranslationGate from './staff/TranslationGate';
import { useTranslatedPayload } from '../i18n/useTranslatedPayload';
import type { AppLanguage } from '../i18n/language';
import { hydrateGenerationScope } from '../utils/subjectDomain';
import {
  staffBtnGhost,
  staffBtnPrimary,
  staffInput,
  staffLabel,
  staffProse,
  STAFF_HEADING,
} from './staff/staffUi';

export default function LectureNotes() {
  const globalTopic = useContext(GlobalTopicContext);
  const globalLecture = useContext(GlobalLectureContext);
  const { language } = useContext(AppLanguageContext);
  const { openSyllabus } = useContext(AppNavigationContext);
  const { t } = useUiText();
  const [topic, setTopic] = useState(globalTopic ? globalTopic.title : '');
  const [description, setDescription] = useState(
    globalTopic ? formatTopicLessonLabel(globalTopic.type, globalTopic.id, t) : '',
  );

  /** Qaysi mavzu uchun generatsiya ketayotgani (topicKey). Mavzu almashsa
   *  ham generatsiya o'z mavzusiga bog'liq qoladi — natija boshqa mavzu
   *  sahifasiga tushib qolmaydi. */
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [lectureSession, setLectureSession] = useState<LectureNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  /** Tahrir qaysi tildagi matn ustida va tahrir boshlangandagi matn
   *  (saqlanmagan o'zgarish bor-yo'qligini aniqlash uchun). */
  const [editLang, setEditLang] = useState<AppLanguage>(language);
  const [editBase, setEditBase] = useState('');
  const [savedLectures, setSavedLectures] = useState<PreparedContentSummary[]>([]);
  /** Ekrandagi ma'ruza Bazadagi qaysi yozuv — tahrir shu yozuvni yangilaydi. */
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  /** Saqlash yiqilganda — "Qayta saqlash" uchun kutayotgan ish. */
  const [pendingSave, setPendingSave] = useState<{
    topic: string;
    data: LectureNote;
    /** Saqlash yiqilgan paytdagi mavzu kaliti va meta — qayta urinish
     *  o'qituvchi boshqa mavzuga o'tgan bo'lsa ham ASL mavzuga yozadi. */
    key: string;
    meta: PreparedContentMeta;
  } | null>(null);
  const [retryingSave, setRetryingSave] = useState(false);
  const [openingSaved, setOpeningSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const setLectureContent = globalLecture.setContent;

  const topicFromSyllabus = Boolean(globalTopic && isTopicContextComplete(globalTopic));
  // Sarlavha interfeys tilida ko'rsatiladi (kontekstda asl matn turadi).
  const staffTopic = useLocalizedTopic(topicFromSyllabus && globalTopic ? globalTopic : null);

  const topicKey = topicContextKey(globalTopic) || topic.trim();
  const loading = generatingKey !== null && generatingKey === topicKey;
  /** Boshqa mavzu uchun generatsiya ketmoqda — bir vaqtda bittasi. */
  const busyElsewhere = generatingKey !== null && generatingKey !== topicKey;
  const topicKeyRef = useRef(topicKey);
  topicKeyRef.current = topicKey;
  const editDirty = Boolean(isEditing && lectureSession && editedContent !== editBase);

  // Ma'ruza FAQAT interfeys tilida ko'rsatiladi: tarjima tayyor bo'lmasa
  // "Tarjima qilinmoqda…" chiqadi (server fonda tarjima qilib qo'ygan bo'ladi).
  const {
    view: lectureView,
    status: rawLectureStatus,
    retry: retryTranslation,
  } = useTranslatedPayload(lectureSession, activeVersionId, language, (next) => setLectureSession(next));
  // Bazadagi yozuv hali yuklanayotgan bo'lsa — bu "saqlanmagan" emas, kutish.
  const lectureStatus = rawLectureStatus === 'unsaved' && openingSaved ? 'translating' : rawLectureStatus;
  const cacheNormNow = resolveTopicNorm(globalTopic);

  // Ko'rsatilgan (shu tildagi) matn keshlanadi — keyingi ochilishda darhol chiqadi.
  useEffect(() => {
    if (lectureStatus !== 'ready' || !lectureView?.content) return;
    setLectureContent(lectureView.content);
    if (cacheNormNow) writeLectureForTopic(`${cacheNormNow}@${language}`, lectureView.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureView?.content, lectureStatus, language, cacheNormNow]);

  /** Oxirgi commit holati — mavzu almashganda saqlanmagan tahrirni ESKI
   *  mavzuga yozish uchun (effekt ichida yangilanadi, shuning uchun
   *  cleanup paytida hali oldingi mavzuni ko'rsatadi). */
  const lastCommittedRef = useRef<{
    dirty: boolean;
    editedContent: string;
    editLang: AppLanguage;
    session: LectureNote | null;
    versionId: string | null;
    globalTopic: typeof globalTopic;
  } | null>(null);
  useEffect(() => {
    lastCommittedRef.current = {
      dirty: editDirty,
      editedContent,
      editLang,
      session: lectureSession,
      versionId: activeVersionId,
      globalTopic,
    };
  });

  // Tahrir paytida interfeys tili almashtirildi — tahrir o'z tilida
  // saqlanadi (yo'qolmaydi), sahifa yangi tildagi matnga o'tadi.
  const prevLanguageRef = useRef(language);
  useEffect(() => {
    if (prevLanguageRef.current === language) return;
    prevLanguageRef.current = language;
    const prev = lastCommittedRef.current;
    if (prev?.dirty && prev.session) {
      const next = buildEditedLecture(prev.session, prev.editLang, prev.editedContent);
      setLectureSession(next);
      void autoSaveEdit(prev.session, prev.editedContent, prev.versionId, prev.globalTopic, prev.editLang);
    }
    setIsEditing(false);
  }, [language]);

  // Taqdimot bo'limi o'qituvchi TANLAGAN ma'ruza versiyasidan foydalanadi.
  useEffect(() => {
    const norm = resolveTopicNorm(globalTopic);
    if (norm) rememberActiveLectureVersion(norm, activeVersionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersionId]);

  const refreshHistory = useCallback(() => {
    const lookup = globalTopic ?? topic;
    if (!topic.trim() && !globalTopic) {
      setSavedLectures([]);
      return;
    }
    void listPreparedForTopicSynced('lecture', lookup, { shared: true }).then(setSavedLectures);
  }, [topic, globalTopic]);

  /** O'qituvchi "kontekst" maydonini o'zi o'zgartirganmi — bo'lmasa u
   *  interfeys tili bilan birga yangilanadi (eski tilda qolib ketmasin). */
  const descriptionTouchedRef = useRef(false);
  useEffect(() => {
    if (globalTopic) {
      setTopic(globalTopic.title);
      descriptionTouchedRef.current = false;
      setDescription(formatTopicLessonLabel(globalTopic.type, globalTopic.id, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalTopic]);
  useEffect(() => {
    if (globalTopic && !descriptionTouchedRef.current) {
      setDescription(formatTopicLessonLabel(globalTopic.type, globalTopic.id, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Mavzu ochilganda shu fan/mavzudagi OXIRGI ma'ruza avtomatik chiqadi.
  useEffect(() => {
    let cancelled = false;
    const lookup = globalTopic ?? topic;
    if (!topic.trim() && !globalTopic) {
      setSavedLectures([]);
      setLectureSession(null);
      setEditedContent('');
      setLectureContent('');
      setActiveVersionId(null);
      setOpeningSaved(false);
      return;
    }
    const cachedNorm = resolveTopicNorm(globalTopic);
    // Kesh TIL bo'yicha: boshqa tildagi eski matn bir lahzaga ham chiqmasin.
    const cached = cachedNorm ? readLectureForTopic(`${cachedNorm}@${language}`) : '';
    if (cached) {
      setLectureSession({ topic: globalTopic?.title || topic, content: cached, primaryLanguage: language });
      setActiveVersionId(null);
      setLectureContent(cached);
    } else {
      setLectureSession(null);
      setEditedContent('');
      setLectureContent('');
      setActiveVersionId(null);
    }
    setIsEditing(false);
    setError(null);
    setOpeningSaved(true);
    void (async () => {
      const rows = await listPreparedForTopicSynced('lecture', lookup, { shared: true });
      if (cancelled) return;
      setSavedLectures(rows);
      if (!rows[0]) {
        setOpeningSaved(false);
        return;
      }
      const session = await loadPreparedByIdSynced<LectureNote>('lecture', rows[0].id);
      if (cancelled) return;
      if (session?.content) {
        setActiveVersionId(rows[0].id);
        setLectureSession(session);
      }
      setOpeningSaved(false);
    })();
    return () => {
      cancelled = true;
      // Tahrir rejimida saqlanmagan o'zgarish bilan mavzu almashtirildi —
      // ish indamay yo'qolmasin: eski mavzuning yozuviga saqlab qo'yamiz.
      const prev = lastCommittedRef.current;
      if (prev?.dirty && prev.session) {
        void autoSaveEdit(prev.session, prev.editedContent, prev.versionId, prev.globalTopic, prev.editLang);
      }
    };
    // faqat tanlangan mavzu kaliti — har harfda qayta yuklamaslik uchun
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey]);

  /**
   * Tahrirlangan ma'ruza payload'i.
   *
   * Asosiy tildagi matn tahrirlansa — tarjimalar eskiradi va olib tashlanadi
   * (server ularni fonda qaytadan tarjima qiladi). Tarjima tahrirlansa —
   * faqat o'sha til yangilanadi, asosiy matn va boshqa tillar o'zgarmaydi.
   */
  function buildEditedLecture(session: LectureNote, lang: AppLanguage, content: string): LectureNote {
    const primary = session.primaryLanguage;
    if (!primary || primary === lang) {
      return { topic: session.topic, content, primaryLanguage: lang };
    }
    const translations = { ...(session.translations || {}) };
    translations[lang] = { ...(translations[lang] || {}), content };
    return { ...session, translations };
  }

  async function autoSaveEdit(
    session: LectureNote,
    content: string,
    versionId: string | null,
    ctx: typeof globalTopic,
    lang: AppLanguage,
  ) {
    const next = buildEditedLecture(session, lang, content);
    try {
      const patched = versionId ? await updatePreparedContentPayload(versionId, next) : false;
      if (!patched) {
        await savePreparedContent('lecture', session.topic, next, buildPreparedContentMeta(ctx));
      }
      const norm = resolveTopicNorm(ctx);
      if (norm) writeLectureForTopic(`${norm}@${lang}`, content);
      pushAppNotification({
        title: t('common.doneTitle'),
        body: t('lecture.editAutoSaved'),
        titleKey: 'common.doneTitle',
        bodyKey: 'lecture.editAutoSaved',
        level: 'success',
      });
    } catch (err) {
      console.error('Lecture auto-save failed', err);
      pushAppNotification({
        title: t('common.errorTitle'),
        body: t('common.saveFailedKeepWork'),
        titleKey: 'common.errorTitle',
        bodyKey: 'common.saveFailedKeepWork',
        level: 'error',
      });
    }
  }

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!topic.trim() || generatingKey !== null) return;
    if (editDirty && !window.confirm(t('lecture.regenerateConfirmEdited'))) return;
    // Generatsiya boshlangan mavzu — natija va saqlash shu mavzuga bog'lanadi.
    const startKey = topicKey;
    const startTopic = topic;
    const startContext = globalTopic;
    const meta = buildPreparedContentMeta(startContext);
    const cacheNorm = resolveTopicNorm(startContext);
    const stillHere = () => topicKeyRef.current === startKey;
    setGeneratingKey(startKey);
    setError(null);
    setIsEditing(false);
    setStreamingContent('');
    try {
      const contentLanguage = contentLanguageFor(globalTopic, language);
      // Keys va test bilan BIR XIL qaror: serverdagi rasmiy klinik kafedra
      // bayrog'i va fan kodi ham hisobga olinadi (2026-09-26). Ilgari ma'ruza
      // faqat nom qolipiga qarardi va keys/testdan boshqa domen chiqishi mumkin edi.
      const domain = (await hydrateGenerationScope({ topic: startTopic, context: startContext })).domain;
      const generated = await aiService.generateLectureNotes(
        startTopic,
        description,
        contentLanguage,
        startContext?.subjectCode,
        (textSoFar) => setStreamingContent(textSoFar),
        domain,
      );
      // Asosiy til belgilanadi — server qolgan ikki tilga fonda tarjima qiladi.
      const data: LectureNote = { ...generated, primaryLanguage: contentLanguage };
      if (cacheNorm) writeLectureForTopic(`${cacheNorm}@${contentLanguage}`, data.content);
      if (stillHere()) {
        setActiveVersionId(null);
        setLectureSession(data);
      }
      // Kalit sifatida SARLAVHA emas, tuzilmali topicNorm ishlatiladi
      // (sillabus::yo'nalish::mavzu kodi) — aks holda mavzu nomi tarjima
      // qilinganda saqlangan ma'ruza topilmay qolardi.
      // Ma'ruza allaqachon ekranda (setLectureSession yuqorida) — saqlash
      // yiqilsa "generatsiya xatosi" deb ko'rsatmaymiz, aks holda
      // foydalanuvchi tayyor matnni yo'qotdim deb o'ylaydi.
      try {
        const savedId = await savePreparedContent('lecture', startTopic, data, meta);
        if (stillHere()) {
          setActiveVersionId(savedId);
          pushAppNotification({
            title: t('common.doneTitle'),
            body: t('lecture.readyToast'),
            titleKey: 'common.doneTitle',
            bodyKey: 'lecture.readyToast',
            level: 'success',
          });
          refreshHistory();
        } else {
          pushAppNotification({
            title: t('common.doneTitle'),
            body: t('common.readyOtherTopic', { title: startTopic }),
            titleKey: 'common.doneTitle',
            bodyKey: 'common.readyOtherTopic',
            bodyParams: { title: startTopic },
            topicSyllabusId: startContext?.syllabusId,
            level: 'success',
          });
        }
      } catch (saveErr) {
        console.error('Lecture save failed', saveErr);
        // Ish ekranda turibdi — foydalanuvchi bir bosishda qayta saqlay olsin.
        // Kalit va meta shu yerda qotiriladi: qayta urinish ASL mavzuga yozadi.
        setPendingSave({ topic: startTopic, data, key: startKey, meta });
        if (stillHere()) setError(t('common.saveFailedKeepWork'));
      }
    } catch (err) {
      console.error('Lecture generation error:', err);
      if (stillHere()) setError(t('lecture.errorGenerate'));
    } finally {
      setGeneratingKey(null);
      setStreamingContent('');
    }
  };

  const loadPastSession = async (summary: PreparedContentSummary) => {
    const session = await loadPreparedByIdSynced<LectureNote>('lecture', summary.id);
    if (!session) return;
    setActiveVersionId(summary.id);
    setLectureSession(session);
    setIsEditing(false);
  };

  /** Yiqilgan saqlashni qayta urinish — tayyor matn yo'qolmasin. */
  const handleRetrySave = () => {
    if (!pendingSave) return;
    void (async () => {
      setRetryingSave(true);
      try {
        const savedId = await savePreparedContent(
          'lecture',
          pendingSave.topic,
          pendingSave.data,
          pendingSave.meta,
        );
        if (pendingSave.key === topicKeyRef.current) {
          setActiveVersionId(savedId);
          refreshHistory();
        }
        setPendingSave(null);
        setError(null);
      } catch (err) {
        console.error('Lecture retry save failed', err);
        setError(t('common.saveFailedKeepWork'));
      } finally {
        setRetryingSave(false);
      }
    })();
  };

  /** Bazadagi saqlangan ma'ruzani butunlay o'chirish. */
  const handleDeleteSaved = (id: string) => {
    if (!window.confirm(t('toolbar.deleteConfirm'))) return;
    void (async () => {
      try {
        await deletePreparedContent('lecture', id);
        const remaining = savedLectures.filter((x) => x.id !== id);
        setSavedLectures(remaining);
        if (activeVersionId === id) {
          if (remaining[0]) {
            await loadPastSession(remaining[0]);
          } else {
            setActiveVersionId(null);
            setLectureSession(null);
            setEditedContent('');
            setLectureContent('');
          }
        }
      } catch (err) {
        console.error('Delete lecture failed', err);
        setError(t('toolbar.deleteFailed'));
      }
    })();
  };

  const handleCopy = async () => {
    if (!lectureView || lectureStatus !== 'ready') return;
    const ok = await copyTextToClipboard(lectureView.content);
    if (!ok) {
      // Ilgari xato faqat console'ga chiqardi — foydalanuvchi tugma
      // ishlamayotganini bilmasdi.
      setError(t('common.copyFailed'));
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!topicFromSyllabus && !topic.trim()) {
    return (
      <StaffPageLayout
        title={t('nav.lectures')}
        icon={BookOpen}
        accent="blue"
      >
        <StaffEmptyState
          icon={BookOpen}
          title={t('presentation.noTopic')}
          hint={t('presentation.noTopicHint')}
          actionLabel={t('common.goToSyllabus')}
          onAction={openSyllabus}
        />
      </StaffPageLayout>
    );
  }

  return (
    <StaffPageLayout
      title={t('nav.lectures')}
      icon={BookOpen}
      accent="blue"
    >
      <StaffTopicHeader
        moduleLabel={t('lecture.generateBadge')}
        topic={staffTopic}
      >
        {!topicFromSyllabus && (
          <input
            type="text"
            className={staffInput}
            placeholder={t('lecture.topicPlaceholderShort')}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        )}
        <label className="block space-y-1.5">
          <span className={staffLabel}>{t('lecture.contextLabel')}</span>
          <input
            type="text"
            className={staffInput}
            placeholder={t('lecture.descriptionPlaceholder')}
            value={description}
            onChange={(e) => {
              descriptionTouchedRef.current = true;
              setDescription(e.target.value);
            }}
          />
        </label>
      </StaffTopicHeader>

      {!lectureSession && !openingSaved && !loading && (
        <div className="mx-auto max-w-sm px-4 py-16 text-center">
          <Sparkles size={22} className="mx-auto mb-3 text-slate-300" />
          <p className="text-[13px] leading-relaxed text-slate-500">
            {t('toolbar.noVersions', { action: t('lecture.generateButton') })}
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || busyElsewhere || !topic.trim()}
            className={`${staffBtnPrimary} mt-5`}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {t('lecture.generateButton')}
          </button>
        </div>
      )}

      {busyElsewhere && (
        <p className="text-[12.5px] font-medium text-slate-500">{t('common.busyOtherTopic')}</p>
      )}

      {(error || pendingSave?.key === topicKey) && (
        <StaffErrorAlert
          message={error || t('common.saveFailedKeepWork')}
          actionLabel={pendingSave?.key === topicKey ? t('common.retrySave') : undefined}
          onAction={pendingSave?.key === topicKey ? handleRetrySave : undefined}
          actionBusy={retryingSave}
        />
      )}
      {openingSaved && !loading && !lectureSession && (
        <StaffLoading label={t('lecture.openingSaved')} hint={t('lecture.openingSavedHint')} />
      )}

      {loading && !streamingContent && (
        <StaffLoading label={t('lecture.generating')} hint={t('lecture.generatingHint')} />
      )}

      {loading && streamingContent && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <StaffPanel className="p-4 sm:p-5 flex items-center gap-2 text-sky-700">
            <Loader2 size={16} className="animate-spin shrink-0" />
            <p className="text-[13px] font-semibold">{t('lecture.generating')}</p>
          </StaffPanel>
          <StaffPanel className="p-6 sm:p-8 lg:p-10" large>
            {/* Streaming paytida oddiy matn (Markdown EMAS) — har harfda butun
                matnni qayta parse qilish sekinlashtiradi va "muzlab qolganday"
                ko'rinadi. To'liq formatlash faqat generatsiya tugagach. */}
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-slate-700">
              {streamingContent}
              <span className="inline-block w-2 h-4 bg-sky-500 ml-0.5 animate-pulse align-middle" />
            </pre>
          </StaffPanel>
        </motion.div>
      )}

      {lectureSession && !loading && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <StaffPanel className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Sarlavha interfeys tilida — sessiyada asl (o'zbekcha) matn turadi. */}
            <p className={`text-[16px] font-bold line-clamp-2 ${STAFF_HEADING}`}>
              {staffTopic?.translating
                ? t('common.translating')
                : staffTopic && staffTopic.title && lectureSession.topic === globalTopic?.title
                ? staffTopic.title
                : lectureView?.topic || lectureSession.topic}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={lectureStatus !== 'ready'}
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                    return;
                  }
                  // Shu tildagi saqlanmagan qoralama bo'lsa — davom ettiriladi.
                  const keepDraft = editLang === language && editedContent !== editBase && editBase !== '';
                  if (!keepDraft) {
                    const text = lectureView?.content || '';
                    setEditedContent(text);
                    setEditBase(text);
                    setEditLang(language);
                  }
                  setIsEditing(true);
                }}
                className={`${staffBtnGhost} disabled:opacity-50`}
              >
                <FileText size={15} />
                {isEditing ? t('lecture.view') : t('lecture.edit')}
              </button>
              {/* Yangi variant — avval faqat "yangi yaratish" bor edi va u
                  ekranni tozalab, mavzuni qaytadan kiritishni talab qilardi. */}
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={loading || busyElsewhere}
                className={`${staffBtnGhost} disabled:opacity-50`}
              >
                <RefreshCw size={15} />
                {t('lecture.regenerate')}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={lectureStatus !== 'ready'}
                className={`${staffBtnGhost} disabled:opacity-50`}
              >
                {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                {copied ? t('lecture.copied') : t('lecture.copy')}
              </button>
              {/* Chop etish faqat KO'RISH rejimida ishlaydi (chop CSS `.staff-prose`
                  ni ko'rsatadi). Tahrir rejimida bosilsa bo'sh sahifa chiqardi —
                  shuning uchun avval ko'rish rejimiga qaytariladi. */}
              <button
                type="button"
                disabled={lectureStatus !== 'ready'}
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                    window.setTimeout(() => window.print(), 100);
                    return;
                  }
                  window.print();
                }}
                className={`${staffBtnPrimary} disabled:opacity-50`}
              >
                <Download size={15} />
                {t('lecture.print')}
              </button>
            </div>
          </StaffPanel>

          {lectureSession.incomplete && (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
                <p className="text-[13.5px] leading-relaxed">{t('lecture.incompleteNotice')}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={loading || busyElsewhere}
                className={`${staffBtnPrimary} shrink-0 disabled:opacity-50`}
              >
                <RefreshCw size={15} />
                {t('lecture.regenerate')}
              </button>
            </div>
          )}

          <StaffPanel className="p-6 sm:p-8 lg:p-10" large>
            {isEditing ? (
              <div className="space-y-4">
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className={`${staffInput} min-h-[480px] font-sans leading-relaxed`}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingEdit}
                    onClick={async () => {
                      if (savingEdit) return;
                      setSavingEdit(true);
                      // O'qituvchi matnni o'zi to'ldirib saqlasa — "chala" belgisi olinadi.
                      // Tarjima tahrirlansa — faqat o'sha til yangilanadi.
                      const next = buildEditedLecture(lectureSession, editLang, editedContent);
                      setLectureSession(next);
                      try {
                        // MUHIM: meta (topicNorm) uzatilishi shart — busiz yozuv
                        // sillabus kaliti bilan emas, oddiy sarlavha bilan
                        // saqlanadi va Taqdimot bo'limi ma'ruzani topa olmay
                        // "ma'ruza matni yo'q" deb qolardi.
                        const meta = buildPreparedContentMeta(globalTopic);
                        const patched = activeVersionId
                          ? await updatePreparedContentPayload(activeVersionId, next)
                          : false;
                        if (!patched) {
                          const newId = await savePreparedContent(
                            'lecture',
                            lectureSession.topic,
                            next,
                            meta,
                          );
                          setActiveVersionId(newId);
                        }
                        setEditBase(editedContent);
                        refreshHistory();
                        setIsEditing(false);
                      } catch (err) {
                        console.error('Lecture edit save failed', err);
                        setError(t('common.saveFailedKeepWork'));
                      } finally {
                        setSavingEdit(false);
                      }
                    }}
                    className={`${staffBtnPrimary} disabled:opacity-50`}
                  >
                    {savingEdit && <Loader2 size={15} className="animate-spin" />}
                    {t('lecture.saveChanges')}
                  </button>
                </div>
              </div>
            ) : (
              <TranslationGate status={lectureStatus} onRetry={retryTranslation}>
                <article ref={printRef} className={staffProse}>
                  <LectureMarkdown>{lectureView?.content || ''}</LectureMarkdown>
                </article>
              </TranslationGate>
            )}
          </StaffPanel>

          <style>{`
            @media print {
              body * { visibility: hidden; }
              .staff-prose, .staff-prose * { visibility: visible; }
              .staff-prose { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
            }
          `}</style>
        </motion.div>
      )}

      {savedLectures.length > 0 && !loading && !openingSaved && (
        <div className="space-y-2 pt-2">
          <StaffSectionLabel count={savedLectures.length}>
            {t('lecture.topicVersions')}
          </StaffSectionLabel>
          <p className="text-[12.5px] text-slate-400">{t('lecture.topicVersionsHint')}</p>
          <SavedWorkList
            items={savedLectures}
            activeId={activeVersionId}
            onSelect={(id) => {
              const item = savedLectures.find((x) => x.id === id);
              if (item) void loadPastSession(item);
            }}
            onDelete={handleDeleteSaved}
            emptyText={t('lecture.noSaved')}
          />
        </div>
      )}
    </StaffPageLayout>
  );
}
