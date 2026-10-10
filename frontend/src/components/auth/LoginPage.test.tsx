import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../App', () => import('../../test/testContexts'));

import LoginPage from './LoginPage';
import { renderWithProviders } from '../../test/renderWithProviders';

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock('../../utils/deviceDetection', () => ({
  isDesktopBrowser: () => false,
}));

vi.mock('../../utils/localStaffAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/localStaffAuth')>();
  return {
    ...actual,
    ensureDefaultRoleDemosExist: vi.fn(),
    getDemoRoleLogins: () => [],
    isDemoAuthEnabled: () => false,
  };
});

const loginMock = vi.fn();
const tokenMock = vi.fn();
const syncMock = vi.fn();
const pinflMock = vi.fn();

vi.mock('../../utils/backendAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/backendAuth')>();
  return {
    FaceLoginError: actual.FaceLoginError,
    isPinfl: actual.isPinfl,
    loginStaffWithBackendFallback: (...args: unknown[]) => loginMock(...args),
    loginWithPinfl: (...args: unknown[]) => pinflMock(...args),
    getBackendAccessToken: () => tokenMock(),
    syncSessionRoleFromServer: () => syncMock(),
  };
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    loginMock.mockResolvedValue({ phoneDigits: '998901112233', role: 'hodim' });
    tokenMock.mockResolvedValue('access-token');
    syncMock.mockResolvedValue(undefined);
    pinflMock.mockResolvedValue({ phoneDigits: '3442412062', role: 'hodim' });
  });

  // Talaba tabi olib tashlangan — sahifa darhol xodim formasi bilan ochiladi.
  async function switchToStaffLogin(_user: ReturnType<typeof userEvent.setup>) {
    expect(screen.queryByRole('button', { name: 'Talaba' })).toBeNull();
  }

  it('shows validation error for too short login', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);
    await switchToStaffLogin(user);

    // 3 belgi — na telefon, na Xodim ID (min 4).
    await user.type(screen.getByPlaceholderText(/Xodim ID|3442112068/i), '123');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    expect(
      screen.getByText("JSHSHIR, Xodim ID yoki to'liq telefon raqamini kiriting."),
    ).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('submits valid credentials and syncs session role', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);
    await switchToStaffLogin(user);

    await user.type(screen.getByPlaceholderText(/Xodim ID|3442112068/i), '+998 90 111 22 33');
    await user.type(screen.getByPlaceholderText(/parol/i), 'StrongPass123');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('+998 90 111 22 33', 'StrongPass123');
    });
    expect(tokenMock).toHaveBeenCalled();
    expect(syncMock).toHaveBeenCalled();
  });

  it('accepts a staff ID as the login', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);
    await switchToStaffLogin(user);

    await user.type(screen.getByPlaceholderText(/Xodim ID|3442112068/i), '3442112068');
    await user.type(screen.getByPlaceholderText(/parol/i), 'fjsti123');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('3442112068', 'fjsti123');
    });
  });

  it('shows wrong-credentials message on auth failure', async () => {
    loginMock.mockRejectedValue(new Error('wrong-password'));
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);
    await switchToStaffLogin(user);

    await user.type(screen.getByPlaceholderText(/Xodim ID|3442112068/i), '+998 90 111 22 33');
    await user.type(screen.getByPlaceholderText(/parol/i), 'bad');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    expect(await screen.findByText(/Login yoki parol noto'g'ri/i)).toBeInTheDocument();
  });

  it('logs in by JSHSHIR alone when the password is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/Xodim ID|3442112068/i), '42005954100011');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    await waitFor(() => expect(pinflMock).toHaveBeenCalledWith('42005954100011'));
    expect(loginMock).not.toHaveBeenCalled();
    expect(syncMock).toHaveBeenCalled();
  });

  it('JSHSHIR with a password still uses the password login', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/Xodim ID|3442112068/i), '42005954100011');
    await user.type(screen.getByPlaceholderText(/parol/i), 'secret');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('42005954100011', 'secret'));
    expect(pinflMock).not.toHaveBeenCalled();
  });

  it('shows the server reason when JSHSHIR is not confirmed', async () => {
    const { FaceLoginError } = await import('../../utils/backendAuth');
    pinflMock.mockRejectedValue(new FaceLoginError(401, 'Bu JSHSHIR cam.fermi.uz xodimlari ro\'yxatida topilmadi.'));
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/Xodim ID|3442112068/i), '42005954100011');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    expect(await screen.findByText(/cam.fermi.uz xodimlari ro'yxatida topilmadi/)).toBeInTheDocument();
  });
});
