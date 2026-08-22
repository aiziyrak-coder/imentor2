import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  Brain,
  Copy,
  Users,
  Send,
  Download,
  KeyRound,
  Lock,
  ArrowLeft,
} from 'lucide-react';
import { motion } from 'motion/react';
import { aiService, TestSession, TestQuestion } from '../services/aiService';
import { AppLanguageContext, GlobalTopicContext } from '../App';
import type { AppLanguage } from '../i18n/language';
import { useUiText } from '../i18n/useUiText';
import { getCurrentLocalUser, normalizeUserRole } from '../utils/localStaffAuth';
import { getBackendAccessToken, loginStudentWithOnlineTest } from '../utils/backendAuth';
import {
  listPreparedForTopicSynced,
  loadLatestPreparedContent,
  loadPreparedByIdSynced,
  savePreparedContent,
  updatePreparedContentPayload,
  deletePreparedContent,
  normTopicKey,
  type PreparedContentSummary,
} from '../utils/preparedContentStore';
import { buildPreparedContentMeta } from '../utils/preparedContentMeta';
import ContentTopicToolbar, { StaffToolbarButton } from './staff/ContentTopicToolbar';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import { copyTextToClipboard } from '../utils/copyText';
import StaffPageLayout from './staff/StaffPageLayout';
import StaffErrorAlert from './staff/StaffErrorAlert';
import StaffLoading from './staff/StaffLoading';
import StaffPanel from './staff/StaffPanel';
import { isTopicContextComplete } from '../utils/syllabusTopicContext';
import {
  STAFF_HEADING,
  staffBtnGhost,
  staffExplainBody,
  staffExplainBox,
  staffExplainTitle,
  staffIndexBadge,
  staffOptionCorrect,
  staffOptionNeutral,
  staffQuestionText,
} from './staff/staffUi';
import { messageFromAiError } from '../utils/aiErrors';
import {
  syncLiveTestSessionToServer,
  fetchLiveTestSessionFromServer,
  submitLiveTestOnServer,
  fetchLiveTestSubmissionsFromServer,
  finalizeLiveTestSessionOnServer,
  upsertLiveTestDraftOnServer,
  getLiveTestParticipantKey,
  createLiveTestSessionOnServer,
  type StudentTestQuestion,
} from '../utils/liveTestApi';
import { postActivityEvents } from '../utils/analyticsApi';
import {
  bindLiveTestVisibilityTracking,
  flushLiveTestEvents,
  pushLiveTestEvent,
} from '../utils/liveTestAnticheat';
import QRCode from 'qrcode';
import { LIVE_SESSION_PREFIX, LIVE_SUBMISSIONS_PREFIX } from '../utils/liveTestStorage';
import MedicalReferencesList from './staff/MedicalReferencesList';
import {
  downloadTestAnswerKeyPdf,
  downloadTestResultsPdf,
} from '../utils/buildTestPdf';
import { gradeBadgeClass, scoreToGrade } from '../utils/testGrading';
import { stripOptionLetterPrefix } from '../utils/testOptionText';
import { DEFAULT_TEST_DIFFICULTY, DEFAULT_TEST_QUESTION_COUNT } from '../utils/testDifficulty';
import { loadLatestLectureText } from '../utils/lectureExcerpt';
import { hydrateGenerationScope, makeGenerationScope } from '../utils/subjectDomain';

interface LiveTestSessionDoc {
  topic: string;
  questions: TestQuestion[] | StudentTestQuestion[];
  createdAt: number;
}

function stripQuestionsForStudentView(questions: TestQuestion[]): StudentTestQuestion[] {
  return questions.map((q) => {
    const item: StudentTestQuestion = {
      question: q.question,
      options: q.options,
    };
    if (q.references?.length) item.references = q.references;
    return item;
  });
}

function saveStudentSession(sessionId: string, data: LiveTestSessionDoc): void {
  const safe: LiveTestSessionDoc = {
    topic: data.topic,
    createdAt: data.createdAt,
    questions: stripQuestionsForStudentView(data.questions as TestQuestion[]),
  };
  localStorage.setItem(`${LOCAL_TEST_SESSION_PREFIX}${sessionId}`, JSON.stringify(safe));
}

interface TestSubmissionDoc {
  sessionId: string;
  firstName: string;
  lastName: string;
  answers: number[];
  submittedAt: number;
}

const LOCAL_TEST_SESSION_PREFIX = LIVE_SESSION_PREFIX;
const LOCAL_TEST_SUBMISSIONS_PREFIX = LIVE_SUBMISSIONS_PREFIX;
const TEACHER_SID_BY_TOPIC = 'imentor-teacher-live-sid-v1';

function teacherSidStorageKey(topic: string): string {
  return `${TEACHER_SID_BY_TOPIC}:${normTopicKey(topic)}`;
}

function readStoredTeacherSid(topic: string): string | null {
  try {
    return sessionStorage.getItem(teacherSidStorageKey(topic));
  } catch {
    return null;
  }
}

function writeStoredTeacherSid(topic: string, sid: string): void {
  try {
    sessionStorage.setItem(teacherSidStorageKey(topic), sid);
  } catch {
    /* ignore */
  }
}

function clearStoredTeacherSid(topic: string): void {
  try {
    sessionStorage.removeItem(teacherSidStorageKey(topic));
  } catch {
    /* ignore */
  }
}

/** Yopilgan test paneli teacher sahifasidan shuncha vaqtdan keyin avto yo'qoladi. */
const TEACHER_SESSION_AUTO_HIDE_MS = 60 * 60 * 1000;

/** Savollar to'plamining barmoq izi — sessiyani qayta ishlatish AYNAN
 * shu savollar bo'lgandagina xavfsiz. Ilgari faqat mavzu va savollar SONI
 * solishtirilardi: 10 savolli testni qayta yaratganda eski sessiya qayta
 * ishlatilib, allaqachon topshirgan talabalarning javoblari YANGI kalit
 * bo'yicha baholanardi. */
