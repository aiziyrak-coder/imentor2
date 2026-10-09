import type { AppLanguage } from '../i18n/language';
import { contentLanguageFor } from '../utils/syllabusInstructionLanguage';
import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { pushAppNotification } from '../utils/notifications';
import {
  Stethoscope,
  Loader2,
  FileText,
  RefreshCw,
  KeyRound,
  Tags,
  ShieldCheck,
  Pill,
  Search,
  Eye,
  EyeOff,
} from 'lucide-react';
import { motion } from 'motion/react';
import { aiService, CaseStudySession } from '../services/aiService';
import { AppLanguageContext, GlobalTopicContext } from '../App';
import { useUiText } from '../i18n/useUiText';
import { getCurrentLocalUser, normalizeUserRole } from '../utils/localStaffAuth';
import { appendCaseStudyToLibrary } from '../utils/staffContentLibrary';
import {
  listPreparedForTopicSynced,
  loadPreparedByIdSynced,
  savePreparedContent,
  deletePreparedContent,
  type PreparedContentSummary,
} from '../utils/preparedContentStore';
import { buildPreparedContentMeta } from '../utils/preparedContentMeta';
import type { PreparedContentMeta } from '../utils/preparedContentStore';
import ContentTopicToolbar, { StaffToolbarButton } from './staff/ContentTopicToolbar';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import StaffPageLayout from './staff/StaffPageLayout';
import StaffErrorAlert from './staff/StaffErrorAlert';
import StaffLoading from './staff/StaffLoading';
import StaffPanel from './staff/StaffPanel';
import TranslationGate from './staff/TranslationGate';
import { useTranslatedPayload } from '../i18n/useTranslatedPayload';
import { isTopicContextComplete, topicContextKey } from '../utils/syllabusTopicContext';
import MedicalReferencesList from './staff/MedicalReferencesList';
import CaseAnswerView from './staff/CaseAnswerView';
import CaseScenarioView from './staff/CaseScenarioView';
import type { MedicalReference } from '../utils/medicalReferences';
import {
  staffInput,
  staffLabel,
  staffBtnSecondary,
  STAFF_HEADING,
} from './staff/staffUi';
import { messageFromAiError } from '../utils/aiErrors';
import { parseKeywordsInput } from '../utils/generationVariety';
import { downloadCaseAnswerKeyPdf, downloadCaseScenariosPdf } from '../utils/buildCasePdf';
import { loadLatestLectureText } from '../utils/lectureExcerpt';
import { hydrateGenerationScope, makeGenerationScope } from '../utils/subjectDomain';
import {
  caseFocusAccentBorderClass,
  caseFocusBadgeClass,
  caseFocusLabel,
  sortCaseQuestionsByFocus,
} from '../utils/caseFocusLabels';
import type { CaseStudyFocus } from '../utils/generationVariety';

const CASE_FOCUS_ICONS: Record<CaseStudyFocus, typeof ShieldCheck> = {
  profilaktika: ShieldCheck,
  davolash: Pill,
  tashxis: Search,
};

