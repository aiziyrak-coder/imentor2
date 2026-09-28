import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../App', () => import('../../test/testContexts'));

import MobileMinimalLogin from './MobileMinimalLogin';
import { renderWithProviders } from '../../test/renderWithProviders';

const staffLoginMock = vi.fn();
const tokenMock = vi.fn();
const syncMock = vi.fn();

vi.mock('../../utils/backendAuth', () => ({
  loginStaffWithBackendFallback: (...args: unknown[]) => staffLoginMock(...args),
  getBackendAccessToken: () => tokenMock(),
  syncSessionRoleFromServer: () => syncMock(),
}));

describe('MobileMinimalLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staffLoginMock.mockResolvedValue({ phoneDigits: '3442112068', role: 'hodim' });
    tokenMock.mockResolvedValue('access-token');
    syncMock.mockResolvedValue(undefined);
  });

  it('talaba tabi yo\'q — darhol xodim formasi ochiladi', () => {
    renderWithProviders(<MobileMinimalLogin onSwitchToRegister={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Talaba' })).toBeNull();
    expect(screen.queryByPlaceholderText('Talaba ID')).toBeNull();
    expect(screen.getByPlaceholderText(/Xodim ID/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ro'yxatdan o'tish/ })).toBeInTheDocument();
  });

  it('Xodim ID bilan kiradi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MobileMinimalLogin onSwitchToRegister={() => {}} />);

    await user.type(screen.getByPlaceholderText(/Xodim ID/), '3442112068');
    await user.type(screen.getByPlaceholderText('Parol'), 'fjsti123');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    await waitFor(() => {
      expect(staffLoginMock).toHaveBeenCalledWith('3442112068', 'fjsti123');
    });
  });

  it('juda qisqa xodim login uchun xato ko\'rsatadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MobileMinimalLogin />);

    await user.type(screen.getByPlaceholderText(/Xodim ID/), '123');
    await user.type(screen.getByPlaceholderText('Parol'), 'fjsti123');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));

    expect(
      screen.getByText("JSHSHIR, Xodim ID yoki to'liq telefon raqamini kiriting."),
    ).toBeInTheDocument();
    expect(staffLoginMock).not.toHaveBeenCalled();
  });
});

describe('MobileMinimalLogin — o\'chirilgan hisob', () => {
  it('"parol noto\'g\'ri" emas, hisob o\'chirilganini aytadi', async () => {
    staffLoginMock.mockRejectedValue(new Error('account-disabled'));
    const user = userEvent.setup();
    renderWithProviders(<MobileMinimalLogin />);
    await user.type(screen.getByPlaceholderText(/Xodim ID/), '3442112024');
    await user.type(screen.getByPlaceholderText('Parol'), 'fjsti123');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));
    expect(await screen.findByText(/Bu hisob o'chirilgan/)).toBeInTheDocument();
  });
});

describe('MobileMinimalLogin — eski hisob egizagi', () => {
  it("server aytgan to'g'ri loginni ko'rsatadi", async () => {
    staffLoginMock.mockRejectedValue(
      Object.assign(new Error('account-disabled'), {
        detail: "Bu eski hisob o'chirilgan. Siz boshqa login bilan ro'yxatdan o'tgansiz: +998 93 ••• •• 00.",
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<MobileMinimalLogin />);
    await user.type(screen.getByPlaceholderText(/Xodim ID/), '3442012031');
    await user.type(screen.getByPlaceholderText('Parol'), 'parol123');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));
    expect(await screen.findByText(/\+998 93 ••• •• 00/)).toBeInTheDocument();
  });
});