function questionsFingerprint(questions: Array<TestQuestion | StudentTestQuestion>): string {
  return questions
    .map((q) => {
      const correct =
        'correctOptionIndex' in q && typeof q.correctOptionIndex === 'number'
          ? q.correctOptionIndex
          : -1;
      return `${(q.question || '').trim()}|${(q.options || []).join('¦')}|${correct}`;
    })
    .join('||');
}

function tryReuseTeacherSessionId(data: TestSession): string | null {
  const stored = readStoredTeacherSid(data.topic);
  if (!stored) return null;
  const doc = loadLocalSession(stored);
  if (!doc) return null;
  if (normTopicKey(doc.topic) !== normTopicKey(data.topic)) return null;
  if (doc.questions.length !== data.questions.length) return null;
  // Saqlangan sessiya talabalar ko'rinishida bo'lishi mumkin (to'g'ri javobsiz) —
  // shuning uchun savol/variant matnlari bo'yicha solishtiramiz.
  const storedFp = questionsFingerprint(
    (doc.questions as Array<TestQuestion | StudentTestQuestion>).map((q) => ({
      question: q.question,
      options: q.options,
    })),
  );
  const freshFp = questionsFingerprint(
    data.questions.map((q) => ({ question: q.question, options: q.options })),
  );
  if (storedFp !== freshFp) return null;
  return stored;
}

function saveLocalSession(sessionId: string, data: LiveTestSessionDoc): void {
  localStorage.setItem(`${LOCAL_TEST_SESSION_PREFIX}${sessionId}`, JSON.stringify(data));
}

function loadLocalSession(sessionId: string): LiveTestSessionDoc | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_TEST_SESSION_PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as LiveTestSessionDoc;
  } catch {
    return null;
  }
}

