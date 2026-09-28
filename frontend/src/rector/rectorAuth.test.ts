import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, setHttpTokenRefresher } from '../api/httpClient';
import { fetchControlReport } from './rectorApi';

/**
 * 2026-09-26: rektor seansi tugaganda umumiy httpClient shu brauzerdagi
 * o'qituvchi tokenini yangilab qayta urinar va "HTTP 403" chiqarardi.
 * Rektor so'rovi hech qachon boshqa token bilan qaytarilmasligi kerak.
 */
describe('rektor so‘rovi boshqa token bilan qaytarilmaydi', () => {
  afterEach(() => {
    setHttpTokenRefresher(null);
    vi.unstubAllGlobals();
  });

  it('401 da o‘qituvchi tokeni ishlatilmaydi — 401 o‘zi qaytadi', async () => {
    const refresher = vi.fn(async () => 'teacher-token');
    setHttpTokenRefresher(refresher);
    localStorage.setItem('imentor-rector-token-v1', 'expired-rector-token');
    const fetchMock = vi.fn(async () => new Response('{"detail":"Seans muddati tugadi."}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await fetchControlReport({ from: '2026-09-26', to: '2026-09-26' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresher).not.toHaveBeenCalled();
  });
});
