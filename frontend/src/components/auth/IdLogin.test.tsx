/**
 * Parolsiz kirish oynasi (2026-10-02): JSHSHIR yoki pasport.
 *
 * Eng muhimi — pasport seriyasi QO'LDA YOZILMAYDI: manbada kirillcha "А" va
 * lotincha "A" aralash, qo'lda yozilganda hech kim topilmasdi.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loginMock = vi.fn();
vi.mock('../../utils/backendAuth', async (orig) => ({
  ...(await orig<typeof import('../../utils/backendAuth')>()),
  loginWithIdentity: (...a: unknown[]) => loginMock(...a),
  getBackendAccessToken: vi.fn(async () => 'token'),
  syncSessionRoleFromServer: vi.fn(async () => undefined),
}));

import IdLogin from './IdLogin';

describe('IdLogin', () => {
  beforeEach(() => {
    loginMock.mockReset();
    loginMock.mockResolvedValue({});
  });

  it('parol maydoni umuman yo‘q', () => {
    const { container } = render(<IdLogin />);
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('JSHSHIR 14 ta raqam bo‘lmaguncha yuborilmaydi', async () => {
    const user = userEvent.setup();
    render(<IdLogin />);
    const input = screen.getByLabelText(/JSHSHIR/);
    await user.type(input, '1234567890123'); // 13 ta
    expect(screen.getByRole('button', { name: 'Kirish' })).toBeDisabled();
    await user.type(input, '4');
    expect(screen.getByRole('button', { name: 'Kirish' })).toBeEnabled();
  });

  it('JSHSHIR maydoniga harf yozib bo‘lmaydi', async () => {
    const user = userEvent.setup();
    render(<IdLogin />);
    const input = screen.getByLabelText(/JSHSHIR/) as HTMLInputElement;
    await user.type(input, '12ab34');
    expect(input.value).toBe('1234');
  });

  it('JSHSHIR bilan kiradi', async () => {
    const user = userEvent.setup();
    render(<IdLogin />);
    await user.type(screen.getByLabelText(/JSHSHIR/), '12345678901234');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({ pinfl: '12345678901234' }));
  });

  it('pasport seriyasi ro‘yxatdan tanlanadi, qo‘lda yozilmaydi', async () => {
    const user = userEvent.setup();
    render(<IdLogin />);
    await user.click(screen.getByRole('button', { name: /Pasport/ }));
    const series = screen.getByLabelText('Seriya');
    expect(series.tagName).toBe('SELECT');
    // O'zbekiston seriyalari ro'yxatda.
    for (const s of ['AA', 'AB', 'AD', 'AE', 'AF']) {
      expect(screen.getByRole('option', { name: s })).toBeInTheDocument();
    }
  });

  it('pasport bilan kiradi: seriya + raqam', async () => {
    const user = userEvent.setup();
    render(<IdLogin />);
    await user.click(screen.getByRole('button', { name: /Pasport/ }));
    fireEvent.change(screen.getByLabelText('Seriya'), { target: { value: 'AD' } });
    await user.type(screen.getByLabelText(/Pasport yoki ID karta/), '4164950');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));
    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({ passportSeries: 'AD', passportNumber: '4164950' }),
    );
  });

  it('seriya tanlanmaguncha yuborilmaydi', async () => {
    const user = userEvent.setup();
    render(<IdLogin />);
    await user.click(screen.getByRole('button', { name: /Pasport/ }));
    await user.type(screen.getByLabelText(/Pasport yoki ID karta/), '4164950');
    expect(screen.getByRole('button', { name: 'Kirish' })).toBeDisabled();
  });
});

describe('IdLogin — institut raqami (2026-10-05)', () => {
  it('uchinchi yo‘l bor: JSHSHIR, pasport va ID raqam', () => {
    render(<IdLogin />);
    expect(screen.getByRole('button', { name: /JSHSHIR/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pasport/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ID raqam/ })).toBeInTheDocument();
  });

  it('Talaba ID bilan kiradi — cam.fermi.uz da yo‘q talaba uchun yagona yo‘l', async () => {
    const user = userEvent.setup();
    render(<IdLogin />);
    await user.click(screen.getByRole('button', { name: /ID raqam/ }));
    await user.type(screen.getByLabelText(/Talaba ID yoki Xodim ID/), '344261200064');
    await user.click(screen.getByRole('button', { name: 'Kirish' }));
    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({ instituteId: '344261200064' }),
    );
  });

  it('juda qisqa raqam yuborilmaydi', async () => {
    const user = userEvent.setup();
    render(<IdLogin />);
    await user.click(screen.getByRole('button', { name: /ID raqam/ }));
    await user.type(screen.getByLabelText(/Talaba ID yoki Xodim ID/), '123');
    expect(screen.getByRole('button', { name: 'Kirish' })).toBeDisabled();
  });
});
