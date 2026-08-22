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
  GraduationCap,
  Youtube,
  Monitor,
  Loader2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
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
import AdminSuperAiReport from './components/admin/AdminSuperAiReport';
import AdminStaffLocationConsole from './components/admin/AdminStaffLocationConsole';
import AdminLiveTeachingBoard from './components/admin/AdminLiveTeachingBoard';
import AdminCampusBuildingsPage from './components/admin/AdminCampusBuildingsPage';
import AdminSyllabusCatalog from './components/admin/AdminSyllabusCatalog';
import AdminCourseAssignments from './components/admin/AdminCourseAssignments';
import AdminTopicVideos from './components/admin/AdminTopicVideos';
import AdminTopicHandouts from './components/admin/AdminTopicHandouts';
import AdminBooksLibrary from './components/admin/AdminBooksLibrary';
import HodimGpsPromptBar from './components/staff/HodimGpsPromptBar';
import PublicLandingPage from './components/public/PublicLandingPage';
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
  | 'admin-super-ai-report'
  | 'admin-staff'
  | 'admin-staff-location'
  | 'admin-live-teaching'
  | 'admin-campus-buildings'
  | 'admin-cases'
  | 'admin-tests'
  | 'admin-live-test-results'
  | 'admin-syllabuses'
  | 'admin-course-assignments'
  | 'admin-videos'
  | 'admin-handouts'
  | 'admin-books'
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
  'admin-super-ai-report': Sparkles,
  'admin-staff': Users,
  'admin-staff-location': MapPin,
  'admin-live-teaching': Monitor,
  'admin-campus-buildings': Building2,
  'admin-cases': BriefcaseMedical,
  'admin-tests': ClipboardList,
  'admin-live-test-results': Users,
  'admin-syllabuses': BookOpen,
  'admin-course-assignments': GraduationCap,
  'admin-videos': Youtube,
  'admin-handouts': Files,
  'admin-books': BookMarked,
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
  'admin-super-ai-report',
  'admin-staff',
  'admin-staff-location',
  'admin-live-teaching',
  'admin-campus-buildings',
  'admin-syllabuses',
  'admin-course-assignments',
  'admin-videos',
  'admin-handouts',
  'admin-books',
  'admin-cases',
  'admin-tests',
  'admin-live-test-results',
  'profile',
];
const STUDENT_NAV_IDS: View[] = ['my-tests', 'profile'];

function navItemsForRole(role: UserRole, lang: AppLanguage): NavItemDef[] {
  const ids =
    role === 'admin' ? ADMIN_NAV_IDS : role === 'student' ? STUDENT_NAV_IDS : HODIM_NAV_IDS;
  return ids.map((id) => ({ id, label: navLabel(lang, id), icon: NAV_ICONS[id] }));
}

