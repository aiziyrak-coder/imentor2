/**
 * `imentor.uz/admin` — administratorning yagona kirish yo'li (2026-10-03).
 *
 * Xodim va talabada parol yo'q, shuning uchun bu sahifa buzilsa administrator
 * tizimga UMUMAN kira olmaydi. Ilgari u landing sahifa ustidagi oynacha edi:
 * telefonda chiqmasdi (telefonda landing ko'rsatilmaydi), kompyuterda esa
 * oynachaning ochilishiga bog'liq edi — shikoyat shundan chiqqan.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/backendAuth', async (orig) => ({
  ...(await orig<typeof import('../../utils/backendAuth')>()),
  getBackendAccessToken: vi.fn(async () => 'token'),
  syncSessionRoleFromServer: vi.fn(async () => undefined),
  loginStaffWithBackendFallback: vi.fn(async () => ({})),
}));

import AdminLoginScreen from './AdminLoginScreen';
import { isAdminLoginPath } from '../../utils/adminLoginPath';

describe('AdminLoginScreen', () => {
  it('parol maydoni bor — administrator shu yerdan kiradi', () => {
    const { container } = render(<AdminLoginScreen />);
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Kirish' })).toBeInTheDocument();
  });

  it("ro'yxatdan o'tish havolasi yo'q", () => {
    render(<AdminLoginScreen />);
    expect(screen.queryByRole('button', { name: /Ro'yxatdan o'tish/ })).toBeNull();
  });
});

describe('isAdminLoginPath', () => {
  const at = (pathname: string) => {
    const url = new URL(`https://imentor.uz${pathname}`);
    vi.spyOn(window, 'location', 'get').mockReturnValue(url as unknown as Location);
    try {
      return isAdminLoginPath();
    } finally {
      vi.restoreAllMocks();
    }
  };

  it('/admin va /admin-login tanilsin, oxiridagi chiziq ham', () => {
    expect(at('/admin')).toBe(true);
    expect(at('/admin/')).toBe(true);
    expect(at('/ADMIN')).toBe(true);
    expect(at('/admin-login')).toBe(true);
  });

  it("boshqa manzillarda parol sahifasi ochilmasin", () => {
    expect(at('/')).toBe(false);
    expect(at('/rektor')).toBe(false);
    expect(at('/administrator')).toBe(false);
    expect(at('/admin/foo')).toBe(false);
  });
});
