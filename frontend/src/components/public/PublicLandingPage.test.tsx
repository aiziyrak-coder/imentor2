import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const totalsMock = vi.fn();

vi.mock('../../utils/contentCatalogApi', () => ({
  fetchPublicCatalogTotals: () => totalsMock(),
}));
vi.mock('../auth/DesktopHodimQrLogin', () => ({ default: () => <div data-testid="qr-login" /> }));
vi.mock('../auth/FaceLogin', () => ({ default: () => <div data-testid="face-login" /> }));
vi.mock('../auth/LoginPage', () => ({ default: () => <div data-testid="password-login" /> }));
vi.mock('../auth/MobileMinimalLogin', () => ({ default: () => <div data-testid="mobile-login" /> }));
vi.mock('../auth/RegisterPage', () => ({ default: () => <div data-testid="register" /> }));
vi.mock('../../utils/deviceDetection', () => ({ isDesktopBrowser: () => true }));

import PublicLandingPage from './PublicLandingPage';

// jsdom'da IntersectionObserver yo'q (motion `whileInView`/`useInView` ishlatadi).
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver);

function renderPage(overrides: Partial<React.ComponentProps<typeof PublicLandingPage>> = {}) {
  const props = {
    language: 'uz' as const,
    setLanguage: vi.fn(),
    isMobileDevice: false,
    desktopAuthView: 'face' as 'face' | 'qr' | 'password',
    setDesktopAuthView: vi.fn(),
    ...overrides,
  };
  render(<PublicLandingPage {...props} />);
  return props;
}

describe('PublicLandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    totalsMock.mockResolvedValue(null);
  });

  it("talabaga oid hech narsa ko'rsatmaydi", () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Darsga tayyorgarlik');
    // Jonli test tavsifida "talabalar" so'zi bor — tekshiriladigani talaba kirishi.
    expect(screen.queryByRole('button', { name: 'Talaba' })).toBeNull();
    expect(screen.queryByText(/Talaba ID/)).toBeNull();
  });

  it("ochiq keys va test bazasi bo'limi yo'q", () => {
    renderPage();
    expect(screen.queryByText('Ochiq keys va testlar')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ochiq baza/ })).toBeNull();
  });

  it("kompyuterda kirish tugmasi faqat QR ni ochadi (yuz skaneri telefonda)", async () => {
    const user = userEvent.setup();
    const props = renderPage();
    await user.click(screen.getAllByRole('button', { name: /Tizimga kirish/ })[0]);
    expect(props.setDesktopAuthView).toHaveBeenCalledWith('qr');
    expect(await screen.findByTestId('qr-login')).toBeInTheDocument();
    expect(screen.queryByTestId('face-login')).toBeNull();
  });

  it("eski 'face' holati ham kompyuterda QR ni ko'rsatadi", async () => {
    const user = userEvent.setup();
    renderPage({ desktopAuthView: 'face' });
    await user.click(screen.getAllByRole('button', { name: /Tizimga kirish/ })[0]);
    expect(await screen.findByTestId('qr-login')).toBeInTheDocument();
  });

  it("ro'yxatdan o'tish QR emas, ro'yxat formasini ochadi", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: "Ro'yxatdan o'tish" }));
    expect(await screen.findByTestId('register')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-login')).toBeNull();
  });

  it("til tugmasi tilni almashtiradi", async () => {
    const user = userEvent.setup();
    const props = renderPage();
    await user.click(screen.getByRole('button', { name: 'Русский' }));
    expect(props.setLanguage).toHaveBeenCalledWith('ru');
  });

  it("ochiq baza raqamlari kelmasa bo'lim ko'rinmaydi", async () => {
    renderPage();
    await waitFor(() => expect(totalsMock).toHaveBeenCalled());
    expect(screen.queryByText('iMentor raqamlarda')).toBeNull();
  });

  it("ochiq baza raqamlarini ko'rsatadi", async () => {
    totalsMock.mockResolvedValue({
      total_count: 378,
      questions_total: 2369,
      subjects_distinct: 74,
      authors_distinct: 72,
    });
    renderPage();
    expect(await screen.findByText('iMentor raqamlarda')).toBeInTheDocument();
    expect(screen.getByText('Test savollari')).toBeInTheDocument();
  });
});