export default function CaseStudies() {
  const globalTopic = useContext(GlobalTopicContext);
  const { language } = useContext(AppLanguageContext);
  const { t } = useUiText();
  const [topic, setTopic] = useState(globalTopic ? globalTopic.title : '');
  const [keywords, setKeywords] = useState('');
  /** Qaysi mavzu uchun keys yaratilmoqda — bir vaqtda bittasi. */
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [downloadingCasesPdf, setDownloadingCasesPdf] = useState(false);
  const [downloadingKeyPdf, setDownloadingKeyPdf] = useState(false);
  const [caseSession, setCaseSession] = useState<CaseStudySession | null>(null);
  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);
  const [versions, setVersions] = useState<PreparedContentSummary[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Saqlash yiqilganda — "Qayta saqlash" uchun kutayotgan ish. */
  const [pendingSave, setPendingSave] = useState<{
    topic: string;
    data: CaseStudySession;
    /** Yiqilgan paytdagi mavzu — qayta urinish ASL mavzuga yozadi. */
    key: string;
    meta: PreparedContentMeta;
  } | null>(null);
  const [retryingSave, setRetryingSave] = useState(false);
  /** Ekrandagi keys qaysi tilda (tarjima tugmalari va PDF shu tilda). */
  const [caseViewLang, setCaseViewLang] = useState<AppLanguage>(language);

  const topicKey = topicContextKey(globalTopic) || topic.trim();
  const topicKeyRef = useRef(topicKey);
  topicKeyRef.current = topicKey;
  const loading = generatingKey !== null && generatingKey === topicKey;
  const busyElsewhere = generatingKey !== null && generatingKey !== topicKey;
  const languageRef = useRef(language);
  languageRef.current = language;

  const refreshVersions = useCallback(() => {
    if (!topic.trim()) {
      setVersions([]);
      return;
    }
    void listPreparedForTopicSynced('case', globalTopic ?? topic).then(setVersions);
  }, [topic, globalTopic]);

  /** `keepKeywords` — foydalanuvchi kiritgan kalit so'zlar saqlanib qolsin.
   * Ilgari Bazadan variant ochilganda inputdagi yangi kalit so'zlar
   * yuklangan sessiyanikiga almashtirilardi va yozilgani yo'qolardi. */
  // Keys interfeys tilida ko'rsatiladi; til tugmasi bilan boshqa tilda ham
  // ko'rish mumkin. Tarjima tayyor bo'lmasa — "Tarjima qilinmoqda…".
  useEffect(() => {
    setCaseViewLang(language);
  }, [language]);
  const {
    view: caseView,
    status: caseStatus,
    retry: retryCaseTranslation,
  } = useTranslatedPayload(caseSession, activeVersionId, caseViewLang, (next) => setCaseSession(next));

  const applySession = useCallback(
    (data: CaseStudySession, versionId: string | null, keepKeywords = false) => {
      setCaseSession(data);
      setCaseViewLang(languageRef.current);
      setRevealedAnswers(new Array(data.questions.length).fill(false));
      setActiveVersionId(versionId);
      if (!keepKeywords && data.keywords?.length) {
        setKeywords(data.keywords.join(', '));
      }
    },
    [],
  );

  useEffect(() => {
    if (globalTopic) {
      setTopic(globalTopic.title);
    }
  }, [globalTopic]);

  useEffect(() => {
    refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    if (!topic.trim()) {
      setCaseSession(null);
      setActiveVersionId(null);
      return;
    }
    let mounted = true;
    const lookup = globalTopic ?? topic;
    setCaseSession(null);
    setActiveVersionId(null);
    setError(null);
    // Shu mavzuda saqlangan OXIRGI keys avtomatik ochiladi — "Ma'ruza matni"
    // bilan bir xil. Ilgari sahifa bo'sh ochilardi va o'qituvchi hech narsa
    // yo'q deb pullik generatsiyani qayta bosardi.
    (async () => {
      const list = await listPreparedForTopicSynced('case', lookup);
      if (!mounted) return;
      setVersions(list);
      if (!list[0]) return;
      const data = await loadPreparedByIdSynced<CaseStudySession>('case', list[0].id);
      if (!mounted || !data) return;
      applySession(data, list[0].id, true);
    })();
    return () => {
      mounted = false;
    };
  }, [topic, globalTopic, applySession]);

  const handleSelectVersion = async (id: string) => {
    const data = await loadPreparedByIdSynced<CaseStudySession>('case', id);
    if (!data) {
      setError(t('case.errorLoadVersion'));
      return;
    }
    // Inputdagi kalit so'zlar tegilmaydi — ular keyingi yaratish uchun.
    applySession(data, id, keywords.trim().length > 0);
  };

  /** Bazadagi saqlangan variantni butunlay o'chirish. */
  const handleDeleteVersion = (id: string) => {
    if (!window.confirm(t('toolbar.deleteConfirm'))) return;
    void (async () => {
      try {
        await deletePreparedContent('case', id);
        if (activeVersionId === id) {
          setCaseSession(null);
          setActiveVersionId(null);
        }
        setVersions(await listPreparedForTopicSynced('case', globalTopic ?? topic));
      } catch (err) {
        console.error('Delete case version failed', err);
        setError(t('toolbar.deleteFailed'));
      }
    })();
  };

  const parsedKeywords = useMemo(() => parseKeywordsInput(keywords), [keywords]);
  const contentLanguage = contentLanguageFor(globalTopic, language);
  const generationDomain = useMemo(
    () =>
      makeGenerationScope({
        topic,
        subjectName: globalTopic?.subjectName,
        departmentName: globalTopic?.departmentName,
        subjectCode: globalTopic?.subjectCode,
      }).domain,
    [topic, globalTopic?.subjectName, globalTopic?.departmentName, globalTopic?.subjectCode],
  );

  const handleGenerate = async (currentTopic: string = topic) => {
    if (!currentTopic.trim() || generatingKey !== null) return;

    // Generatsiya boshlangan mavzu — o'qituvchi orada boshqa mavzuga o'tsa,
    // natija o'sha mavzu sahifasiga tushmaydi, faqat o'z mavzusiga saqlanadi.
    const startKey = topicKey;
    const startContext = globalTopic;
    const meta = buildPreparedContentMeta(startContext);
    const stillHere = () => topicKeyRef.current === startKey;
    setGeneratingKey(startKey);
    setError(null);
    try {
      const lectureText = await loadLatestLectureText(startContext ?? currentTopic);
      const scope = await hydrateGenerationScope({
        topic: currentTopic,
        context: startContext,
        lectureText,
      });
      const generated = await aiService.generateCaseStudy(
        currentTopic,
        contentLanguage,
        parsedKeywords,
        startContext?.subjectCode,
        scope,
      );
      // Asosiy til belgilanadi — server qolgan ikki tilga fonda tarjima qiladi.
      const data: CaseStudySession = { ...generated, primaryLanguage: contentLanguage };
      // Avval ekranga chiqaramiz: generatsiya bir necha daqiqa vaqt va pul
      // oladi, saqlash yiqilsa ham natija foydalanuvchida qolishi kerak.
      if (stillHere()) applySession(data, null);
      try {
        const savedId = await savePreparedContent('case', currentTopic, data, meta);
        if (stillHere()) {
          pushAppNotification({
            title: t('common.doneTitle'),
            body: t('case.readyToast'),
            titleKey: 'common.doneTitle',
            bodyKey: 'case.readyToast',
            level: 'success',
          });
          const list = await listPreparedForTopicSynced('case', startContext ?? currentTopic);
          if (stillHere()) {
            setVersions(list);
            applySession(data, savedId ?? list[0]?.id ?? null);
          }
        } else {
          pushAppNotification({
            title: t('common.doneTitle'),
            body: t('common.readyOtherTopic', { title: currentTopic }),
            titleKey: 'common.doneTitle',
            bodyKey: 'common.readyOtherTopic',
            bodyParams: { title: currentTopic },
            topicSyllabusId: startContext?.syllabusId,
            level: 'success',
          });
        }
      } catch (saveErr) {
        console.error('Case save failed', saveErr);
        // Keys ekranda turibdi — bir bosishda qayta saqlash imkoni beriladi.
        setPendingSave({ topic: currentTopic, data, key: startKey, meta });
        if (stillHere()) setError(t('common.saveFailedKeepWork'));
      }
      try {
        const u = getCurrentLocalUser();
        if (u && normalizeUserRole(u) === 'hodim') {
          appendCaseStudyToLibrary({
            authorUid: u.uid,
            authorName: u.displayName,
            session: data,
          });
        }
      } catch {
        /* bazaga yozish ixtiyoriy */
      }
      if (stillHere()) window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (stillHere()) setError(messageFromAiError(err, t('case.errorGenerate'), language));
    } finally {
      setGeneratingKey(null);
    }
  };

  /** Yiqilgan saqlashni qayta urinish — tayyor keys yo'qolmasin. */
  const handleRetrySave = () => {
    if (!pendingSave) return;
    void (async () => {
      setRetryingSave(true);
      try {
        const savedId = await savePreparedContent(
          'case',
          pendingSave.topic,
          pendingSave.data,
          pendingSave.meta,
        );
        const sameTopic = pendingSave.key === topicKeyRef.current;
        setPendingSave(null);
        setError(null);
        if (sameTopic) {
          const list = await listPreparedForTopicSynced('case', globalTopic ?? pendingSave.topic);
          setVersions(list);
          setActiveVersionId(savedId ?? list[0]?.id ?? null);
        }
      } catch (err) {
        console.error('Case retry save failed', err);
        setError(t('common.saveFailedKeepWork'));
      } finally {
        setRetryingSave(false);
      }
    })();
  };

  const handleRevealAnswer = (qIndex: number) => {
    setRevealedAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = !next[qIndex];
      return next;
    });
  };

  const handleDownloadCasesPdf = async () => {
    if (!caseView || caseStatus !== 'ready') return;
    setDownloadingCasesPdf(true);
    try {
      await downloadCaseScenariosPdf(caseView, caseViewLang);
    } catch (err) {
      console.error('Case PDF error:', err);
      setError(t('case.errorPdf'));
    } finally {
      setDownloadingCasesPdf(false);
    }
  };

  const handleDownloadKeyPdf = async () => {
    if (!caseView || caseStatus !== 'ready') return;
    setDownloadingKeyPdf(true);
    try {
      await downloadCaseAnswerKeyPdf(caseView, caseViewLang);
    } catch (err) {
      console.error('Case key PDF error:', err);
      setError(t('case.errorPdf'));
    } finally {
      setDownloadingKeyPdf(false);
    }
  };

  const staffTopic = useLocalizedTopic(
    globalTopic && isTopicContextComplete(globalTopic) ? globalTopic : null,
  );

  /** Ekranda klinik mantiq bo'yicha: tashxis → davolash → profilaktika.
   *  Saralash ko'rsatishda bajarilgani uchun eski keyslar ham to'g'ri chiqadi. */
  const orderedQuestions = useMemo(
    () => (caseView ? sortCaseQuestionsByFocus(caseView.questions) : []),
    [caseView],
  );

  const citeUrlsFromRefs = (refs?: MedicalReference[]): Record<number, string> => {
    const out: Record<number, string> = {};
    (refs || []).forEach((r, idx) => {
      const url = (r.url || '').trim();
      if (!url) return;
      const n = typeof r.citeIndex === 'number' ? r.citeIndex : idx + 1;
      out[n] = url;
    });
    return out;
  };

  return (
    <StaffPageLayout
      title={t('nav.cases')}
      icon={Stethoscope}
      accent="violet"
       spacious className="print:p-0 print:max-w-none print:m-0"
    >
      <ContentTopicToolbar
        moduleLabel={t('case.create')}
        topic={staffTopic}
        topicValue={topic}
        onTopicChange={setTopic}
        topicLabel={t('case.topicLabel')}
        topicPlaceholder={t('case.topicPlaceholder')}
        createLabel={t('case.create')}
        loading={loading || busyElsewhere}
        onCreate={() => void handleGenerate(topic)}
        lockTopicFromSyllabus={Boolean(staffTopic)}
        versions={versions}
        activeVersionId={activeVersionId}
        onSelectVersion={(id) => void handleSelectVersion(id)}
        onDeleteVersion={handleDeleteVersion}
        versionsTitle={t('case.savedVersions')}
        hint={t(
          generationDomain === 'academic'
            ? 'case.modeAcademic'
            : generationDomain === 'biomedical'
              ? 'case.modeBiomedical'
              : 'case.modeClinical',
        )}
        extra={
          <div className="space-y-2">
            <label className={`flex items-center gap-2 ${staffLabel}`}>
              <Tags size={14} />
              {t('case.keywordsLabel')}
              <span className="text-slate-300">({t('case.keywordsOptional')})</span>
            </label>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t('case.keywordsPlaceholder')}
              disabled={loading}
              className={staffInput}
            />
            <p className="text-[11px] text-slate-400">{t('case.keywordsHint')}</p>
          </div>
        }
      />

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
      {loading && (
        <StaffLoading
          label={t(generationDomain === 'academic' ? 'case.generatingAcademic' : 'case.generating')}
        />
      )}

      {!loading && caseSession && (
        <div className="space-y-5">
          {/* Chop etishda (Ctrl+P) asboblar paneli yashiriladi, keyslar esa
              javoblari bilan chiqadi. Ilgari butun blok `print:hidden` edi va
              pastdagi chop etish qismi hech qachon ko'rinmasdi. */}
          <StaffPanel className="p-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
            {/* Sarlavha interfeys tilida — sessiyada asl (o'zbekcha) matn turadi. */}
            <p className={`text-[14px] font-semibold ${STAFF_HEADING}`}>
              {staffTopic?.translating
                ? t('common.translating')
                : staffTopic && staffTopic.title && caseSession.topic === globalTopic?.title
                ? staffTopic.title
                : caseView?.topic || caseSession.topic}
            </p>
            <div className="flex flex-wrap gap-2">
              {/* Til almashtirgich — Test bo'limidagi bilan bir xil ko'rinish,
                  faol til ajralib turadi. */}
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200">
                {(['uz', 'ru', 'en'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    aria-pressed={caseViewLang === lang}
                    onClick={() => setCaseViewLang(lang)}
                    className={`px-3 py-1.5 text-xs font-semibold uppercase disabled:opacity-50 ${
                      caseViewLang === lang
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
              <StaffToolbarButton onClick={() => void handleGenerate(topic)} disabled={loading || busyElsewhere}>
                <RefreshCw size={16} />
                {t('case.regenerate')}
              </StaffToolbarButton>
              <StaffToolbarButton
                onClick={() => void handleDownloadCasesPdf()}
                disabled={downloadingCasesPdf || caseStatus !== 'ready'}
              >
                {downloadingCasesPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                {t('case.downloadCasesPdf')}
              </StaffToolbarButton>
              <StaffToolbarButton
                onClick={() => void handleDownloadKeyPdf()}
                disabled={downloadingKeyPdf || caseStatus !== 'ready'}
              >
                {downloadingKeyPdf ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                {t('case.downloadKeyPdf')}
              </StaffToolbarButton>
            </div>
          </StaffPanel>

          {/* Kalit so'zlar o'qituvchi kiritgan tilda — boshqa tilda ko'rilganda yashiriladi. */}
          {caseStatus === 'ready' &&
            (caseSession.primaryLanguage ?? caseViewLang) === caseViewLang &&
            caseSession.keywords && caseSession.keywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {caseSession.keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500"
                >
                  <Tags size={12} /> {kw}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 print:hidden">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {t('case.viewLabel')}
            </p>
            <div className="h-px flex-1 bg-slate-900/[0.07]" />
          </div>

          <TranslationGate status={caseStatus} onRetry={retryCaseTranslation}>
          <div className="space-y-4">
            {orderedQuestions.map((q, i) => {
              const FocusIcon = q.focus ? CASE_FOCUS_ICONS[q.focus] : Stethoscope;
              const revealed = revealedAnswers[i];
              return (
                <StaffPanel
                  key={i}
                  large
                  className={`overflow-hidden border-l-2 ${caseFocusAccentBorderClass(q.focus)} print:shadow-none print:border print:break-inside-avoid`}
                >
                  <div className="p-5 sm:p-7 flex items-start gap-4">
                    <div className="mt-0.5 shrink-0 text-slate-300">
                      <FocusIcon size={17} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          {t('case.questionLabel')} {i + 1}
                        </span>
                        {q.focus && (
                          <span
                            className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold uppercase tracking-wide ${caseFocusBadgeClass(q.focus)}`}
                          >
                            {caseFocusLabel(q.focus, caseViewLang, caseSession.domain)}
                          </span>
                        )}
                      </div>
                      {/* Vaziyat matni — kartochkadagi asosiy o'qiladigan qism:
                          qalinroq va kengroq satr oralig'i bilan. */}
                      <CaseScenarioView
                        text={q.scenario}
                        language={caseViewLang}
                        focus={q.focus}
                        domain={caseSession.domain}
                      />
                    </div>
                  </div>

                  <div className="px-5 sm:px-7 pb-5 sm:pb-7 pl-[76px] sm:pl-[84px] print:hidden">
                    <button
                      type="button"
                      onClick={() => handleRevealAnswer(i)}
                      className={staffBtnSecondary}
                    >
                      {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                      {revealed ? t('case.hideAnswer') : t('case.revealAnswer')}
                    </button>

                    {revealed && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mt-4 space-y-3"
                      >
                        <h4 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-slate-600">
                          <KeyRound size={14} className="shrink-0" />
                          {caseSession.domain === 'clinical' ? t('case.clinicalOpinion') : t('case.academicOpinion')}
                        </h4>
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:px-5 sm:py-5">
                          <CaseAnswerView
                            text={q.answer}
                            refAnchorPrefix={`case-${i}-ref`}
                            citeUrls={citeUrlsFromRefs(q.references)}
                          />
                        </div>
                        {q.references && q.references.length > 0 && (
                          <MedicalReferencesList
                            references={q.references}
                            compact
                            anchorPrefix={`case-${i}-ref`}
                          />
                        )}
                      </motion.div>
                    )}
                  </div>

                  {/* Print: har doim javobni ko'rsatish */}
                  <div className="hidden print:block px-7 pb-7 pl-[84px] space-y-3">
                    <h4 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-slate-600">
                      {caseSession.domain === 'clinical' ? t('case.clinicalOpinion') : t('case.academicOpinion')}
                    </h4>
                    <CaseAnswerView
                      text={q.answer}
                      refAnchorPrefix={`case-${i}-ref`}
                      citeUrls={citeUrlsFromRefs(q.references)}
                    />
                    {q.references && q.references.length > 0 && (
                      <MedicalReferencesList
                        references={q.references}
                        compact
                        className="mt-3"
                        anchorPrefix={`case-${i}-ref`}
                      />
                    )}
                  </div>
                </StaffPanel>
              );
            })}

            {/* Butun keys to'plami uchun umumiy manbalar — bir xil ko'k blok. */}
            {caseSession.references && caseSession.references.length > 0 && (
              <MedicalReferencesList references={caseSession.references} />
            )}
          </div>
          </TranslationGate>
        </div>
      )}
    </StaffPageLayout>
  );
}
