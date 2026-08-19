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
import { isTopicContextComplete, topicContextKey } from '../utils/syllabusTopicContext';
import {
  listPreparedForTopicSynced,
  loadPreparedByIdSynced,
  savePreparedContent,
  updatePreparedContentPayload,
  deletePreparedContent,
  type PreparedContentSummary,
} from '../utils/preparedContentStore';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import { copyTextToClipboard } from '../utils/copyText';
import StaffPageLayout from './staff/StaffPageLayout';
import SavedWorkList from './staff/SavedWorkList';
import StaffTopicHeader from './staff/StaffTopicHeader';
import StaffEmptyState from './staff/StaffEmptyState';
import StaffErrorAlert from './staff/StaffErrorAlert';
import StaffLoading from './staff/StaffLoading';
import StaffPanel from './staff/StaffPanel';
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

  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [lectureSession, setLectureSession] = useState<LectureNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [savedLectures, setSavedLectures] = useState<PreparedContentSummary[]>([]);
  /** Ekrandagi ma'ruza Bazadagi qaysi yozuv — tahrir shu yozuvni yangilaydi. */
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  /** Saqlash yiqilganda — "Qayta saqlash" uchun kutayotgan ish. */
  const [pendingSave, setPendingSave] = useState<{ topic: string; data: LectureNote } | null>(null);
  const [retryingSave, setRetryingSave] = useState(false);
  const [openingSaved, setOpeningSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const setLectureContent = globalLecture.setContent;

  const topicFromSyllabus = Boolean(globalTopic && isTopicContextComplete(globalTopic));
  // Sarlavha interfeys tilida ko'rsatiladi (kontekstda asl matn turadi).
  const staffTopic = useLocalizedTopic(topicFromSyllabus && globalTopic ? globalTopic : null);

  const topicKey = topicContextKey(globalTopic) || topic.trim();

  const refreshHistory = useCallback(() => {
    const lookup = globalTopic ?? topic;
    if (!topic.trim() && !globalTopic) {
      setSavedLectures([]);
      return;
    }
    void listPreparedForTopicSynced('lecture', lookup, { shared: true }).then(setSavedLectures);
  }, [topic, globalTopic]);

  useEffect(() => {
    if (globalTopic) {
      setTopic(globalTopic.title);
      setDescription(formatTopicLessonLabel(globalTopic.type, globalTopic.id, t));
    }
  }, [globalTopic]);

  // Mavzu ochilganda shu fan/mavzudagi OXIRGI ma'ruza avtomatik chiqadi.
  // Qayta generatsiya qilinmaguncha yangi matn yaratilmaydi.
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
    setOpeningSaved(true);
    setLectureSession(null);
    setEditedContent('');
    setLectureContent('');
    setActiveVersionId(null);
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
      if (session) {
        setActiveVersionId(rows[0].id);
        setLectureSession(session);
        setEditedContent(session.content);
        setLectureContent(session.content);
      }
      setOpeningSaved(false);
    })();
    return () => {
      cancelled = true;
    };
    // faqat tanlangan mavzu kaliti — har harfda qayta yuklamaslik uchun
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey]);

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    setStreamingContent('');
    try {
      const contentLanguage = language;
      const data = await aiService.generateLectureNotes(
        topic,
        description,
        contentLanguage,
        globalTopic?.subjectCode,
        (textSoFar) => setStreamingContent(textSoFar),
      );
      setLectureSession(data);
      setEditedContent(data.content);
      setLectureContent(data.content);
      // Kalit sifatida SARLAVHA emas, tuzilmali topicNorm ishlatiladi
      // (sillabus::yo'nalish::mavzu kodi) — aks holda mavzu nomi tarjima
      // qilinganda saqlangan ma'ruza topilmay qolardi.
      // Ma'ruza allaqachon ekranda (setLectureSession yuqorida) — saqlash
      // yiqilsa "generatsiya xatosi" deb ko'rsatmaymiz, aks holda
      // foydalanuvchi tayyor matnni yo'qotdim deb o'ylaydi.
      try {
        const savedId = await savePreparedContent(
          'lecture',
          topic,
          data,
          buildPreparedContentMeta(globalTopic),
        );
        setActiveVersionId(savedId);
        pushAppNotification({
          title: t('common.doneTitle'),
          body: t('lecture.readyToast'),
          titleKey: 'common.doneTitle',
          bodyKey: 'lecture.readyToast',
          level: 'success',
        });
        refreshHistory();
      } catch (saveErr) {
        console.error('Lecture save failed', saveErr);
        // Ish ekranda turibdi — foydalanuvchi bir bosishda qayta saqlay olsin.
        setPendingSave({ topic, data });
        setError(t('common.saveFailedKeepWork'));
      }
    } catch (err) {
      console.error('Lecture generation error:', err);
      setError(t('lecture.errorGenerate'));
    } finally {
      setLoading(false);
      setStreamingContent('');
    }
  };

  const loadPastSession = async (summary: PreparedContentSummary) => {
    const session = await loadPreparedByIdSynced<LectureNote>('lecture', summary.id);
    if (!session) return;
    setActiveVersionId(summary.id);
    setLectureSession(session);
    setEditedContent(session.content);
    globalLecture.setContent(session.content);
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
          buildPreparedContentMeta(globalTopic),
        );
        setActiveVersionId(savedId);
        setPendingSave(null);
        setError(null);
        refreshHistory();
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
    if (!lectureSession) return;
    const ok = await copyTextToClipboard(lectureSession.content);
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
      <StaffPageLayout>
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
    <StaffPageLayout>
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
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {!lectureSession && !openingSaved && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !topic.trim()}
            className={staffBtnPrimary}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {t('lecture.generateButton')}
          </button>
        )}
      </StaffTopicHeader>

      {error && (
        <StaffErrorAlert
          message={error}
          actionLabel={pendingSave ? t('common.retrySave') : undefined}
          onAction={pendingSave ? handleRetrySave : undefined}
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
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-black/80">
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
              {staffTopic && staffTopic.title && lectureSession.topic === globalTopic?.title
                ? staffTopic.title
                : lectureSession.topic}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setIsEditing(!isEditing)} className={staffBtnGhost}>
                <FileText size={15} />
                {isEditing ? t('lecture.view') : t('lecture.edit')}
              </button>
              {/* Yangi variant — avval faqat "yangi yaratish" bor edi va u
                  ekranni tozalab, mavzuni qaytadan kiritishni talab qilardi. */}
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={loading}
                className={`${staffBtnGhost} disabled:opacity-50`}
              >
                <RefreshCw size={15} />
                {t('lecture.regenerate')}
              </button>
              <button type="button" onClick={handleCopy} className={staffBtnGhost}>
                {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                {copied ? t('lecture.copied') : t('lecture.copy')}
              </button>
              {/* Chop etish faqat KO'RISH rejimida ishlaydi (chop CSS `.staff-prose`
                  ni ko'rsatadi). Tahrir rejimida bosilsa bo'sh sahifa chiqardi —
                  shuning uchun avval ko'rish rejimiga qaytariladi. */}
              <button
                type="button"
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                    window.setTimeout(() => window.print(), 100);
                    return;
                  }
                  window.print();
                }}
                className={staffBtnPrimary}
              >
                <Download size={15} />
                {t('lecture.print')}
              </button>
            </div>
          </StaffPanel>

          <StaffPanel className="p-6 sm:p-8 lg:p-10" large>
            {isEditing ? (
              <div className="space-y-4">
                <textarea
                  value={editedContent}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditedContent(v);
                    globalLecture.setContent(v);
                  }}
                  className={`${staffInput} min-h-[480px] font-sans leading-relaxed`}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      const next = { ...lectureSession, content: editedContent };
                      setLectureSession(next);
                      globalLecture.setContent(editedContent);
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
                        refreshHistory();
                        setIsEditing(false);
                      } catch (err) {
                        console.error('Lecture edit save failed', err);
                        setError(t('common.saveFailedKeepWork'));
                      }
                    }}
                    className={staffBtnPrimary}
                  >
                    {t('lecture.saveChanges')}
                  </button>
                </div>
              </div>
            ) : (
              <article ref={printRef} className={staffProse}>
                <LectureMarkdown>{lectureSession.content}</LectureMarkdown>
              </article>
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
          <h3 className={`text-[14px] font-bold ${STAFF_HEADING}`}>{t('lecture.topicVersions')}</h3>
          <p className="text-[12.5px] text-black/45">{t('lecture.topicVersionsHint')}</p>
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
