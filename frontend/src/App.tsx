/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, createContext, useContext, useRef } from 'react';
import { 
  LayoutDashboard, 
  Presentation, 
  Menu, 
  X,
  Bell,
  UserCircle,
  BriefcaseMedical,
  LogOut,
  BookOpen,
  ClipboardList,
  FileText,
  Users,
  MapPin,
  Building2,
  Files,
  Library,
  BookMarked,
  Bug,
  GraduationCap,
  Youtube,
  Monitor,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  getCurrentLocalUser,
  logoutLocalStaff,
  subscribeLocalAuth,
  touchCurrentUserActivityIfNeeded,
  normalizeUserRole,
  type LocalStaffUser,
  type UserRole,
} from './utils/localStaffAuth';
import { clearBackendAuthTokens, getBackendAccessToken, setUnauthorizedHandler, syncSessionRoleFromServer, syncStaffPhotoFromServer } from './utils/backendAuth';
import { clearSyllabusRowCache } from './utils/syllabusRowCache';
import { resolveProfilePhotoUrl } from './utils/profilePhotoApi';
import {
  type AppLanguage,
  getAppLanguage,
  localeForLanguage,
  setAppLanguage as persistAppLanguage,
  languageLabel,
} from './i18n/language';
import { navLabel, navMobileLabel, roleLabel, translate, type UiTextKey } from './i18n/translations';
import { type AppNotificationEventDetail } from './utils/notifications';
import AppToastHost from './components/AppToastHost';
import { isPublicStudentTestUrl } from './utils/liveTestApi';
import { useActivityTelemetry } from './hooks/useActivityTelemetry';
import { postActivityEvents } from './utils/analyticsApi';

// Components
import DesktopHodimQrLogin from './components/auth/DesktopHodimQrLogin';
import HodimMobileCompanion from './components/staff/HodimMobileCompanion';
import { isDesktopBrowser } from './utils/deviceDetection';
import { useDeviceProfile } from './hooks/useDeviceProfile';
import {
  clearDesktopPairedSession,
  isDesktopPairedSession,
  shouldHodimUseMobileCompanion,
} from './utils/deviceSession';
import PresentationBuilder from './components/PresentationBuilder';
import CaseStudies from './components/CaseStudies';
import UserProfile from './components/UserProfile';
import SyllabusView from './components/SyllabusView';
import StaffTeachingSubjectsPicker from './components/staff/StaffTeachingSubjectsPicker';
import { fetchMyCourseSelections } from './utils/syllabusApi';
import TestQuestions from './components/TestQuestions';
import StudentMyTests from './components/StudentMyTests';
import LectureNotes from './components/LectureNotes';
import TopicVideos from './components/TopicVideos';
import HandoutMaterials from './components/HandoutMaterials';
import AdminDashboardHome from './components/admin/AdminDashboardHome';
import AdminStaffManagement from './components/admin/AdminStaffManagement';
import AdminCasesLibrary from './components/admin/AdminCasesLibrary';
import AdminTestsLibrary from './components/admin/AdminTestsLibrary';
import AdminLiveTestResultsPage from './components/admin/AdminLiveTestResultsPage';
import AdminStaffLocationConsole from './components/admin/AdminStaffLocationConsole';
import AdminLiveTeachingBoard from './components/admin/AdminLiveTeachingBoard';
import AdminCampusBuildingsPage from './components/admin/AdminCampusBuildingsPage';
import AdminSyllabusCatalog from './components/admin/AdminSyllabusCatalog';
import AdminOnlineEdu from './components/admin/AdminOnlineEdu';
import AdminCourseAssignments from './components/admin/AdminCourseAssignments';
import AdminTopicVideos from './components/admin/AdminTopicVideos';
import AdminTopicHandouts from './components/admin/AdminTopicHandouts';
import AdminBooksLibrary from './components/admin/AdminBooksLibrary';
import AdminClientErrors from './components/admin/AdminClientErrors';
import TeacherSettings from './components/settings/TeacherSettings';
import HodimGpsPromptBar from './components/staff/HodimGpsPromptBar';
import PublicLandingPage from './components/public/PublicLandingPage';
import MobileAuthScreen from './components/auth/MobileAuthScreen';
import { useStaffLocationTracking } from './hooks/useStaffLocationTracking';
import type { SyllabusTopic } from './services/aiService';
import {
  loadPersistedSelectedTopic,
  persistSelectedTopic,
  resolveTopicNorm,
  type SyllabusTopicContext,
} from './utils/syllabusTopicContext';
import { readLectureForTopic, writeLectureForTopic } from './utils/lectureLocalCache';

export type { SyllabusTopic };

type View =
  | 'admin-dashboard'
  | 'admin-staff'
  | 'admin-staff-location'
  | 'admin-live-teaching'
  | 'admin-campus-buildings'
  | 'admin-cases'
  | 'admin-tests'
  | 'admin-live-test-results'
  | 'admin-syllabuses'
  | 'admin-course-assignments'
  | 'admin-online-edu'
  | 'admin-videos'
  | 'admin-handouts'
  | 'admin-books'
  | 'admin-client-errors'
  | 'syllabus'
  | 'profile'
  | 'presentation'
  | 'videos'
  | 'handouts'
  | 'cases'
  | 'tests'
  | 'lectures'
  | 'content-catalog'
  | 'my-tests';