function loadLocalSubmissions(sessionId: string): TestSubmissionDoc[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_TEST_SUBMISSIONS_PREFIX}${sessionId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TestSubmissionDoc[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSubmissions(sessionId: string, list: TestSubmissionDoc[]): void {
  localStorage.setItem(`${LOCAL_TEST_SUBMISSIONS_PREFIX}${sessionId}`, JSON.stringify(list));
}

export default function TestQuestions() {
  const globalTopic = useContext(GlobalTopicContext);
  const { language } = useContext(AppLanguageContext);
  const { t, locale } = useUiText();
  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isStudentMode = queryParams.get('mode') === 'student';
  /** QR ba'zan `id=` bilan chiqishi mumkin — ikkalasini qabul qilamiz */
  const studentSessionId = (queryParams.get('sid') || queryParams.get('id') || '').trim();

  const [topic, setTopic] = useState(globalTopic ? globalTopic.title : '');
  const [loading, setLoading] = useState(false);
  const [testSession, setTestSession] = useState<TestSession | null>(null);
  const [versions, setVersions] = useState<PreparedContentSummary[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [viewLang, setViewLang] = useState<AppLanguage>(language);

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

  useEffect(() => {
    setViewLang(language);
  }, [language]);

  const availableTestLangs = useMemo<AppLanguage[]>(() => {
    if (!testSession) return [];
    const primary = testSession.primaryLanguage || language;
    const langs: AppLanguage[] = ['uz', 'ru', 'en'];
    return langs.filter((l) => l === primary || Boolean(testSession.translations?.[l]));
  }, [testSession, language]);

  const displayedTest = useMemo(() => {
    if (!testSession) return null;
    const primary = testSession.primaryLanguage || language;
    if (viewLang === primary) return testSession;
    const translated = testSession.translations?.[viewLang];
    return translated ? { ...testSession, ...translated } : testSession;
  }, [testSession, viewLang, language]);

  const refreshVersions = React.useCallback(() => {
    const lookup = globalTopic ?? topic;
    if (!topic.trim() && !globalTopic) {
      setVersions([]);
      return;
    }
    void listPreparedForTopicSynced('test', lookup).then(setVersions);
  }, [topic, globalTopic]);

  useEffect(() => {
    if (globalTopic && !isStudentMode) {
      setTopic(globalTopic.title);
    }
  }, [globalTopic, isStudentMode]);

  const setupTeacherLiveSession = async (data: TestSession, reuseSid?: string): Promise<string> => {
    const questions: TestQuestion[] = data.questions;
    const doc: LiveTestSessionDoc = {
      topic: data.topic,
      questions,
      createdAt: Date.now(),
    };
    const subjectCode = globalTopic?.subjectCode || '';
    const sid =
      reuseSid ||
      (await createLiveTestSessionOnServer({
        topic: doc.topic,
        questions,
        createdAt: doc.createdAt,
        subjectCode,
      }));
    if (reuseSid) {
      await syncLiveTestSessionToServer(sid, {
        topic: doc.topic,
        questions,
        createdAt: doc.createdAt,
        subjectCode,
      });
    }
    saveLocalSession(sid, doc);
    saveLocalSubmissions(sid, []);
    setTeacherSessionId(sid);
    setSessionClosed(false);
    setClosedAtMs(null);
    setJoinUrl(
      `${window.location.origin}${window.location.pathname}?mode=student&sid=${encodeURIComponent(sid)}`
    );
    setSubmissions([]);
    setShowAnalysis(false);
    writeStoredTeacherSid(data.topic, sid);
    return sid;
  };

  const [error, setError] = useState<string | null>(null);
  const [teacherSessionId, setTeacherSessionId] = useState<string>('');
  const [joinUrl, setJoinUrl] = useState('');
  const [joinQrDataUrl, setJoinQrDataUrl] = useState('');
  const [submissions, setSubmissions] = useState<TestSubmissionDoc[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [downloadingKeyPdf, setDownloadingKeyPdf] = useState(false);
  const [downloadingResultsPdf, setDownloadingResultsPdf] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [closedAtMs, setClosedAtMs] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [startingSession, setStartingSession] = useState(false);

  const [studentFirstName, setStudentFirstName] = useState('');
  const [studentLastName, setStudentLastName] = useState('');
  const [studentLoginId, setStudentLoginId] = useState('');
  const [studentLoginPassword, setStudentLoginPassword] = useState('');
  const [studentAuthLoading, setStudentAuthLoading] = useState(false);
  const [studentAuthed, setStudentAuthed] = useState(() => {
    const u = getCurrentLocalUser();
    return normalizeUserRole(u) === 'student';
  });
  const [studentAnswers, setStudentAnswers] = useState<number[]>([]);
  const [studentSubmitted, setStudentSubmitted] = useState(false);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentTest, setStudentTest] = useState<LiveTestSessionDoc | null>(null);

  const [sessionLoading, setSessionLoading] = useState(isStudentMode && !!studentSessionId);
  const serverSessionSyncedRef = useRef<string | null>(null);
  const participantKeyRef = useRef('');
  const testStartedAtRef = useRef<number | null>(null);
  const enrichTokenRef = useRef<symbol | null>(null);
  // Variant izohlari va tarjimalar test ko'ringandan KEYIN, fonda keladi.
  // Bu ko'rsatkichsiz o'qituvchi bo'sh izohlarni ko'rib "ishlamayapti" deb
  // o'ylaydi — aslida hali tayyorlanayotgan bo'ladi.
  const [enriching, setEnriching] = useState(false);

  const mapServerSubmissions = React.useCallback(
    (rows: Array<{ firstName: string; lastName: string; answers: number[]; submittedAt: number }>) =>
      rows.map((r) => ({
        sessionId: teacherSessionId,
        firstName: r.firstName,
        lastName: r.lastName,
        answers: r.answers,
        submittedAt: r.submittedAt,
      })),
    [teacherSessionId]
  );

  const refreshSessionClosedFromServer = React.useCallback(async (sessionKey: string) => {
    if (!sessionKey) return;
    try {
      const remote = await fetchLiveTestSessionFromServer(sessionKey);
      if (remote) {
        setSessionClosed(Boolean(remote.isClosed));
        setClosedAtMs(remote.closedAtMs ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!joinUrl) {
      setJoinQrDataUrl('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(joinUrl, { width: 420, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setJoinQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setJoinQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  useEffect(() => {
    if (!isStudentMode || !studentSessionId) {
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    setError(null);

    (async () => {
      participantKeyRef.current = getLiveTestParticipantKey(studentSessionId);

      const applyClosed = (closed: boolean) => {
        if (closed) {
          setSessionClosed(true);
          setError(t('test.sessionClosedStudentHint'));
        }
      };

      try {
        const remote = await fetchLiveTestSessionFromServer(studentSessionId);
        if (cancelled) return;
        if (remote?.isClosed) {
          applyClosed(true);
          setSessionLoading(false);
          return;
        }
        if (remote && remote.questions.length > 0) {
          const doc: LiveTestSessionDoc = {
            topic: remote.topic,
            questions: remote.questions,
            createdAt: remote.createdAt,
          };
          saveStudentSession(studentSessionId, doc);
          setStudentTest(doc);
          setStudentAnswers(new Array(doc.questions.length).fill(-1));
          testStartedAtRef.current = Date.now();
          void postActivityEvents([{ event_type: 'live_test_opened' }], `live-test:${studentSessionId}`);
          setSessionLoading(false);
          void upsertLiveTestDraftOnServer(studentSessionId, {
            participantKey: participantKeyRef.current,
            firstName: '',
            lastName: '',
            answers: new Array(doc.questions.length).fill(-1),
          }).catch(() => {});
          return;
        }
      } catch {
        /* serverdan o'qib bo'lmasa local fallback */
      }

      const local = loadLocalSession(studentSessionId);
      if (local) {
        if (!cancelled) {
          const safe: LiveTestSessionDoc = {
            topic: local.topic,
            createdAt: local.createdAt,
            questions: stripQuestionsForStudentView(local.questions as TestQuestion[]),
          };
          setStudentTest(safe);
          setStudentAnswers(new Array(local.questions.length).fill(-1));
          testStartedAtRef.current = Date.now();
          void postActivityEvents([{ event_type: 'live_test_opened' }], `live-test:${studentSessionId}`);
          setSessionLoading(false);
          void upsertLiveTestDraftOnServer(studentSessionId, {
            participantKey: participantKeyRef.current,
            firstName: '',
            lastName: '',
            answers: new Array(local.questions.length).fill(-1),
          }).catch(() => {});
        }
        return;
      }

      if (!cancelled) {
        setError(t('test.sessionNotFound'));
        setSessionLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isStudentMode, studentSessionId]);

  // Talabaning javob qoralamasi fonda serverga yoziladi — telefon o'chsa yoki
  // sahifa yopilsa ish yo'qolmasin. MUHIM: bu effekt AYNAN talaba rejimi
  // uchun (avval shart teskari yozilgani uchun hech qachon ishlamagan).
  useEffect(() => {
    if (!isStudentMode || !studentSessionId || !studentTest || studentSubmitted || sessionClosed) return;
    const timer = window.setTimeout(() => {
      void upsertLiveTestDraftOnServer(studentSessionId, {
        participantKey: participantKeyRef.current,
        firstName: studentFirstName,
        lastName: studentLastName,
        answers: studentAnswers,
      }).catch(() => {});
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    isStudentMode,
    studentSessionId,
    studentTest,
    studentSubmitted,
    sessionClosed,
    studentFirstName,
    studentLastName,
    studentAnswers,
  ]);

  useEffect(() => {
    if (!isStudentMode || !studentSessionId || !studentTest || studentSubmitted || sessionClosed) return;
    return bindLiveTestVisibilityTracking(studentSessionId);
  }, [isStudentMode, studentSessionId, studentTest, studentSubmitted, sessionClosed]);

  useEffect(() => {
    if (isStudentMode || !teacherSessionId) return;
    void refreshSessionClosedFromServer(teacherSessionId);
  }, [isStudentMode, teacherSessionId, refreshSessionClosedFromServer]);

  /**
   * Yopilgan (finalize qilingan) test paneli teacher sahifasida 60 daqiqa
   * ko'rinib turadi (natijalarni tahlil qilish uchun), so'ng avto yo'qoladi —
   * sahifa "yangi test yaratish" boshlang'ich holatiga qaytadi.
   */
  useEffect(() => {
    if (isStudentMode || !sessionClosed || !closedAtMs) return;
    const elapsed = Date.now() - closedAtMs;
    const remaining = TEACHER_SESSION_AUTO_HIDE_MS - elapsed;
    const resetPanel = () => {
      clearStoredTeacherSid(topic);
      setTestSession(null);
      setTeacherSessionId('');
      setJoinUrl('');
      setSubmissions([]);
      setSessionClosed(false);
      setClosedAtMs(null);
      setActiveVersionId(null);
    };
    if (remaining <= 0) {
      resetPanel();
      return;
    }
    const timer = window.setTimeout(resetPanel, remaining);
    return () => window.clearTimeout(timer);
  }, [isStudentMode, sessionClosed, closedAtMs, topic]);

  useEffect(() => {
    refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    if (isStudentMode || !topic.trim()) return;
    const lookup = globalTopic ?? topic;
    let mounted = true;
    // Sahifa TOZA ochiladi — avval yaratilgan test avtomatik ochilmaydi
    // (QR sessiyasi ham qayta tiklanmaydi). Bazadan tanlab ochiladi.
    (async () => {
      const list = await listPreparedForTopicSynced('test', lookup);
      if (!mounted) return;
      setVersions(list);
      setTestSession(null);
      setTeacherSessionId('');
      setJoinUrl('');
      setActiveVersionId(null);
    })();
    return () => {
      mounted = false;
    };
  }, [isStudentMode, topic, globalTopic, refreshVersions]);

  useEffect(() => {
    if (isStudentMode || !teacherSessionId || sessionClosed) return;

    const loadLocalNow = () => {
      const list = loadLocalSubmissions(teacherSessionId);
      list.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
      return list;
    };

    let cancelled = false;
    const ensureServerSession = async (): Promise<void> => {
      if (serverSessionSyncedRef.current === teacherSessionId) return;
      const localDoc = loadLocalSession(teacherSessionId);
      if (!localDoc) return;
      const ok = await syncLiveTestSessionToServer(teacherSessionId, {
        topic: localDoc.topic,
        questions: localDoc.questions as TestQuestion[],
        createdAt: localDoc.createdAt,
      });
      if (ok) serverSessionSyncedRef.current = teacherSessionId;
    };

    const tick = async () => {
      // Tab fonda bo'lsa so'rov yubormaymiz — sessiya soatlab ochiq turishi mumkin.
      if (document.hidden) return;
      try {
        await ensureServerSession();
        const remote = await fetchLiveTestSubmissionsFromServer(teacherSessionId);
        if (cancelled) return;
        // Server javob berdi — u YAGONA haqiqat manbai. Ilgari ro'yxat bo'sh
        // bo'lsa localStorage'ga tushilardi va boshqa sessiyaning eski
        // yozuvlari "topshirganlar" bo'lib ko'rinardi.
        setSubmissions(
          remote.map((r) => ({
            sessionId: teacherSessionId,
            firstName: r.firstName,
            lastName: r.lastName,
            answers: r.answers,
            submittedAt: r.submittedAt,
          })),
        );
      } catch {
        // Faqat server javob bermaganda — offline zaxira.
        if (!cancelled) setSubmissions(loadLocalNow());
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 4000);

    const onStorage = (e: StorageEvent) => {
      if (e.key === `${LOCAL_TEST_SUBMISSIONS_PREFIX}${teacherSessionId}`) {
        setSubmissions(loadLocalNow());
      }
    };
    window.addEventListener('storage', onStorage);
    // Tabga qaytilganda darhol yangilaymiz (fonda o'tkazib yuborilganlari uchun).
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isStudentMode, teacherSessionId, sessionClosed]);

  const handleFinalizeSession = async (): Promise<boolean> => {
    if (!teacherSessionId || !testSession || sessionClosed) return Boolean(sessionClosed);
    setFinalizing(true);
    setError(null);
    try {
      const result = await finalizeLiveTestSessionOnServer(teacherSessionId);
      setSessionClosed(result.isClosed);
      setClosedAtMs(result.closedAtMs ?? Date.now());
      setSubmissions(mapServerSubmissions(result.submissions));
      return true;
    } catch (err) {
      console.error('Finalize error:', err);
      setError(t('test.errorFinalize'));
      return false;
    } finally {
      setFinalizing(false);
    }
  };

  const handleBackToQuestions = () => {
    setShowAnalysis(true);
  };

  /** Yagona, izchil joylashgan almashtirish tugmasi — avval bu tugma faqat
   * "Natijalarni ko'rish"ga o'tkazardi, orqaga qaytish esa natijalar
   * jadvali ICHIDAGI alohida kichik "Orqaga" tugmasi orqali bo'lardi —
   * ikkita boshqaruv ikki xil joyda bo'lgani foydalanuvchini
   * chalg'itardi ("UI qotib qolganday" tuyulishi shundan). Endi bitta
   * tugma ikkala yo'nalishda ham ishlaydi va holatga qarab yorlig'i
   * o'zgaradi. */
  const handleToggleResultsView = () => {
    setShowAnalysis((prev) => !prev);
  };

  useEffect(() => {
    serverSessionSyncedRef.current = null;
  }, [teacherSessionId]);

  /** Bazadan variantni ochish — FAQAT ko'rsatadi.
   * Ilgari bu yerda darrov jonli sessiya (QR) yaratilardi: o'qituvchi
   * shunchaki savollarni ko'rmoqchi bo'lganda ham serverda sessiya paydo
   * bo'lardi. Endi sessiya alohida tugma bilan boshlanadi. */
  const handleSelectVersion = (id: string) => {
    void (async () => {
      const data = await loadPreparedByIdSynced<TestSession>('test', id);
      if (!data) {
        setError(t('test.errorLoadVersion'));
        return;
      }
      setTestSession(data);
      setViewLang(data.primaryLanguage || language);
      setTeacherSessionId('');
      setJoinUrl('');
      setSubmissions([]);
      setSessionClosed(false);
      setClosedAtMs(null);
      setActiveVersionId(id);
      setShowAnalysis(false);
      setError(null);
    })();
  };

  /** Jonli sessiyani (QR) ataylab boshlash. */
  const handleStartLiveSession = async () => {
    if (!testSession || teacherSessionId) return;
    setStartingSession(true);
    setError(null);
    try {
      const reused = tryReuseTeacherSessionId(testSession);
      await setupTeacherLiveSession(testSession, reused ?? undefined);
    } catch (err) {
      console.error('Live session start failed', err);
      setError(t('test.errorStartSession'));
    } finally {
      setStartingSession(false);
    }
  };

  /** Bazadagi saqlangan variantni butunlay o'chirish. */
  const handleDeleteVersion = (id: string) => {
    if (!window.confirm(t('toolbar.deleteConfirm'))) return;
    void (async () => {
      try {
        await deletePreparedContent('test', id);
        if (activeVersionId === id) {
          setTestSession(null);
          setActiveVersionId(null);
        }
        setVersions(await listPreparedForTopicSynced('test', globalTopic ?? topic));
      } catch (err) {
        console.error('Delete version failed', err);
        setError(t('toolbar.deleteFailed'));
      }
    })();
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!topic.trim()) return;

    // Test fanga bog'lanishi shart — fan/mavzu tanlanmagan bo'lsa yaratishga yo'l qo'ymaymiz
    if (!globalTopic?.subjectCode?.trim()) {
      setError(t('test.errorNoSubject'));
      return;
    }

    if (testSession && teacherSessionId) {
      const ok = window.confirm(t('test.regenerateConfirm'));
      if (!ok) return;
    }

    setLoading(true);
    setError(null);
    const enrichToken = Symbol('test-enrich');
    enrichTokenRef.current = enrichToken;
    try {
      const count = DEFAULT_TEST_QUESTION_COUNT;
      // Asosiy til = UI tili (header dagi uz/ru/en). Qolgan 2 til — fonda tarjima.
      const contentLanguage = language;
      const lectureText = await loadLatestLectureText(globalTopic ?? topic);
      const scope = await hydrateGenerationScope({
        topic,
        context: globalTopic,
        lectureText,
      });
      const data = await aiService.generateTests(
        topic,
        count,
        contentLanguage,
        globalTopic.subjectCode,
        DEFAULT_TEST_DIFFICULTY,
        scope,
      );
      setTestSession(data);
      setViewLang(data.primaryLanguage || contentLanguage);
      const sid = await setupTeacherLiveSession(data);
      if (!sid) throw new Error('live-session-missing');
      setLoading(false);

      const meta = buildPreparedContentMeta(globalTopic);
      // Asosiy tildagi test DARHOL bazaga yoziladi. Avval saqlash faqat fon
      // "enrich" (tarjima + manbalar) tugagach bo'lardi — o'qituvchi shu orada
      // sahifadan chiqsa test Bazada umuman qolmasdi.
      let savedId: string | null = null;
      try {
        savedId = await savePreparedContent('test', topic, data, meta);
        const firstList = await listPreparedForTopicSynced('test', globalTopic ?? topic);
        setVersions(firstList);
        setActiveVersionId(savedId ?? firstList[0]?.id ?? null);
      } catch (saveErr) {
        console.error('Test save failed', saveErr);
        setError(t('common.saveFailedKeepWork'));
      }

      setEnriching(true);
      void (async () => {
        try {
          // Fonda: qolgan 2 tilga tarjima + kitob manbalari
          const enriched = await aiService.enrichTestSession(
            data,
            contentLanguage,
            globalTopic.subjectCode,
          );
          if (enrichTokenRef.current !== enrichToken) return;
          setTestSession(enriched);
          // Bazada NUSXA ko'paymasligi uchun yangi yozuv emas, mavjudi yangilanadi.
          const patched = savedId ? await updatePreparedContentPayload(savedId, enriched) : false;
          if (!patched) {
            await savePreparedContent('test', topic, enriched, meta);
          }
          await setupTeacherLiveSession(enriched, sid);
        } catch (enrichErr) {
          console.warn('Test enrich failed — primary-language test already saved', enrichErr);
        }
        if (enrichTokenRef.current !== enrichToken) return;
        setEnriching(false);
        const nextList = await listPreparedForTopicSynced('test', globalTopic ?? topic);
        setVersions(nextList);
        setActiveVersionId(savedId ?? nextList[0]?.id ?? null);
      })();
    } catch (err) {
      console.error('Test generation error:', err);
      setError(messageFromAiError(err, t('test.errorGenerate'), language));
      setLoading(false);
    }
  };

  const handleStudentAnswer = (questionIndex: number, optionIndex: number) => {
    if (studentSubmitted) return;
    const prev = studentAnswers[questionIndex];
    if (studentSessionId) {
      pushLiveTestEvent(studentSessionId, {
        event_type: prev >= 0 && prev !== optionIndex ? 'answer_change' : 'answer_select',
        question_index: questionIndex,
        option_index: optionIndex,
      });
    }
    const next = [...studentAnswers];
    next[questionIndex] = optionIndex;
    setStudentAnswers(next);
  };

  /** Ball. Javoblar ro'yxati savollar ro'yxatidan uzunroq bo'lishi mumkin
   * (masalan test qayta yaratilgan bo'lsa) — `questions[i]` mavjudligi
   * tekshirilmasa sahifa butunlay yiqilardi. */
  const calculateScore = (answers: number[], questions: TestQuestion[]) => {
    return answers.filter((a, i) => {
      const q = questions[i];
      return q != null && a === q.correctOptionIndex;
    }).length;
  };

  const handleDownloadKeyPdf = async () => {
    if (!testSession) return;
    setDownloadingKeyPdf(true);
    try {
      await downloadTestAnswerKeyPdf(testSession, language);
    } catch (err) {
      console.error('Answer key PDF error:', err);
      setError(t('test.errorPdf'));
    } finally {
      setDownloadingKeyPdf(false);
    }
  };

  const handleDownloadResultsPdf = async () => {
    if (!testSession || submissions.length === 0) return;
    setDownloadingResultsPdf(true);
    try {
      await downloadTestResultsPdf(
        testSession,
        submissions.map((s) => ({
          firstName: s.firstName,
          lastName: s.lastName,
          answers: s.answers,
          submittedAt: s.submittedAt,
        })),
        language,
      );
    } catch (err) {
      console.error('Results PDF error:', err);
      setError(t('test.errorPdf'));
    } finally {
      setDownloadingResultsPdf(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!studentLoginId.trim() || !studentLoginPassword) {
      setError(t('test.studentLoginRequired'));
      return;
    }
    setStudentAuthLoading(true);
    try {
      const u = await loginStudentWithOnlineTest(studentLoginId.trim(), studentLoginPassword);
      setStudentFirstName(u.firstName || '');
      setStudentLastName(u.lastName || '');
      setStudentAuthed(true);
      setStudentLoginPassword('');
      await getBackendAccessToken();
    } catch (err) {
      console.error(err);
      const code = err instanceof Error ? err.message : '';
      setError(
        code === 'forbidden' ? t('test.studentLoginForbidden') : t('test.studentLoginError'),
      );
    } finally {
      setStudentAuthLoading(false);
    }
  };

  useEffect(() => {
    if (!isStudentMode || !studentAuthed) return;
    const u = getCurrentLocalUser();
    if (normalizeUserRole(u) !== 'student' || !u) return;
    if (!studentFirstName.trim() && u.firstName) setStudentFirstName(u.firstName);
    if (!studentLastName.trim() && u.lastName) setStudentLastName(u.lastName);
  }, [isStudentMode, studentAuthed, studentFirstName, studentLastName]);

  useEffect(() => {
    if (!studentSubmitted) return;
    const timer = window.setTimeout(() => {
      window.location.href = `${window.location.pathname}?view=my-tests`;
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [studentSubmitted]);

  const handleStudentSubmit = async () => {
    if (!studentTest || !studentSessionId) return;
    if (!studentAuthed) {
      setError(t('test.studentLoginRequired'));
      return;
    }
    if (!studentFirstName.trim() || !studentLastName.trim()) {
      setError(t('test.studentErrorName'));
      return;
    }
    if (studentAnswers.includes(-1)) {
      setError(t('test.studentErrorAllQuestions'));
      return;
    }
    setStudentLoading(true);
    setError(null);
    try {
      await flushLiveTestEvents(studentSessionId, participantKeyRef.current);
      const started = testStartedAtRef.current ?? Date.now();
      await submitLiveTestOnServer(studentSessionId, {
        participantKey: participantKeyRef.current,
        firstName: studentFirstName.trim(),
        lastName: studentLastName.trim(),
        answers: studentAnswers,
        started_at_ms: started,
        duration_sec: Math.max(0, Math.round((Date.now() - started) / 1000)),
      });
      const item: TestSubmissionDoc = {
        sessionId: studentSessionId,
        firstName: studentFirstName.trim(),
        lastName: studentLastName.trim(),
        answers: studentAnswers,
        submittedAt: Date.now(),
      };
      const list = loadLocalSubmissions(studentSessionId);
      list.unshift(item);
      saveLocalSubmissions(studentSessionId, list);
      setStudentSubmitted(true);
    } catch (err) {
      console.error(err);
      setError(t('test.studentErrorSubmit'));
    } finally {
      setStudentLoading(false);
    }
  };

  if (isStudentMode) {
    return (
      <div className="h-full flex flex-col bg-[#f2f2f7] p-3 sm:p-5 lg:p-6 overflow-y-auto">
        <div className="w-full space-y-6 pb-20">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">{t('test.studentTitle')}</h1>
            {/* Avval har doim (login bosqichida ham) "ism-familiyangizni kiriting"
                degan matn ko'rsatilardi — aslida bu bosqichda login talab
                qilinadi, ism-familiya keyingi qadamda so'raladi. Matn holatga
                mos bo'lishi uchun shartli qilindi. */}
            <p className="text-gray-500">
              {studentAuthed ? t('test.studentSubtitle') : t('test.studentLoginHint')}
            </p>
          </div>
          {!studentAuthed ? (
            <form
              onSubmit={handleStudentLogin}
              className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 space-y-4 max-w-md mx-auto w-full"
            >
              <div className="flex items-center gap-2 text-blue-700 font-semibold">
                <KeyRound size={20} />
                {t('test.studentLoginTitle')}
              </div>
              <input
                value={studentLoginId}
                onChange={(e) => setStudentLoginId(e.target.value)}
                placeholder={t('test.studentLoginId')}
                autoComplete="username"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="password"
                value={studentLoginPassword}
                onChange={(e) => setStudentLoginPassword(e.target.value)}
                placeholder={t('test.studentLoginPassword')}
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-400"
              />
              {error && (
                <div className="bg-rose-50 text-rose-700 border border-rose-200 p-3 rounded-xl text-sm">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={studentAuthLoading}
                className="w-full h-12 bg-blue-600 text-white rounded-2xl font-semibold hover:bg-blue-500 flex items-center justify-center gap-2"
              >
                {studentAuthLoading ? <Loader2 size={18} className="animate-spin" /> : null}
                {t('test.studentLoginBtn')}
              </button>
            </form>
          ) : sessionLoading ? (
            <div className="bg-white rounded-3xl p-8 border border-gray-100 text-center">
              <Loader2 className="animate-spin text-blue-600 mx-auto mb-3" />
              <p className="text-gray-600">{t('test.studentLoading')}</p>
            </div>
          ) : error && !studentTest ? (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-3xl p-6 text-center font-medium">
              {error}
            </div>
          ) : sessionClosed ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-3xl p-8 text-center space-y-3">
              <Lock size={32} className="mx-auto text-amber-700" />
              <p className="font-bold text-lg">{t('test.sessionClosedStudent')}</p>
              <p className="text-sm text-amber-800/80">{t('test.sessionClosedStudentHint')}</p>
            </div>
          ) : studentTest ? (
            <>
              <div className="bg-white rounded-3xl p-6 border border-gray-100">
                <h2 className="text-xl font-bold text-gray-800 mb-4">{studentTest.topic}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={studentFirstName}
                    onChange={(e) => setStudentFirstName(e.target.value)}
                    placeholder={t('test.studentFirstName')}
                    disabled={studentSubmitted || sessionClosed}
                    className="px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <input
                    value={studentLastName}
                    onChange={(e) => setStudentLastName(e.target.value)}
                    placeholder={t('test.studentLastName')}
                    disabled={studentSubmitted || sessionClosed}
                    className="px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              <div className="space-y-6">
                {/* Talaba ko'rinishi ham o'qituvchinikidek: raqam nishoni,
                    qalin savol matni, bir xil variant o'lchamlari. */}
                {studentTest.questions.map((q, i) => (
                  <div key={i} className="bg-white rounded-3xl p-5 sm:p-6 border border-gray-100 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className={staffIndexBadge}>{i + 1}</div>
                      <p className={staffQuestionText}>{q.question}</p>
                    </div>
                    <div className="space-y-2">
                      {q.options.map((opt, optIdx) => (
                        <button
                          key={optIdx}
                          onClick={() => handleStudentAnswer(i, optIdx)}
                          disabled={studentSubmitted || sessionClosed}
                          className={`w-full text-left text-[14px] leading-relaxed p-3 rounded-xl border transition-colors ${
                            studentAnswers[i] === optIdx
                              ? 'border-blue-500 bg-blue-50 text-blue-900 font-semibold'
                              : 'border-black/10 bg-white text-[#083047]/85 hover:bg-black/[0.02]'
                          }`}
                        >
                          <span className="font-bold">{String.fromCharCode(65 + optIdx)})</span>{' '}
                          {stripOptionLetterPrefix(opt, optIdx)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {!studentSubmitted && !sessionClosed ? (
                <button
                  onClick={handleStudentSubmit}
                  disabled={studentLoading}
                  className="w-full h-12 bg-blue-600 text-white rounded-2xl font-semibold hover:bg-blue-500 flex items-center justify-center gap-2"
                >
                  {studentLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  {t('test.studentSubmit')}
                </button>
              ) : studentSubmitted ? (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-xl space-y-3">
                  <p className="font-semibold">{t('test.studentSuccess')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = `${window.location.pathname}?view=my-tests`;
                    }}
                    className="w-full h-11 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500"
                  >
                    {t('student.myTestsTitle')}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          {error && studentTest && (
            <div className="bg-rose-50 text-rose-700 border border-rose-200 p-3 rounded-xl">{error}</div>
          )}
        </div>
      </div>
    );
  }

  const staffTopic = useLocalizedTopic(
    globalTopic && isTopicContextComplete(globalTopic) ? globalTopic : null,
  );

  return (
    <StaffPageLayout spacious>
      <ContentTopicToolbar
        moduleLabel={t('test.teacherBadge', { count: DEFAULT_TEST_QUESTION_COUNT })}
        topic={staffTopic}
        topicValue={topic}
        onTopicChange={setTopic}
        topicLabel={t('test.topicLabel')}
        topicPlaceholder={t('test.topicPlaceholder')}
        createLabel={t('test.create', { count: DEFAULT_TEST_QUESTION_COUNT })}
        loading={loading}
        onCreate={() => void handleGenerate()}
        lockTopicFromSyllabus={Boolean(staffTopic)}
        hint={`${t('test.heroSubtitle')} ${t(generationDomain === 'academic' ? 'test.modeAcademic' : 'test.modeClinical')}`}
        versions={versions}
        activeVersionId={activeVersionId}
        onSelectVersion={handleSelectVersion}
        onDeleteVersion={handleDeleteVersion}
        versionsTitle={t('test.savedVersions')}
        hasUnsavedActiveContent={Boolean(testSession)}
      />

      {error && <StaffErrorAlert message={error} />}
      {loading && (
        <StaffLoading
          label={t('test.generating')}
          hint={t('test.generatingHint', {
            count: DEFAULT_TEST_QUESTION_COUNT,
            level: t('test.difficultyHard'),
          })}
        />
      )}

        {testSession && displayedTest && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <StaffPanel className="p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                {/* Sarlavha interfeys tilida — sessiyada asl (o'zbekcha) matn turadi. */}
                <h2 className={`text-xl font-bold ${STAFF_HEADING}`}>
                  {staffTopic && staffTopic.title && displayedTest.topic === globalTopic?.title
                    ? staffTopic.title
                    : displayedTest.topic}
                </h2>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {availableTestLangs.length > 1 && (
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
                      {availableTestLangs.map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setViewLang(l)}
                          className={`px-3 py-1.5 text-xs font-semibold uppercase ${
                            viewLang === l ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  )}
                  <StaffToolbarButton onClick={() => void handleDownloadKeyPdf()} disabled={downloadingKeyPdf}>
                    {downloadingKeyPdf ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                    {t('test.downloadKeyPdf')}
                  </StaffToolbarButton>
                  <StaffToolbarButton
                    onClick={() => void handleDownloadResultsPdf()}
                    disabled={downloadingResultsPdf || submissions.length === 0}
                  >
                    {downloadingResultsPdf ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    {t('test.downloadResultsPdf')} ({submissions.length})
                  </StaffToolbarButton>
                </div>
              </div>

              {sessionClosed && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                  <Lock size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{t('test.sessionClosedTeacher')}</p>
                    <p className="text-sm text-amber-800/85 mt-1">{t('test.sessionClosedTeacherHint')}</p>
                  </div>
                </div>
              )}

              {joinUrl && !sessionClosed && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
                  <div className="lg:col-span-1 flex justify-center">
                    <div className="bg-white border-4 border-blue-200 rounded-2xl p-4 shadow-md">
                      {joinQrDataUrl ? (
                        <img
                          src={joinQrDataUrl}
                          alt="Student test QR"
                          className="w-72 h-72 sm:w-80 sm:h-80 object-contain"
                        />
                      ) : (
                        <div className="w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center text-sm text-gray-500">
                          QR…
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="lg:col-span-2 space-y-3">
                    <p className="text-sm text-gray-600">
                      {t('test.qrInstructions')}
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={joinUrl}
                        readOnly
                        className="flex-1 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          // http:// da `navigator.clipboard` yo'q — zaxira usul bilan.
                          const ok = await copyTextToClipboard(joinUrl);
                          if (!ok) setError(t('common.copyFailed'));
                        }}
                        className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold flex items-center gap-2"
                      >
                        <Copy size={16} /> {t('common.link')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!teacherSessionId && !sessionClosed && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                  <p className="flex-1 min-w-[12rem] text-sm text-blue-900/80">
                    {t('test.startLiveSessionHint')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleStartLiveSession()}
                    disabled={startingSession}
                    className="px-4 py-2 rounded-xl font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 shrink-0"
                  >
                    {startingSession ? (
                      <Loader2 size={16} className="inline mr-1 animate-spin" />
                    ) : (
                      <Users size={16} className="inline mr-1" />
                    )}
                    {t('test.startLiveSession')}
                  </button>
                </div>
              )}

              {(joinUrl || teacherSessionId) && (
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleToggleResultsView}
                    className={`px-4 py-2 rounded-xl font-semibold ${!showAnalysis ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    {!showAnalysis ? (
                      <Brain size={16} className="inline mr-1" />
                    ) : (
                      <Users size={16} className="inline mr-1" />
                    )}
                    {!showAnalysis ? t('test.viewAnalysis') : t('test.viewResults')}
                  </button>
                  {!sessionClosed && (
                    <button
                      type="button"
                      onClick={() => void handleFinalizeSession()}
                      disabled={finalizing}
                      className="px-4 py-2 rounded-xl font-semibold bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {finalizing ? <Loader2 size={16} className="inline mr-1 animate-spin" /> : <Lock size={16} className="inline mr-1" />}
                      {t('test.finalizeSession')}
                    </button>
                  )}
                </div>
              )}
            </StaffPanel>

            {!showAnalysis ? (
              <StaffPanel className="overflow-hidden">
                <div className="px-4 py-3 border-b border-black/5 bg-black/[0.02] flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button type="button" onClick={handleBackToQuestions} className={staffBtnGhost}>
                      <ArrowLeft size={16} />
                      {t('test.backToQuestions')}
                    </button>
                    <span className={`text-[14px] font-bold ${STAFF_HEADING}`}>
                      {t('test.resultsTitle')} ({submissions.length})
                    </span>
                  </div>
                  {sessionClosed && (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                      {t('test.sessionFinalized')}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-black/45 border-b border-black/5">
                        <th className="px-4 py-3">{t('test.studentColumn')}</th>
                        <th className="px-4 py-3">{t('test.scoreColumn')}</th>
                        <th className="px-4 py-3">{t('test.gradeColumn')}</th>
                        <th className="px-4 py-3">{t('test.timeColumn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s, idx) => {
                        const score = calculateScore(s.answers, testSession.questions);
                        const total = testSession.questions.length;
                        const grade = scoreToGrade(score, total);
                        return (
                        <tr key={idx} className="border-b border-black/5 last:border-b-0">
                          <td className="px-4 py-3 font-semibold text-[#083047]">{s.firstName} {s.lastName}</td>
                          <td className="px-4 py-3 font-semibold tabular-nums text-[#083047]/85">
                            {score} / {total}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center justify-center min-w-[2rem] px-2.5 py-1 rounded-lg border text-sm font-bold ${gradeBadgeClass(grade)}`}>
                              {grade}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-black/45 tabular-nums">
                            {new Date(s.submittedAt).toLocaleString(locale)}
                          </td>
                        </tr>
                        );
                      })}
                      {submissions.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-black/40">
                            {t('test.noSubmissionsRow')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </StaffPanel>
            ) : (
              <div className="space-y-6">
                {enriching && (
                  <div className="flex items-center gap-2.5 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-[13px] text-blue-900">
                    <Loader2 size={16} className="animate-spin shrink-0" />
                    <span>{t('test.enriching')}</span>
                  </div>
                )}
                {/* Kartochka Keys/Ma'ruza bo'limlari bilan bir xil `StaffPanel` —
                    ilgari bu yerda o'ziga xos oq `rounded-3xl` kartochkalar bo'lib,
                    Test bo'limi boshqa ilovadek ko'rinardi. */}
                {displayedTest.questions.map((q, i) => (
                  <StaffPanel key={i} large className="p-5 sm:p-7 space-y-5">
                    <div className="flex items-start gap-4">
                      <div className={staffIndexBadge}>{i + 1}</div>
                      <p className={staffQuestionText}>{q.question}</p>
                    </div>
                    <div className="space-y-2">
                      {q.options.map((option, optIdx) => {
                        const optionExplanation = q.optionExplanations?.[optIdx]?.trim();
                        const isCorrect = optIdx === q.correctOptionIndex;
                        return (
                          <div
                            key={optIdx}
                            className={isCorrect ? staffOptionCorrect : staffOptionNeutral}
                          >
                            <div className="text-[14px] leading-relaxed">
                              <span className="font-bold">{String.fromCharCode(65 + optIdx)})</span>{' '}
                              {stripOptionLetterPrefix(option, optIdx)}
                              {isCorrect && (
                                <span className="ml-2 inline-flex items-center text-[11px] font-bold uppercase tracking-wide">
                                  <CheckCircle2 size={14} className="mr-1" /> {t('test.correctAnswer')}
                                </span>
                              )}
                            </div>
                            {optionExplanation && (
                              <p className="mt-1.5 text-[13px] leading-relaxed opacity-75">
                                {optionExplanation}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className={staffExplainBox}>
                      <h4 className={staffExplainTitle}>
                        <Brain size={14} className="shrink-0" /> {t('test.correctAnalysis')}
                      </h4>
                      <p className={staffExplainBody}>{q.explanation}</p>
                      {q.references && q.references.length > 0 && (
                        <MedicalReferencesList
                          references={q.references}
                          title={t('test.questionReferences')}
                          compact
                          className="bg-white/60"
                        />
                      )}
                    </div>
                  </StaffPanel>
                ))}
                {displayedTest.references && displayedTest.references.length > 0 && (
                  <MedicalReferencesList references={displayedTest.references} />
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-3 pt-2">
              {sessionClosed ? (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={loading}
                  className="px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  {t('test.createNewAfterClose')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={loading}
                  className="px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  {t('test.createAnother')}
                </button>
              )}
            </div>
          </motion.div>
        )}
    </StaffPageLayout>
  );
}
