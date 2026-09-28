import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { getCurrentLocalUserMock, subscribeLocalAuthMock, isPublicStudentTestUrlMock, isMobileMock } = vi.hoisted(() => ({
  isMobileMock: vi.fn(() => false),
  getCurrentLocalUserMock: vi.fn(),
  subscribeLocalAuthMock: vi.fn(),
  isPublicStudentTestUrlMock: vi.fn(() => false),
}));

// `motion.<teg>` ning har qanday variantini qamrab oladi. Ilgari bu yerda
// faqat `aside` va `div` bor edi — qobiqqa `motion.span` qo'shilganda test
// "Element type is invalid" bilan yiqilgan, holbuki kod to'g'ri edi.
vi.mock('motion/react', () => {
  const plain = (tag: string) =>
    ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      // Animatsiya xossalari DOM ga o'tmasin — React ogohlantirish beradi.
      const {
        initial: _i, animate: _a, exit: _e, transition: _t, layoutId: _l,
        whileHover: _wh, whileTap: _wt, layout: _lay,
        ...rest
      } = props as Record<string, unknown>;
      return React.createElement(tag, rest, children);
    };
  return {
    AnimatePresence: ({ children }: React.PropsWithChildren) => children,
    motion: new Proxy({} as Record<string, unknown>, {
      get: (_target, tag: string) => plain(tag),
    }),
  };
});

vi.mock('./hooks/useDeviceProfile', () => ({
  useDeviceProfile: () => ({ isMobile: isMobileMock() }),
}));

vi.mock('./hooks/useStaffLocationTracking', () => ({
  useStaffLocationTracking: () => undefined,
}));

vi.mock('./utils/liveTestApi', () => ({
  isPublicStudentTestUrl: () => isPublicStudentTestUrlMock(),
}));

vi.mock('./utils/deviceDetection', () => ({
  isDesktopBrowser: () => true,
}));

vi.mock('./utils/deviceSession', () => ({
  clearDesktopPairedSession: vi.fn(),
  isDesktopPairedSession: () => true,
  shouldHodimUseMobileCompanion: () => false,
}));

vi.mock('./utils/localStaffAuth', () => ({
  getCurrentLocalUser: () => getCurrentLocalUserMock(),
  subscribeLocalAuth: (cb: () => void) => {
    subscribeLocalAuthMock(cb);
    return () => {};
  },
  logoutLocalStaff: vi.fn(),
  touchCurrentUserActivityIfNeeded: vi.fn(),
  normalizeUserRole: (user: { role?: string }) => user?.role || 'hodim',
}));

vi.mock('./utils/backendAuth', () => ({
  clearBackendAuthTokens: vi.fn(),
  getBackendAccessToken: vi.fn().mockResolvedValue(null),
  setUnauthorizedHandler: vi.fn(),
  syncSessionRoleFromServer: vi.fn(),
  syncStaffPhotoFromServer: vi.fn(),
}));

vi.mock('./utils/syllabusApi', () => ({
  fetchMyCourseSelections: vi.fn().mockResolvedValue([{ id: 1, syllabus: { id: 1 }, variant_label: '', selected_at: '' }]),
}));

vi.mock('./components/staff/StaffTeachingSubjectsPicker', () => ({
  default: () => <div data-testid="teaching-subjects-picker">PICKER</div>,
}));

vi.mock('./components/auth/MobileAuthScreen', () => ({
  default: () => <div data-testid="mobile-auth" />,
}));

vi.mock('./components/public/PublicLandingPage', () => ({
  default: () => <div data-testid="public-landing">PUBLIC_LANDING</div>,
}));

vi.mock('./components/TestQuestions', () => ({
  default: () => <div data-testid="student-test">STUDENT_TEST</div>,
}));

vi.mock('./components/auth/DesktopHodimQrLogin', () => ({
  default: () => <div data-testid="desktop-qr-login">DESKTOP_QR</div>,
}));

vi.mock('./components/staff/HodimMobileCompanion', () => ({
  default: () => <div data-testid="hodim-mobile">HODIM_MOBILE</div>,
}));

vi.mock('./components/SyllabusView', () => ({
  default: () => <div data-testid="syllabus-view">SYLLABUS</div>,
}));

vi.mock('./components/PresentationBuilder', () => ({ default: () => null }));
vi.mock('./components/CaseStudies', () => ({ default: () => null }));
vi.mock('./components/UserProfile', () => ({ default: () => null }));
vi.mock('./components/LectureNotes', () => ({ default: () => null }));
vi.mock('./components/admin/AdminDashboardHome', () => ({ default: () => null }));
vi.mock('./components/admin/AdminStaffManagement', () => ({ default: () => null }));
vi.mock('./components/admin/AdminCasesLibrary', () => ({ default: () => null }));
vi.mock('./components/admin/AdminTestsLibrary', () => ({ default: () => null }));
vi.mock('./components/admin/AdminStaffLocationConsole', () => ({ default: () => null }));
vi.mock('./components/admin/AdminCampusBuildingsPage', () => ({ default: () => null }));
vi.mock('./components/admin/AdminSyllabusCatalog', () => ({ default: () => null }));
vi.mock('./components/staff/HodimGpsPromptBar', () => ({ default: () => null }));

import App from './App';

describe('App auth shell', () => {
  beforeEach(() => {
    getCurrentLocalUserMock.mockReset();
    subscribeLocalAuthMock.mockReset();
    isPublicStudentTestUrlMock.mockReturnValue(false);
    isMobileMock.mockReturnValue(false);
    window.history.pushState({}, '', '/');
  });

  it('renders public landing when user is not signed in', () => {
    getCurrentLocalUserMock.mockReturnValue(null);
    render(<App />);
    expect(screen.getByTestId('public-landing')).toBeInTheDocument();
  });

  it('telefonda landing emas, darhol kirish sahifasi ochiladi', () => {
    isMobileMock.mockReturnValue(true);
    getCurrentLocalUserMock.mockReturnValue(null);
    render(<App />);
    expect(screen.getByTestId('mobile-auth')).toBeInTheDocument();
    expect(screen.queryByTestId('public-landing')).toBeNull();
  });

  it('renders main syllabus shell for signed-in hodim', async () => {
    getCurrentLocalUserMock.mockReturnValue({
      uid: 'u1',
      displayName: 'Hodim',
      firstName: 'Hodim',
      lastName: 'User',
      phoneDisplay: '+998 90 111 22 33',
      phoneDigits: '998901112233',
      faculty: '',
      department: '',
      direction: '',
      email: '998901112233@imentor.local',
      password: '',
      role: 'hodim',
      createdAt: Date.now(),
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('syllabus-view')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('public-landing')).not.toBeInTheDocument();
  });

  it('renders student test fullscreen when mode=student is in URL', () => {
    isPublicStudentTestUrlMock.mockReturnValue(true);

    getCurrentLocalUserMock.mockReturnValue({
      uid: 'u2',
      role: 'hodim',
      phoneDigits: '998901112233',
    });

    render(<App />);
    expect(screen.getByTestId('student-test')).toBeInTheDocument();
    expect(screen.queryByTestId('syllabus-view')).not.toBeInTheDocument();

    isPublicStudentTestUrlMock.mockReturnValue(false);
  });
});
