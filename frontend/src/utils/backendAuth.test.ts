import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../api/httpClient';
import { establishLocalSessionFromProfile, getCurrentLocalUser } from './localStaffAuth';

const TOKEN_KEY = 'salomatlik-backend-jwt-v1';

function makeJwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds }));
  return `header.${payload}.signature`;
}

function futureExpSeconds(offsetSec = 3600): number {
  return Math.floor(Date.now() / 1000) + offsetSec;
}

function pastExpSeconds(offsetSec = 120): number {
  return Math.floor(Date.now() / 1000) - offsetSec;
}

const httpJsonMock = vi.fn();

vi.mock('../api/httpClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/httpClient')>();
  return {
    ...actual,
    httpJson: (...args: unknown[]) => httpJsonMock(...args),
  };
});

describe('backendAuth', () => {
  let backendAuth: typeof import('./backendAuth');

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    httpJsonMock.mockReset();
    backendAuth = await import('./backendAuth');
  });

  afterEach(() => {
    backendAuth.setUnauthorizedHandler(null);
  });

  it('face login of a student opens a student session with group', async () => {
    const bundle = {
      access: makeJwt(futureExpSeconds()),
      refresh: makeJwt(futureExpSeconds(86400)),
      role: 'student',
      username: 'ot_3442001',
      first_name: 'Dilnoza',
      last_name: 'Karimova',
      student_id: '3442001',
      group_name: 'DI-2824',
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(bundle), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const user = await backendAuth.loginWithFaceFrames([new Blob(['a']), new Blob(['b'])]);
      expect(user.role).toBe('student');
      expect(user.uid).toBe('ot_3442001');
      expect(user.onlineTestStudentId).toBe('3442001');
      expect(user.studyGroup).toBe('DI-2824');
      expect(getCurrentLocalUser()?.uid).toBe('ot_3442001');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns cached access token while still valid', async () => {
    const exp = futureExpSeconds();
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({
        access: makeJwt(exp),
        refresh: makeJwt(futureExpSeconds(7200)),
        role: 'hodim',
        username: '998901112233',
        accessExpMs: exp * 1000,
        refreshExpMs: futureExpSeconds(7200) * 1000,
      }),
    );

    const token = await backendAuth.getBackendAccessToken();
    expect(token).toBeTruthy();
    expect(httpJsonMock).not.toHaveBeenCalled();
  });

  it('refreshes expired access token using refresh token', async () => {
    const refreshedExp = futureExpSeconds();
    const refreshExp = futureExpSeconds(7200);
    const staleAccess = makeJwt(pastExpSeconds());
    const refreshToken = makeJwt(refreshExp);

    backendAuth.writeBackendTokensFromPair({
      access: staleAccess,
      refresh: refreshToken,
      role: 'hodim',
      username: '998901112233',
    });

    httpJsonMock.mockResolvedValueOnce({
      access: makeJwt(refreshedExp),
      refresh: refreshToken,
    });

    const token = await backendAuth.getBackendAccessToken();
    expect(token).toContain('signature');
    expect(httpJsonMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/auth/token/refresh/'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps the session when refresh fails for network/server reasons', async () => {
    const handler = vi.fn();
    backendAuth.setUnauthorizedHandler(handler);

    backendAuth.writeBackendTokensFromPair({
      access: makeJwt(pastExpSeconds()),
      refresh: makeJwt(futureExpSeconds(7200)),
      role: 'hodim',
      username: '998901112233',
    });

    httpJsonMock.mockRejectedValueOnce(new Error('network down'));

    const token = await backendAuth.getBackendAccessToken();
    // Token berilmaydi (chaqiruvchi xatoni ko'rsatadi), lekin sessiya
    // yopilmaydi — refresh tokeni hali yaroqli, foydalanuvchi qayta uriniladi.
    expect(token).toBeNull();
    expect(handler).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).not.toBeNull();
  });

  it('invokes unauthorized handler when the server rejects the refresh token', async () => {
    const handler = vi.fn();
    backendAuth.setUnauthorizedHandler(handler);

    backendAuth.writeBackendTokensFromPair({
      access: makeJwt(pastExpSeconds()),
      refresh: makeJwt(futureExpSeconds(7200)),
      role: 'hodim',
      username: '998901112233',
    });

    httpJsonMock.mockRejectedValueOnce(new HttpError('HTTP 401', 401, null));

    const token = await backendAuth.getBackendAccessToken();
    expect(token).toBeNull();
    expect(handler).toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('logs out when local role disagrees with cached JWT role', async () => {
    const handler = vi.fn();
    backendAuth.setUnauthorizedHandler(handler);
    const exp = futureExpSeconds();

    backendAuth.writeBackendTokensFromPair({
      access: makeJwt(exp),
      refresh: makeJwt(futureExpSeconds(7200)),
      role: 'admin',
      username: '998901112233',
    });

    establishLocalSessionFromProfile({
      uid: 'local_1',
      displayName: 'Test User',
      firstName: 'Test',
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

    const token = await backendAuth.getBackendAccessToken();
    expect(token).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('syncSessionRoleFromServer updates local user from /auth/me/', async () => {
    const exp = futureExpSeconds();
    backendAuth.writeBackendTokensFromPair({
      access: makeJwt(exp),
      refresh: makeJwt(futureExpSeconds(7200)),
      role: 'hodim',
      username: '998901112233',
    });

    establishLocalSessionFromProfile({
      uid: 'local_2',
      displayName: 'Old Name',
      firstName: 'Old',
      lastName: 'Name',
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

    httpJsonMock.mockResolvedValueOnce({
      username: '998901112233',
      role: 'admin',
      first_name: 'Yangi',
      last_name: 'Ism',
      photo_url: '/media/avatars/x.png',
    });

    const role = await backendAuth.syncSessionRoleFromServer();
    expect(role).toBe('admin');
    expect(getCurrentLocalUser()?.role).toBe('admin');
    expect(getCurrentLocalUser()?.firstName).toBe('Yangi');
  });
});