type NavItemDef = { id: View; label: string; icon: LucideIcon };

const NAV_ICONS: Record<View, LucideIcon> = {
  'admin-dashboard': LayoutDashboard,
  'admin-staff': Users,
  'admin-staff-location': MapPin,
  'admin-live-teaching': Monitor,
  'admin-campus-buildings': Building2,
  'admin-cases': BriefcaseMedical,
  'admin-tests': ClipboardList,
  'admin-live-test-results': Users,
  'admin-syllabuses': BookOpen,
  'admin-course-assignments': GraduationCap,
  'admin-online-edu': Monitor,
  'admin-videos': Youtube,
  'admin-handouts': Files,
  'admin-books': BookMarked,
  'admin-client-errors': Bug,
  syllabus: BookOpen,
  lectures: FileText,
  presentation: Presentation,
  videos: Youtube,
  handouts: Files,
  'content-catalog': Library,
  cases: BriefcaseMedical,
  tests: ClipboardList,
  profile: UserCircle,
  'my-tests': ClipboardList,
};

const HODIM_NAV_IDS: View[] = [
  'syllabus',
  'lectures',
  'presentation',
  'videos',
  'handouts',
  'cases',
  'tests',
  'profile',
];
const ADMIN_NAV_IDS: View[] = [
  'admin-dashboard',
  'admin-staff',
  'admin-staff-location',
  'admin-live-teaching',
  'admin-campus-buildings',
  'admin-syllabuses',
  'admin-course-assignments',
  'admin-online-edu',
  'admin-videos',
  'admin-handouts',
  'admin-books',
  'admin-cases',
  'admin-tests',
  'admin-live-test-results',
  'admin-client-errors',
  'profile',
];
const STUDENT_NAV_IDS: View[] = ['my-tests', 'profile'];

function navItemsForRole(role: UserRole, lang: AppLanguage): NavItemDef[] {
  const ids =
    role === 'admin' ? ADMIN_NAV_IDS : role === 'student' ? STUDENT_NAV_IDS : HODIM_NAV_IDS;
  return ids.map((id) => ({ id, label: navLabel(lang, id), icon: NAV_ICONS[id] }));
}

/**
 * Bo'lim ranglari.
 *
 * Har bo'lim o'z rangiga ega: yon menyudagi belgi ham, sahifa sarlavhasi
 * ham bir xil rangda. O'qituvchi qayerdaligini rangdan biladi — sarlavhani
 * o'qimay turib ham. Ilgari hammasi bir xil ko'k edi.
 */
export const VIEW_ACCENTS: Record<string, { tile: string; on: string; row: string; bar: string }> = {
  syllabus: {
    tile: 'bg-indigo-50 text-indigo-600',
    on: 'bg-indigo-600 text-white',
    row: 'bg-indigo-50/70 text-indigo-900',
    bar: 'bg-indigo-600',
  },
  lectures: {
    tile: 'bg-blue-50 text-blue-600',
    on: 'bg-blue-600 text-white',
    row: 'bg-blue-50/70 text-blue-900',
    bar: 'bg-blue-600',
  },
  presentation: {
    tile: 'bg-amber-50 text-amber-600',
    on: 'bg-amber-500 text-white',
    row: 'bg-amber-50/70 text-amber-900',
    bar: 'bg-amber-500',
  },
  videos: {
    tile: 'bg-rose-50 text-rose-600',
    on: 'bg-rose-500 text-white',
    row: 'bg-rose-50/70 text-rose-900',
    bar: 'bg-rose-500',
  },
  handouts: {
    tile: 'bg-teal-50 text-teal-600',
    on: 'bg-teal-600 text-white',
    row: 'bg-teal-50/70 text-teal-900',
    bar: 'bg-teal-600',
  },
  cases: {
    tile: 'bg-violet-50 text-violet-600',
    on: 'bg-violet-600 text-white',
    row: 'bg-violet-50/70 text-violet-900',
    bar: 'bg-violet-600',
  },
  tests: {
    tile: 'bg-emerald-50 text-emerald-600',
    on: 'bg-emerald-600 text-white',
    row: 'bg-emerald-50/70 text-emerald-900',
    bar: 'bg-emerald-600',
  },
  profile: {
    tile: 'bg-slate-100 text-slate-600',
    on: 'bg-slate-700 text-white',
    row: 'bg-slate-100 text-slate-900',
    bar: 'bg-slate-700',
  },
};

const DEFAULT_ACCENT = VIEW_ACCENTS.profile;

export function accentFor(view: string) {
  return VIEW_ACCENTS[view] || DEFAULT_ACCENT;
}

export const GlobalTopicContext = createContext<SyllabusTopicContext | null>(null);

/** Mavzu bilan ishlaydigan bo'limlar — mavzu tanlangach shulardan biriga qaytiladi. */
const TOPIC_MODULE_VIEWS = new Set<View>(['lectures', 'presentation', 'videos', 'handouts', 'cases', 'tests']);