export const GlobalTopicContext = createContext<SyllabusTopicContext | null>(null);

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
  /** Kompyuterda login modal holati: 'talaba' — standart (Talaba ID+parol),
   * 'qr' — hodim uchun QR, 'admin' — faqat administrator uchun telefon+parol. */
  const [desktopAuthView, setDesktopAuthView] = useState<'talaba' | 'qr' | 'admin'>('talaba');
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
    void fetchMyCourseSelections()
      .then((rows) => {
        if (!cancelled) setTeachingSubjectsReady(rows.length > 0);
      })
      .catch(() => {
        if (!cancelled) setTeachingSubjectsReady(false);
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

  const handleOpenLectures = (topic: SyllabusTopicContext) => {
    setSelectedTopic(topic);
    persistSelectedTopic(topic);
    setActiveView('lectures');
  };

  const renderContent = (view: View) => {
    switch (view) {
      case 'admin-dashboard':
        return <AdminDashboardHome />;
      case 'admin-super-ai-report':
        return <AdminSuperAiReport />;
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
      case 'admin-course-assignments':
        return <AdminCourseAssignments />;
      case 'admin-videos':
        return <AdminTopicVideos />;
      case 'admin-handouts':
        return <AdminTopicHandouts />;
      case 'admin-books':
        return <AdminBooksLibrary />;
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
        return <UserProfile />;
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
              href="/?library=1#public-catalog"
              className="font-semibold text-indigo-700 hover:text-indigo-600 underline decoration-indigo-300 shrink-0"
            >
              {translate(language, 'publicLanding.openCatalog')}
            </a>
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
            <a
              href="/?library=1#public-catalog"
              className="font-semibold text-teal-700 hover:text-teal-600 underline decoration-teal-300"
            >
              {translate(language, 'publicLanding.openCatalog')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );

  const wantsPublicLibrary = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('library') === '1' || window.location.hash === '#public-catalog';
  }, []);

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
      {!user || wantsPublicLibrary ? (
        <PublicLandingPage
          language={language}
          setLanguage={setLanguage}
          isMobileDevice={isMobileDevice}
          desktopAuthView={desktopAuthView}
          setDesktopAuthView={setDesktopAuthView}
        />
      ) : shouldHodimUseMobileCompanion(user, isMobileDevice) ? (
        <HodimMobileCompanion />
      ) : userRole === 'hodim' && isDesktopBrowser() && !isDesktopPairedSession(user.uid) ? (
        <div className="min-h-[100dvh] w-full flex items-center justify-center bg-gradient-to-br from-[#eef6ff] via-[#f5f8ff] to-[#f3f0ff] p-4 overflow-y-auto">
          <DesktopHodimQrLogin
            onOtherRoles={() => {
              clearBackendAuthTokens();
              clearDesktopPairedSession(user.uid);
              logoutLocalStaff();
            }}
          />
        </div>
      ) : (
      <>
      <div className="flex flex-col h-[100dvh] min-h-0 w-full relative overflow-hidden bg-gradient-to-br from-[#eef6ff] via-[#f5f8ff] to-[#f3f0ff] text-[#1c1c1e] selection:bg-sky-500/30">
      
      {/* Background iOS Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-400/25 rounded-full blur-[120px] pointer-events-none orb-float" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-400/20 rounded-full blur-[140px] pointer-events-none orb-float" />
      <div className="absolute top-[20%] right-[10%] w-[30%] h-[40%] bg-cyan-300/20 rounded-full blur-[100px] pointer-events-none orb-float" />

      {/* Main Layout Container */}
      <div className="relative z-10 flex w-full flex-1 min-h-0 p-1.5 sm:p-2 lg:p-3 gap-1.5 sm:gap-2">
        
        {/* Floating Sidebar — desktop / tablet only */}
        <motion.aside 
          initial={false}
          animate={{ width: isSidebarOpen ? 280 : 88 }}
          className="hidden md:flex md:flex-col ios-glass rounded-[2rem] z-50 shrink-0 overflow-hidden relative shadow-2xl pb-4 border border-white/60 print:hidden"
        >
          <div className="p-6 flex items-center justify-between pb-4">
            <div className={`flex items-center gap-3 overflow-hidden ${!isSidebarOpen && 'hidden'}`}>
              <img
                src="/imentor-logo.png"
                alt="iMentor"
                className="w-12 h-12 rounded-2xl object-cover shadow-lg border border-white/70 bg-white shrink-0"
              />
              <div className="flex flex-col min-w-max">
                <span className="font-semibold text-[15px] tracking-tight leading-tight text-black/90">
                  iMentor
                </span>
                <span className="text-[11px] text-black/50 font-medium tracking-wide">iMentor Platform</span>
              </div>
            </div>
            <button 
              onClick={() => setSidebarOpen(!isSidebarOpen)}
              className="w-10 h-10 ios-glass-btn border border-black/5 flex justify-center items-center rounded-xl text-black/60 mx-auto bg-white/40 hover:bg-white/60 backdrop-blur-md transition-all shadow-sm shrink-0"
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>

          <div className={`px-6 mb-2 mt-2 transition-opacity duration-200 ${!isSidebarOpen ? 'opacity-0 h-0 hidden' : 'opacity-100'}`}>
            <p className="text-[11px] font-semibold text-black/40 uppercase tracking-widest">
              {translate(language, 'shell.mainMenu')}
            </p>
          </div>

          <nav className="flex-1 px-4 py-2 space-y-2 overflow-y-auto scrollbar-hide">
            {navItems.map((item) => (
              <button
                  key={item.id}
                  onClick={() => setActiveView(item.id as View)}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 text-[15px] group
                    ${activeView === item.id 
                      ? 'bg-blue-600 shadow-md shadow-blue-600/20 text-white font-semibold' 
                      : 'text-black/60 hover:bg-white/60 hover:shadow-sm font-medium'}`}
                >
                  <item.icon size={22} className={`shrink-0 ${activeView === item.id ? 'text-white' : 'text-black/40 group-hover:text-blue-500 transition-colors'}`} strokeWidth={activeView === item.id ? 2.5 : 2} />
                  {isSidebarOpen && <span className="truncate">{item.label}</span>}
                </button>
            ))}
          </nav>

          <div className="px-4 mt-auto space-y-3">
             <button
                onClick={handleLogout}
                className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 text-[15px] text-rose-500 hover:bg-rose-500/10 hover:shadow-sm font-medium group`}
              >
                <LogOut size={22} className="shrink-0 text-rose-400 group-hover:text-rose-500 transition-colors" strokeWidth={2} />
                {isSidebarOpen && <span className="truncate">{translate(language, 'shell.logout')}</span>}
              </button>
          </div>
        </motion.aside>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col gap-2 sm:gap-4 overflow-hidden relative min-w-0 min-h-0">
          {/* Header */}
          <header className="ios-glass h-16 sm:h-20 rounded-2xl sm:rounded-[2rem] flex items-center justify-between px-3 sm:px-8 shrink-0 z-40 shadow-sm border border-white/60 print:hidden gap-2">
            <div className="flex items-center min-w-0 flex-1">
              <div className="flex-col space-y-0.5 min-w-0">
                <h1 className="text-[14px] sm:text-[16px] font-semibold tracking-tight text-black/90 truncate">
                  {translate(language, 'shell.platformTitle')}
                </h1>
                <p className="hidden sm:block text-[12px] text-black/50 font-medium tracking-wide truncate">
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
                className="h-10 sm:h-11 max-w-[7rem] sm:max-w-none rounded-xl border border-white/60 bg-white/70 px-2 sm:px-3 text-[11px] sm:text-[12px] font-semibold text-black/70 outline-none"
                aria-label={translate(language, 'shell.languageAria')}
              >
                <option value="uz">{languageLabel('uz')}</option>
                <option value="ru">{languageLabel('ru')}</option>
                <option value="en">{languageLabel('en')}</option>
              </select>
              <button
                ref={notificationsButtonRef}
                onClick={() => setNotificationsOpen((v) => !v)}
                className="relative w-10 h-10 sm:w-11 sm:h-11 bg-white/50 border border-white/60 shadow-sm rounded-2xl flex items-center justify-center text-black/50 cursor-pointer hover:bg-white/80 transition-colors"
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

          {/* Main View Port — extra bottom padding on phones for tab bar */}
          <div className="flex-1 overflow-y-auto scrollbar-hide rounded-2xl sm:rounded-[2rem] min-h-0 pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] md:pb-0">
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
                className={`flex min-w-[3.75rem] max-w-[5rem] shrink-0 flex-col items-center justify-center rounded-2xl px-1 py-2 transition-colors ${
                  active ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25' : 'text-black/55 active:bg-black/5'
                }`}
              >
                <item.icon
                  size={22}
                  strokeWidth={active ? 2.5 : 2}
                  className={`shrink-0 ${active ? 'text-white' : 'text-black/45'}`}
                />
                <span className="mt-0.5 max-w-full truncate px-0.5 text-center text-[9px] font-semibold leading-tight">
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