export const AppNavigationContext = createContext<{
  openSyllabus: () => void;
}>({
  openSyllabus: () => {},
});
export const GlobalLectureContext = createContext<{content: string, setContent: (c: string) => void}>({content: '', setContent: () => {}});
export const AppLanguageContext = createContext<{
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
}>({
  language: 'uz',
  setLanguage: () => {},
});

type AppNotification = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  level?: 'info' | 'success' | 'warning' | 'error';
  /** Tarjima kalitlari — bo'lsa, tarix JORIY tilda ko'rsatiladi. */
  titleKey?: UiTextKey;
  bodyKey?: UiTextKey;
};

const NOTIFICATIONS_STORAGE_KEY = 'imentor-notifications-v1';
const ACTIVE_VIEW_STORAGE_KEY = 'imentor-active-view-v1';

function loadPersistedActiveView(): View | null {
  try {
    const raw = localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
    // Admin hisobotlari (Super AI, Faollik) olib tashlangan — ular eslab qolingan
    // bo'lsa bosh sahifa ochiladi. Hisobotlar faqat imentor.uz/rektor da.
    if (raw === 'admin-super-ai-report' || raw === 'admin-activity') return 'admin-dashboard';
    return (raw as View) || null;
  } catch {
    return null;
  }
}

function persistActiveView(view: View): void {
  try {
    localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, view);
  } catch {
    /* quota */
  }
}

function readStoredNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const { isMobile: isMobileDevice } = useDeviceProfile();
  const [activeView, setActiveViewState] = useState<View>(() => loadPersistedActiveView() ?? 'syllabus');
  const setActiveView = useCallback((next: View | ((current: View) => View)) => {
    setActiveViewState((current) => {
      const resolved = typeof next === 'function' ? (next as (current: View) => View)(current) : next;
      persistActiveView(resolved);
      return resolved;
    });
  }, []);
  const [mountedViews, setMountedViews] = useState<View[]>([]);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<LocalStaffUser | null>(() => getCurrentLocalUser());
  /** Kompyuterda login modal holati: 'qr' — standart (yuz skaneri faqat telefonda),
   * 'qr' — telefon orqali QR, 'password' — login (telefon / Xodim ID) va parol. */
  const [desktopAuthView, setDesktopAuthView] = useState<'face' | 'qr' | 'password'>('qr');
  /** null = tekshirilmoqda; false = birinchi kirish fan tanlash; true = tayyor */
  const [teachingSubjectsReady, setTeachingSubjectsReady] = useState<boolean | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<SyllabusTopicContext | null>(() =>
    loadPersistedSelectedTopic(),
  );
  const [latestLectureContent, setLatestLectureContent] = useState('');
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());
  const [notifications, setNotifications] = useState<AppNotification[]>(readStoredNotifications);
  const [isNotificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsPanelRef = useRef<HTMLDivElement | null>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearBackendAuthTokens();
      clearDesktopPairedSession(user?.uid);
      logoutLocalStaff();
      clearSyllabusRowCache();
      // Interfeys tili ATAYLAB tiklanmaydi: u qurilma sozlamasi (localStorage),
      // hisobga bog'liq emas. Rus/ingliz tilida ishlaydigan o'qituvchi
      // sessiyasi tugaganda login sahifasini o'zbekchada ko'rmasligi kerak.
    });
    return () => setUnauthorizedHandler(null);
  }, [user?.uid]);

  const setLectureContent = useCallback((c: string) => {
    setLatestLectureContent(c);
    const topicNorm = resolveTopicNorm(selectedTopic);
    if (topicNorm) writeLectureForTopic(topicNorm, c);
  }, [selectedTopic]);

  const lectureContextValue = useMemo(
    () => ({ content: latestLectureContent, setContent: setLectureContent }),
    [latestLectureContent, setLectureContent],
  );

  useEffect(() => {
    const topicNorm = resolveTopicNorm(selectedTopic);
    setLatestLectureContent(topicNorm ? readLectureForTopic(topicNorm) : '');
  }, [selectedTopic]);

  const addNotification = useCallback((detail: AppNotificationEventDetail) => {
    const next: AppNotification = {
      id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: detail.title,
      body: detail.body,
      createdAt: Date.now(),
      read: false,
      level: detail.level ?? 'info',
      ...(detail.titleKey ? { titleKey: detail.titleKey } : {}),
      ...(detail.bodyKey ? { bodyKey: detail.bodyKey } : {}),
    };
    setNotifications((prev) => [next, ...prev].slice(0, 80));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  useEffect(() => {
    persistAppLanguage(language);
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
    } catch {
      /* ignore quota */
    }
  }, [notifications]);

  useEffect(() => {
    const onNotify = (event: Event) => {
      const custom = event as CustomEvent<AppNotificationEventDetail>;
      const detail = custom.detail;
      if (!detail?.title || !detail?.body) return;
      addNotification(detail);
    };
    window.addEventListener('app:notify', onNotify as EventListener);
    return () => window.removeEventListener('app:notify', onNotify as EventListener);
  }, [addNotification]);

  useEffect(() => {
    if (!isNotificationsOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        notificationsPanelRef.current?.contains(target) ||
        notificationsButtonRef.current?.contains(target)
      ) {
        return;
      }
      setNotificationsOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isNotificationsOpen]);

  useEffect(() => {
    const unsub = subscribeLocalAuth(() => {
      const u = getCurrentLocalUser();
      setUser(u);
    });
    return () => unsub();
  }, []);


  useEffect(() => {
    if (!user) return;
    addNotification({
      title: translate(language, 'shell.welcomeTitle'),
      // Ism ichida bo'lgani uchun kalit bilan qayta tarjima qilinmaydi.
      body: translate(language, 'shell.welcomeBody', {
        name: user.displayName || translate(language, 'shell.staffDefaultName'),
      }),
      titleKey: 'shell.welcomeTitle',
      level: 'success',
    });
  }, [user?.uid, user?.displayName, addNotification]);

  /** Kirishdan keyin JWT ni yangilash, server roli va profil rasmini sinxronlash */
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const role = await syncSessionRoleFromServer();
      if (!role) return;
      await syncStaffPhotoFromServer();
    })();
  }, [user?.uid]);

  /** Sessiya bilan kirganda va oynaga qaytishda oxirgi faollik vaqtini yangilash */
  useEffect(() => {
    if (!user) return;
    touchCurrentUserActivityIfNeeded();
    const onFocus = () => {
      touchCurrentUserActivityIfNeeded();
      void syncStaffPhotoFromServer();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        touchCurrentUserActivityIfNeeded();
        void syncStaffPhotoFromServer();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.uid]);

  const userRole = user ? normalizeUserRole(user) : null;
  useActivityTelemetry(!!user && !!userRole, activeView);

  const handleLogout = async () => {
    if (user && userRole) {
      await postActivityEvents([{ event_type: 'logout' }], activeView).catch(() => undefined);
    }
    clearBackendAuthTokens();
    clearDesktopPairedSession(user?.uid);
    logoutLocalStaff();
    clearSyllabusRowCache();
    // Tanlangan interfeys tili saqlanib qoladi (qurilma sozlamasi).
  };

  /**
   * Ish boshlanganda menyu o'zi yig'iladi.
   *
   * "Mening fanlarim" — tanlash sahifasi, u yerda keng menyu qulay.
   * Qolganlari ish maydoni: ma'ruza matni, taqdimot, test. Bo'lim
   * almashganda menyu yig'ilib, 188 piksel ishga qo'shiladi.
   *
   * Faqat ALMASHISHGA javob beradi — foydalanuvchi keyin qo'lda ochsa,
   * menyu shu bo'limda ochiq qoladi.
   */
  const lastViewRef = useRef<View | null>(null);
  useEffect(() => {
    if (lastViewRef.current === activeView) return;
    const previous = lastViewRef.current;
    lastViewRef.current = activeView;
    if (previous === null) return;
    setSidebarOpen(activeView === 'syllabus');
  }, [activeView]);

  const navItems = useMemo(
    () => (userRole ? navItemsForRole(userRole, language) : []),
    [userRole, language],
  );

  useEffect(() => {
    if (!user || userRole !== 'hodim') {
      setTeachingSubjectsReady(true);
      return;
    }
    let cancelled = false;
    setTeachingSubjectsReady(null);
    // Fan tanlash MAJBURIY EMAS: ro'yxat bo'sh bo'lsa ham o'qituvchi
    // tizimga kiradi va "Mening fanlarim"da katalogdan tanlaydi yoki bu
    // yilgi mavzularini Excel'dan o'zi yuklaydi. Ilgari fan tanlanmaguncha
    // yopilmaydigan oyna chiqardi.
    void fetchMyCourseSelections()
      .then((rows) => {
        // Brauzerda saqlangan mavzu endi o'qituvchining ro'yxatida bo'lmagan
        // fanga tegishli bo'lsa (fan o'chirilgan yoki boshqa qurilmada
        // ro'yxatdan olingan) — tanlov tozalanadi. Aks holda Ma'ruza/Test
        // sahifalari ko'rinmas fanga yozishda davom etardi.
        if (cancelled) return;
        setSelectedTopic((prev) => {
          if (!prev || rows.some((r) => r.syllabus.id === prev.syllabusId)) return prev;
          persistSelectedTopic(null);
          return null;
        });
      })
      .catch(() => [])
      .finally(() => {
        if (!cancelled) setTeachingSubjectsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, userRole]);

  /** Hodim GPS faqat HodimMobileCompanion ichida (telefon) */
  useStaffLocationTracking(false);

  useEffect(() => {
    if (!user || !userRole) return;
    const allowed = navItemsForRole(userRole, language).map((i) => i.id);
    const params = new URLSearchParams(window.location.search);
    const viewParam = (params.get('view') || '').trim() as View;
    setActiveView((current) => {
      if (viewParam && allowed.includes(viewParam)) return viewParam;
      return allowed.includes(current) ? current : allowed[0];
    });
  }, [user?.uid, user?.role, userRole, language]);

  useEffect(() => {
    if (!user || !userRole) return;
    const allowed = new Set(navItemsForRole(userRole, language).map((i) => i.id));
    setMountedViews((prev) => {
      const filtered = prev.filter((v) => allowed.has(v));
      if (allowed.has(activeView) && !filtered.includes(activeView)) filtered.push(activeView);
      if (filtered.length === 0) filtered.push(navItemsForRole(userRole, language)[0].id);
      return filtered;
    });
  }, [activeView, user?.uid, userRole, language]);

  const openSyllabus = useCallback(() => {
    setActiveView('syllabus');
  }, []);

  const handleSelectTopic = (topic: SyllabusTopicContext) => {
    setSelectedTopic(topic);
    persistSelectedTopic(topic);
    addNotification({
      title: translate(language, 'shell.topicSelectedTitle'),
      // Mavzu nomi ichida — kalit bilan qayta tarjima qilinmaydi.
      body: translate(language, 'shell.topicSelectedBody', {
        subject: topic.subjectName,
        id: topic.id,
        title: topic.title,
      }),
      titleKey: 'shell.topicSelectedTitle',
    });
  };

  const handleClearTopic = useCallback(() => {
    setSelectedTopic(null);
    persistSelectedTopic(null);
  }, []);

  // O'qituvchi oxirgi ishlagan bo'lim (ma'ruza, taqdimot, test, keys...). "Mening fanlarim"da mavzu
  // bosilganda shu bo'limga qaytadi: testdan mavzu almashtirgan o'qituvchi yana testga tushadi.
  const lastModuleRef = useRef<View>('lectures');
  useEffect(() => {
    if (TOPIC_MODULE_VIEWS.has(activeView)) lastModuleRef.current = activeView;
  }, [activeView]);

  const handleOpenLectures = (topic: SyllabusTopicContext) => {
    setSelectedTopic(topic);
    persistSelectedTopic(topic);
    setActiveView(lastModuleRef.current);
  };

  const renderContent = (view: View) => {
    switch (view) {
      case 'admin-dashboard':
        return <AdminDashboardHome />;
      case 'admin-staff':
        return <AdminStaffManagement />;
      case 'admin-staff-location':
        return <AdminStaffLocationConsole />;
      case 'admin-live-teaching':
        return <AdminLiveTeachingBoard />;
      case 'admin-campus-buildings':
        return <AdminCampusBuildingsPage />;
      case 'admin-cases':
        return <AdminCasesLibrary />;
      case 'admin-tests':
        return <AdminTestsLibrary />;
      case 'admin-live-test-results':
        return <AdminLiveTestResultsPage />;
      case 'admin-syllabuses':
        return <AdminSyllabusCatalog />;
      case 'admin-online-edu':
        return <AdminOnlineEdu />;
      case 'admin-course-assignments':
        return <AdminCourseAssignments />;
      case 'admin-videos':
        return <AdminTopicVideos />;
      case 'admin-handouts':
        return <AdminTopicHandouts />;
      case 'admin-books':
        return <AdminBooksLibrary />;
      case 'admin-client-errors':
        return <AdminClientErrors />;
      case 'syllabus':
        return (
          <SyllabusView
            userRole={userRole}
            selectedTopic={selectedTopic}
            onSelectTopic={handleSelectTopic}
            onClearTopic={handleClearTopic}
            onOpenLectures={handleOpenLectures}
          />
        );
      case 'lectures':
        return <LectureNotes />;
      case 'profile':
        // O'qituvchi uchun — to'liq sozlamalar (profil, fanlar, kafedra kutubxonasi, monitor jadvali, kirish).
        return userRole === 'hodim' ? <TeacherSettings /> : <UserProfile />;
      case 'presentation':
        return <PresentationBuilder />;
      case 'videos':
        return <TopicVideos />;
      case 'handouts':
        return <HandoutMaterials />;
      case 'cases':
        return <CaseStudies />;
      case 'tests':
        return <TestQuestions />;
      case 'my-tests':
        return <StudentMyTests />;
      default:
        return (
          <SyllabusView
            userRole={userRole}
            selectedTopic={selectedTopic}
            onSelectTopic={handleSelectTopic}
            onClearTopic={handleClearTopic}
            onOpenLectures={handleOpenLectures}
          />
        );
    }
  };

  const platformCredit = (
    <div className="w-full px-0 pb-0 print:hidden">
      <div className="w-full border-t border-white/70 bg-white/80 backdrop-blur-md shadow-[0_-6px_24px_rgba(0,0,0,0.05)]">
        <div className="mx-auto w-full max-w-[1600px] px-3 py-1.5 overflow-x-auto scrollbar-hide">
          <div className="flex flex-nowrap items-center justify-center gap-x-3 text-[9px] md:text-[10px] leading-tight text-black/65 whitespace-nowrap min-w-max mx-auto">
            <span className="font-medium">{translate(language, 'footer.copyright')}</span>
            <a
              href="https://fjsti.uz"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-700 hover:text-blue-600 underline decoration-blue-300"
            >
              {translate(language, 'footer.developer')}
            </a>
            <a
              href="https://fjsti.uz"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-700 hover:text-emerald-600 underline decoration-emerald-300"
            >
              {translate(language, 'footer.supporter')}
            </a>
            <span className="font-medium text-violet-700">{translate(language, 'footer.patent')}</span>
            <span className="font-medium text-slate-700">{translate(language, 'footer.license')}</span>
            <span className="font-medium text-cyan-700">{translate(language, 'footer.certified')}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AppLanguageContext.Provider value={{ language, setLanguage }}>
      {/* Global alertlar — yuqori o'ng burchak, 20 soniyada o'zi yo'qoladi.
          Talaba QR rejimida ham ko'rinsin, shuning uchun eng tashqarida. */}
      <AppToastHost />
      {/* Student QR: always fullscreen test only (no shell), even if staff session exists */}
      {isPublicStudentTestUrl() ? (
        <GlobalTopicContext.Provider value={null}>
          <GlobalLectureContext.Provider value={{ content: '', setContent: () => {} }}>
            <div className="min-h-[100dvh] h-[100dvh] w-full overflow-auto bg-[#f2f2f7]">
              <TestQuestions />
            </div>
          </GlobalLectureContext.Provider>
        </GlobalTopicContext.Provider>
      ) : (
      <GlobalTopicContext.Provider value={selectedTopic}>
      <AppNavigationContext.Provider value={{ openSyllabus }}>
      <GlobalLectureContext.Provider value={lectureContextValue}>
      {!user && isMobileDevice ? (
        // Telefonda landing kerak emas — darhol kirish sahifasi.
        <MobileAuthScreen />
      ) : !user ? (
        <PublicLandingPage
          language={language}
          setLanguage={setLanguage}
          isMobileDevice={isMobileDevice}
          desktopAuthView={desktopAuthView}
          setDesktopAuthView={setDesktopAuthView}
        />
      ) : shouldHodimUseMobileCompanion(user, isMobileDevice) ? (
        <HodimMobileCompanion />
      ) : (
      <>
      <div className="flex flex-col h-[100dvh] min-h-0 w-full relative overflow-hidden bg-[#f4f6fa] text-[#1c1c1e] selection:bg-blue-500/20">
      
      {/* Tepada zaif iliqlik — mazmunni bosmaydi, chuqurlik beradi. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[280px] bg-gradient-to-b from-[#e8eef9] to-transparent" />

      {/* Main Layout Container */}
      <div className="relative z-10 flex w-full flex-1 min-h-0 p-1.5 sm:p-2 lg:p-3 gap-1.5 sm:gap-2">
        
        {/* Floating Sidebar — desktop / tablet only */}
        <motion.aside
          initial={false}
          animate={{ width: isSidebarOpen ? 264 : 76 }}
          transition={{ type: 'spring', stiffness: 700, damping: 42, mass: 0.6 }}
          className="relative z-50 hidden shrink-0 overflow-hidden rounded-[26px] border border-black/[0.06] bg-white pb-3 shadow-[0_1px_2px_rgba(8,48,71,0.04),0_16px_44px_-20px_rgba(8,48,71,0.20)] md:flex md:flex-col print:hidden"
        >
          <div
            className={`flex items-center gap-2 px-3 pb-3.5 pt-4 ${
              isSidebarOpen ? 'justify-between' : 'flex-col justify-center gap-2.5'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src="/imentor-logo.png"
                alt="iMentor"
                className="h-10 w-10 shrink-0 rounded-xl border border-black/[0.06] object-cover"
              />
              {/* Nom yig'ilganda yo'qoladi — kesilib emas, yumshoq so'nib. */}
              <AnimatePresence initial={false}>
                {isSidebarOpen && (
                  <motion.div
                    key="brand"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.12 }}
                    className="flex min-w-0 flex-col leading-tight"
                  >
                    <span className="truncate text-[15.5px] font-bold tracking-tight text-[#083047]">
                      iMentor
                    </span>
                    <span className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-black/30">
                      Platform
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <motion.button
              onClick={() => setSidebarOpen(!isSidebarOpen)}
              aria-label={translate(language, 'shell.mainMenu')}
              aria-expanded={isSidebarOpen}
              animate={
                isSidebarOpen
                  ? { scale: 1, backgroundColor: 'rgba(0,0,0,0)' }
                  : { scale: [1, 1.07, 1], backgroundColor: 'rgba(37,99,235,0.08)' }
              }
              transition={
                isSidebarOpen
                  ? { duration: 0.15 }
                  : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
              }
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.94 }}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                isSidebarOpen
                  ? 'text-black/40 hover:bg-slate-100 hover:text-black/70'
                  : 'text-blue-600 hover:bg-blue-100'
              }`}
            >
              {isSidebarOpen ? <X size={19} /> : <Menu size={19} />}
            </motion.button>
          </div>

          <AnimatePresence initial={false}>
            {isSidebarOpen && (
              <motion.div
                key="menu-label"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.12 }}
                className="overflow-hidden px-5 pb-1.5"
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/25">
                  {translate(language, 'shell.mainMenu')}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <nav className="scrollbar-hide flex-1 space-y-1 overflow-y-auto px-2.5 py-1">
            {navItems.map((item) => {
              const on = activeView === item.id;
              const accent = accentFor(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id as View)}
                  aria-current={on ? 'page' : undefined}
                  title={!isSidebarOpen ? item.label : undefined}
                  className={`group relative flex w-full items-center gap-3 rounded-2xl py-2.5 text-[14px] transition-colors ${
                    isSidebarOpen ? 'px-2.5' : 'justify-center px-0'
                  } ${
                    on ? `${accent.row} font-semibold` : 'font-medium text-black/60 hover:bg-slate-50'
                  }`}
                >
                  {/* Tanlov ko'rsatkichi bo'limlar orasida SILJIYDI. */}
                  {on && (
                    <motion.span
                      layoutId="nav-active"
                      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                      className={`absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full ${accent.bar}`}
                    />
                  )}
                  <span
                    className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 group-hover:scale-105 ${
                      on ? accent.on : accent.tile
                    }`}
                  >
                    <item.icon size={18} strokeWidth={on ? 2.3 : 2} />
                  </span>
                  <AnimatePresence initial={false}>
                    {isSidebarOpen && (
                      <motion.span
                        key="label"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.1 }}
                        className="relative truncate"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto px-2.5 pt-2">
            <div className="mx-2 mb-2 h-px bg-black/[0.06]" />
            <button
              onClick={handleLogout}
              title={!isSidebarOpen ? translate(language, 'shell.logout') : undefined}
              className={`group flex w-full items-center gap-3 rounded-2xl py-2.5 text-[14px] font-medium text-rose-600 transition hover:bg-rose-50 ${
                isSidebarOpen ? 'px-2.5' : 'justify-center px-0'
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500 transition-all duration-200 group-hover:scale-105">
                <LogOut size={18} strokeWidth={2} />
              </span>
              <AnimatePresence initial={false}>
                {isSidebarOpen && (
                  <motion.span
                    key="logout-label"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                    className="truncate"
                  >
                    {translate(language, 'shell.logout')}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </motion.aside>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col gap-2 sm:gap-4 overflow-hidden relative min-w-0 min-h-0">
          {/* Header */}
          <header className="z-40 flex h-14 shrink-0 items-center justify-between gap-2 rounded-2xl border border-black/[0.06] bg-white px-3 shadow-[0_1px_2px_rgba(8,48,71,0.04)] print:hidden sm:h-16 sm:px-5">
            <div className="flex items-center min-w-0 flex-1">
              <div className="flex-col space-y-0.5 min-w-0">
                <h1 className="truncate text-[14px] font-bold tracking-tight text-[#083047] sm:text-[15.5px]">
                  {translate(language, 'shell.platformTitle')}
                </h1>
                <p className="hidden truncate text-[11.5px] font-medium text-black/40 sm:block">
                  {userRole === 'admin'
                    ? translate(language, 'shell.platformSubtitle.admin')
                    : translate(language, 'shell.platformSubtitle.default')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as AppLanguage)}
                className="h-9 max-w-[6.5rem] rounded-xl border border-black/[0.08] bg-white px-2 text-[12px] font-semibold text-black/65 outline-none transition focus:border-blue-400 sm:h-10 sm:max-w-none sm:px-3"
                aria-label={translate(language, 'shell.languageAria')}
              >
                <option value="uz">{languageLabel('uz')}</option>
                <option value="ru">{languageLabel('ru')}</option>
                <option value="en">{languageLabel('en')}</option>
              </select>
              <button
                ref={notificationsButtonRef}
                onClick={() => setNotificationsOpen((v) => !v)}
                className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/45 transition hover:bg-slate-50 hover:text-black/70 sm:h-10 sm:w-10"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-rose-500 rounded-full border border-white text-[10px] leading-5 text-white font-bold text-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              <div className="w-px h-8 bg-black/10"></div>
              <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setActiveView('profile')}>
                <div className="flex-col items-end hidden md:flex">
                  <span className="text-[14px] font-semibold text-black/80 group-hover:text-blue-600 transition-colors">
                    {user.displayName || translate(language, 'shell.staffDefaultName')}
                  </span>
                  <span className="text-[11px] text-black/40 font-medium mt-0.5">
                    {userRole ? roleLabel(language, userRole) : ''}
                  </span>
                </div>
                <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-blue-400 to-indigo-500 p-[2px] shadow-md group-hover:shadow-lg transition-all group-hover:scale-105">
                  <div className="w-full h-full rounded-[14px] overflow-hidden bg-white flex items-center justify-center">
                    {user?.photoURL ? (
                      <img key={user.photoURL} src={resolveProfilePhotoUrl(user.photoURL)} alt="User" className="w-full h-full object-cover" />
                    ) : (
                      <UserCircle size={24} className="text-black/30" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </header>

          {userRole === 'hodim' && <HodimGpsPromptBar />}

          {isNotificationsOpen && (
            <div
              ref={notificationsPanelRef}
              className="absolute top-24 right-8 z-[80] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/70 bg-white/90 shadow-2xl backdrop-blur-md overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-black/80">{translate(language, 'shell.notifications')}</h3>
                <button
                  onClick={markAllNotificationsRead}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-500"
                >
                  {translate(language, 'shell.markAllRead')}
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-[12px] text-black/45 text-center">
                    {translate(language, 'shell.noNotifications')}
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() =>
                        setNotifications((prev) =>
                          prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
                        )
                      }
                      className={`px-4 py-3 border-b border-black/5 cursor-pointer ${
                        n.read
                          ? 'bg-white/30'
                          : n.level === 'error'
                            ? 'bg-rose-50/70'
                            : n.level === 'warning'
                              ? 'bg-amber-50/70'
                              : n.level === 'success'
                                ? 'bg-emerald-50/70'
                                : 'bg-blue-50/60'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-[12px] font-semibold text-black/80">
                            {n.titleKey ? translate(language, n.titleKey) : n.title}
                          </p>
                          <p className="text-[12px] text-black/60 mt-0.5 break-words">
                            {n.bodyKey ? translate(language, n.bodyKey) : n.body}
                          </p>
                          <p className="text-[10px] text-black/35 mt-1">
                            {new Date(n.createdAt).toLocaleString(localeForLanguage(language))}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Ishchi maydon — telefonda pastki menyu uchun qo'shimcha joy.

              Burchaklar ilgari yumaloq edi, chunki ishchi maydon oq
              kartochka bo'lib fon ustida turardi. Endi kartochka yo'q —
              yumaloqlik faqat aylantirilganda yopishqoq sarlavhaning
              chetini qirqib qo'yardi. */}
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] md:pb-0">
            {userRole === 'hodim' && teachingSubjectsReady === null ? (
              <div className="h-full min-h-[50vh] flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 size={40} className="animate-spin text-blue-500" />
                <p className="text-sm font-medium">{translate(language, 'teachingSubjects.loading')}</p>
              </div>
            ) : (
              mountedViews.map((view) => {
                const isActive = activeView === view;
                return (
                  <motion.div
                    key={view}
                    initial={isActive ? { opacity: 0, scale: 0.98, y: 10 } : false}
                    animate={isActive ? { opacity: 1, scale: 1, y: 0 } : false}
                    transition={isActive ? { duration: 0.25, ease: [0.22, 1, 0.36, 1] } : undefined}
                    className={isActive ? 'min-h-0' : 'hidden'}
                  >
                    {renderContent(view)}
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      </div>
      {userRole === 'hodim' && teachingSubjectsReady === false && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-900/45 backdrop-blur-[2px] print:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="teaching-subjects-modal-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-2xl max-h-[min(88dvh,720px)] overflow-y-auto rounded-[1.75rem] bg-white shadow-2xl border border-black/5 p-5 sm:p-8"
          >
            <StaffTeachingSubjectsPicker
              variant="onboarding"
              onSaved={() => {
                setTeachingSubjectsReady(true);
                setActiveView('syllabus');
              }}
            />
          </motion.div>
        </div>
      )}
      <div className="hidden md:block print:hidden">{platformCredit}</div>

      {/* Mobile: native-style bottom tabs + compact credit strip */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-[70] flex flex-col border-t border-white/70 bg-white/95 backdrop-blur-xl shadow-[0_-10px_40px_rgba(0,0,0,0.08)] print:hidden"
        style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="px-2 pt-1 max-[380px]:hidden">
          <div className="mx-auto flex max-w-lg flex-nowrap items-center justify-center gap-x-2 overflow-x-auto text-[8px] leading-tight text-black/55 whitespace-nowrap py-0.5">
            <span>{'\u00A9'} 2026 iMentor</span>
            <a href="https://fjsti.uz" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 shrink-0">
              FJSTI
            </a>
          </div>
        </div>
        <nav
          className="flex flex-nowrap items-stretch justify-start gap-1 overflow-x-auto px-2 pt-1 pb-0.5 scrollbar-hide"
          aria-label={translate(language, 'shell.mobileNav')}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {navItems.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id as View)}
                className={`relative flex min-w-[3.75rem] max-w-[5rem] shrink-0 flex-col items-center justify-center rounded-2xl px-1 py-1.5 transition-colors ${
                  active ? 'font-semibold' : 'text-black/55 active:bg-black/5'
                }`}
              >
                {/* Tanlov ko'rsatkichi bo'limlar orasida siljiydi. */}
                {active && (
                  <motion.span
                    layoutId="nav-active-mobile"
                    transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                    className={`absolute inset-0 rounded-2xl ${accentFor(item.id).row}`}
                  />
                )}
                <span
                  className={`relative mb-0.5 flex h-8 w-8 items-center justify-center rounded-xl ${
                    active ? accentFor(item.id).on : accentFor(item.id).tile
                  }`}
                >
                  <item.icon size={17} strokeWidth={active ? 2.4 : 2} />
                </span>
                <span className="relative mt-0.5 max-w-full truncate px-0.5 text-center text-[9px] font-semibold leading-tight">
                  {navMobileLabel(language, item.id, item.label)}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
      </>
      )}
      </GlobalLectureContext.Provider>
      </AppNavigationContext.Provider>
    </GlobalTopicContext.Provider>
      )}
    </AppLanguageContext.Provider>
  );
}





