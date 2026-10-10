import {
  establishLocalSessionFromProfile,
  getCurrentLocalUser,
  normalizePhoneDigits,
  normalizeStaffLogin,
  normalizeUserRole,
  phoneDigitsToEmail,
  registerLocalStaff,
  syncCurrentUserRoleFromServer,
  updateCurrentLocalUser,
  type LocalStaffUser,
  type UserRole,
} from './localStaffAuth';
import { HttpError, httpJson, setHttpTokenRefresher } from '../api/httpClient';
import { normalizePhotoUrlForCompare } from './profilePhotoApi';

type BackendTokenBundle = {
  access: string;
  refresh: string;
  role: UserRole;
  username: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  student_id?: string;
  group_name?: string;
};

/** Server hali `startuper` qaytarsa — mahalliy sessiyada hodim. */
function normalizeBackendRole(role: string | undefined | null): UserRole {
  if (role === 'admin' || role === 'hodim' || role === 'student') return role;
  if (role === 'startuper') return 'hodim';
  return 'hodim';
}

type CachedBundle = BackendTokenBundle & {
  accessExpMs: number;
  refreshExpMs: number;
};

const TOKEN_KEY = 'salomatlik-backend-jwt-v1';

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

setHttpTokenRefresher(async () => {
  const cached = readCached();
  if (!cached?.refresh) return null;
  const refreshed = await refreshAccessToken(cached);
  return refreshed?.access ?? null;
});

function notifyUnauthorized(): void {
  clearBackendAuthTokens();
  unauthorizedHandler?.();
}

export type AuthMeResponse = {
  id?: number;
  username: string;
  role: BackendTokenBundle['role'];
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  student_id?: string;
  group_name?: string;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function decodeJwtExpMs(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 0;
    const payload = JSON.parse(atob(parts[1]));
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function readCached(): CachedBundle | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBundle;
    return { ...parsed, role: normalizeBackendRole(parsed.role) };
  } catch {
    return null;
  }
}

function writeCached(bundle: BackendTokenBundle): CachedBundle {
  const role = normalizeBackendRole(bundle.role);
  syncCurrentUserRoleFromServer(role);
  const next: CachedBundle = {
    ...bundle,
    role,
    accessExpMs: decodeJwtExpMs(bundle.access),
    refreshExpMs: decodeJwtExpMs(bundle.refresh),
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
  return next;
}

export function clearBackendAuthTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** QR juftlashdan keyin kompyuter JWT saqlash */
export function writeBackendTokensFromPair(bundle: {
  access: string;
  refresh: string;
  role: BackendTokenBundle['role'];
  username: string;
  student_id?: string;
}): void {
  writeCached({
    access: bundle.access,
    refresh: bundle.refresh,
    role: bundle.role,
    username: bundle.username,
    student_id: bundle.student_id,
  });
}

export async function performBackendLocalLogin(input: {
  phone_digits: string;
  password: string;
  role?: UserRole;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  register?: boolean;
}): Promise<BackendTokenBundle> {
  const body: Record<string, string | boolean> = {
    phone_digits: input.phone_digits,
    password: input.password,
    first_name: input.first_name ?? '',
    last_name: input.last_name ?? '',
    display_name: input.display_name ?? '',
  };
  if (input.role) body.role = input.role;
  if (input.register) body.register = true;
  return httpJson<BackendTokenBundle>(`${apiBaseUrl()}/v1/auth/local-login/`, {
    method: 'POST',
    body,
  });
}

/** OnlineTest ID+parol → iMentor student JWT */
export async function performOnlineTestStudentLogin(input: {
  id: string;
  password: string;
}): Promise<BackendTokenBundle> {
  return httpJson<BackendTokenBundle>(`${apiBaseUrl()}/v1/auth/online-test-login/`, {
    method: 'POST',
    body: { id: input.id.trim(), password: input.password },
  });
}

/** Talaba seansi — parol bilan ham, yuz bilan ham bir xil (`ot_<ID>`, guruh tokendan). */
function establishStudentSession(bundle: BackendTokenBundle, fallbackId: string): LocalStaffUser {
  const sid = String(bundle.student_id || fallbackId);
  const now = Date.now();
  const firstName = bundle.first_name || '';
  const lastName = bundle.last_name || '';
  const displayName = `${firstName} ${lastName}`.trim() || sid;
  return establishLocalSessionFromProfile({
    uid: `ot_${sid}`,
    displayName,
    firstName,
    lastName,
    phoneDisplay: sid,
    phoneDigits: sid,
    faculty: '',
    department: '',
    direction: '',
    email: `${sid}@onlinetest.local`,
    password: '',
    role: 'student',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    onlineTestStudentId: sid,
    studyGroup: bundle.group_name || '',
    participantKind: 'student',
  });
}

export async function loginStudentWithOnlineTest(
  studentId: string,
  password: string,
): Promise<LocalStaffUser> {
  const sid = studentId.trim();
  if (!sid || !password) throw new Error('wrong-password');
  try {
    const bundle = await performOnlineTestStudentLogin({ id: sid, password });
    if (bundle.role !== 'student') throw new Error('wrong-password');
    writeCached(bundle);
    return establishStudentSession(bundle, sid);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401) throw new Error('wrong-password');
      if (err.status === 403) throw new Error('forbidden');
      throw new Error('login-error');
    }
    throw err;
  }
}

function findStoredUserByPhone(digits: string): LocalStaffUser | null {
  try {
    const raw = localStorage.getItem('salomatlik-local-staff-users-v1');
    if (!raw) return null;
    const users = JSON.parse(raw) as LocalStaffUser[];
    if (!Array.isArray(users)) return null;
    return users.find((u) => u.phoneDigits === digits) ?? null;
  } catch {
    return null;
  }
}

function buildLocalUserFromBackendLogin(
  phoneInput: string,
  password: string,
  bundle: BackendTokenBundle,
  existing?: LocalStaffUser | null,
): LocalStaffUser {
  // Xodim ID bilan kirilganda ham shu qiymat `phoneDigits` maydonida saqlanadi
  // (u serverdagi `username` bilan bir xil bo'lishi shart).
  const digits = normalizeStaffLogin(phoneInput);
  const now = Date.now();
  const firstName = existing?.firstName || bundle.first_name || '';
  const lastName = existing?.lastName || bundle.last_name || '';
  const displayName =
    existing?.displayName || `${firstName} ${lastName}`.trim() || phoneInput.trim() || digits;
  return {
    uid: existing?.uid ?? `local_${now}_${Math.random().toString(36).slice(2, 8)}`,
    displayName,
    firstName,
    lastName,
    phoneDisplay: existing?.phoneDisplay ?? phoneInput.trim(),
    phoneDigits: digits,
    faculty: existing?.faculty ?? '',
    department: existing?.department ?? '',
    direction: existing?.direction ?? '',
    email: phoneDigitsToEmail(digits),
    password: '',
    role: normalizeBackendRole(bundle.role),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastActiveAt: now,
    photoURL: (() => {
      const serverPhoto = bundle.photo_url?.trim() || null;
      const existingPhoto = existing?.photoURL ?? null;
      if (serverPhoto) return serverPhoto;
      if (existingPhoto?.startsWith('data:')) return existingPhoto;
      return null;
    })(),
    participantKind: existing?.participantKind,
    studyGroup: existing?.studyGroup,
    jobTitle: existing?.jobTitle,
  };
}

/**
 * Server — asosiy manba. Mahalliy hisob profil keshi.
 * Boshqa qurilmada (telefon) kirish va desync holatlarini hal qiladi.
 */
export async function loginStaffWithBackendFallback(
  phoneInput: string,
  password: string,
): Promise<LocalStaffUser> {
  // Telefon raqami YOKI Xodim ID — ikkalasi ham serverda `username`.
  const digits = normalizeStaffLogin(phoneInput);
  try {
    const bundle = await performBackendLocalLogin({
      phone_digits: digits,
      password,
    });
    writeCached(bundle);
    const existing = findStoredUserByPhone(digits);
    return establishLocalSessionFromProfile(
      buildLocalUserFromBackendLogin(phoneInput, password, bundle, existing),
    );
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401) throw new Error('wrong-password');
      if (err.status === 403) {
        // Server qaysi login bilan kirish kerakligini aytishi mumkin — matni saqlanadi.
        const detail = (err.body as { detail?: unknown } | null)?.detail;
        throw Object.assign(new Error('account-disabled'), {
          detail: typeof detail === 'string' ? detail : '',
        });
      }
      if (err.status === 409) throw new Error('already-exists');
    }
    throw err;
  }
}

/**
 * JSHSHIR yoki pasport bilan kirish — PAROLSIZ (2026-10-02).
 *
 * Xodim ham, talaba ham shu yo'ldan kiradi; serverda roli aniqlanadi va
 * yuz orqali kirishdagi kabi bitta "bundle" qaytadi.
 */
export async function loginWithIdentity(input: {
  pinfl?: string;
  passportSeries?: string;
  passportNumber?: string;
  /** Talaba ID yoki Xodim ID — institut bergan raqam. */
  instituteId?: string;
}): Promise<LocalStaffUser> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/v1/auth/id-login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pinfl: input.pinfl || '',
        passport_series: input.passportSeries || '',
        passport_number: input.passportNumber || '',
        institute_id: input.instituteId || '',
      }),
    });
  } catch {
    throw new FaceLoginError(0, '');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* matnsiz javob */
    }
    throw new FaceLoginError(res.status, detail);
  }
  const bundle = (await res.json()) as BackendTokenBundle;
  writeCached(bundle);
  if (bundle.role === 'student') return establishStudentSession(bundle, bundle.username);
  const existing = findStoredUserByPhone(bundle.username);
  return establishLocalSessionFromProfile(
    buildLocalUserFromBackendLogin(bundle.username, '', bundle, existing),
  );
}

/** Yuz orqali kirish xatosi: `status` — server javobi (0 — tarmoq), `detail` — foydalanuvchiga matn. */
export class FaceLoginError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`face-login-${status}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Yuz orqali kirish: ketma-ket olingan 2 kadr (JPEG) serverga yuboriladi. */
export async function loginWithFaceFrames(frames: Blob[]): Promise<LocalStaffUser> {
  const form = new FormData();
  frames.forEach((frame, i) => form.append('frames', frame, `frame-${i}.jpg`));
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/v1/auth/face-login/`, { method: 'POST', body: form });
  } catch {
    throw new FaceLoginError(0, '');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* matnsiz javob */
    }
    throw new FaceLoginError(res.status, detail);
  }
  const bundle = (await res.json()) as BackendTokenBundle;
  writeCached(bundle);
  if (bundle.role === 'student') return establishStudentSession(bundle, bundle.username);
  const existing = findStoredUserByPhone(bundle.username);
  return establishLocalSessionFromProfile(
    buildLocalUserFromBackendLogin(bundle.username, '', bundle, existing),
  );
}

/** Ro‘yxatdan o‘tish: avval server, keyin mahalliy profil. */
export async function registerStaffWithBackend(input: {
  phoneDisplay: string;
  password: string;
  firstName: string;
  lastName: string;
  faculty: string;
  department: string;
  direction: string;
  role: UserRole;
  participantKind?: 'student' | 'employee';
  studyGroup?: string;
  jobTitle?: string;
}): Promise<LocalStaffUser> {
  const digits = normalizePhoneDigits(input.phoneDisplay);
  const bundle = await performBackendLocalLogin({
    phone_digits: digits,
    password: input.password,
    role: input.role,
    first_name: input.firstName,
    last_name: input.lastName,
    display_name: `${input.firstName} ${input.lastName}`.trim(),
    register: true,
  });
  writeCached(bundle);

  try {
    return registerLocalStaff(input);
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'already-exists') {
      return establishLocalSessionFromProfile(
        buildLocalUserFromBackendLogin(input.phoneDisplay, input.password, bundle, null),
      );
    }
    throw err;
  }
}

/** Admin xodim yaratganda/yangilaganda FastAPI bazasiga yozadi. */
export async function provisionBackendStaffAccount(input: {
  phone_digits: string;
  password: string;
  role: UserRole;
  first_name?: string;
  last_name?: string;
}): Promise<void> {
  const { upsertStaffMember } = await import('./staffDirectoryApi');
  await upsertStaffMember({
    phone_digits: input.phone_digits,
    password: input.password,
    role: input.role,
    first_name: input.first_name ?? '',
    last_name: input.last_name ?? '',
  });
}

/** Admin xodimni FastAPI orqali o‘chiradi. */
export async function deprovisionBackendStaffAccount(phone_digits: string): Promise<void> {
  const { removeStaffMember } = await import('./staffDirectoryApi');
  await removeStaffMember(phone_digits);
}

/** Profil paroli o‘zgarganda serverni yangilash. */
export async function syncCurrentUserPasswordToBackend(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson(`${apiBaseUrl()}/v1/auth/change-password/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      current_password: currentPassword,
      new_password: newPassword,
    },
  });
}

/** Bir vaqtda ketayotgan refresh so'rovlari bittaga birlashtiriladi.
 * Sahifa ochilganda 5–10 ta so'rov barobar 401 olishi mumkin — har biri
 * alohida refresh yuborsa, serverga keraksiz zarba va token poygasi bo'ladi. */
let inFlightRefresh: Promise<CachedBundle | null> | null = null;

function refreshAccessToken(cached: CachedBundle): Promise<CachedBundle | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = doRefreshAccessToken(cached).finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

async function doRefreshAccessToken(cached: CachedBundle): Promise<CachedBundle | null> {
  if (!cached.refresh) return null;
  const now = Date.now();
  const leewayMs = 30_000;
  if (cached.refreshExpMs > 0 && cached.refreshExpMs - leewayMs <= now) {
    notifyUnauthorized();
    return null;
  }
  try {
    const resp = await httpJson<{ access: string; refresh?: string }>(
      `${apiBaseUrl()}/v1/auth/token/refresh/`,
      {
        method: 'POST',
        body: { refresh: cached.refresh },
        timeoutMs: 20000,
      },
    );
    if (!resp.access) {
      notifyUnauthorized();
      return null;
    }
    return writeCached({
      access: resp.access,
      refresh: resp.refresh || cached.refresh,
      role: cached.role,
      username: cached.username,
    });
  } catch (err) {
    // Faqat HAQIQIY autentifikatsiya xatosida sessiyani yopamiz. Tarmoq
    // uzilishi, timeout yoki server 5xx (masalan, bir vaqtda ko'p odam
    // kirganda 502) da foydalanuvchini tizimdan chiqarib yuborish — token
    // hali yaroqli bo'la turib ish yo'qolishiga olib keladi.
    const status = err instanceof HttpError ? err.status : 0;
    if (status === 401 || status === 403) {
      notifyUnauthorized();
    }
    return null;
  }
}

export async function fetchAuthMe(): Promise<AuthMeResponse | null> {
  const token = await getBackendAccessToken();
  if (!token) return null;
  try {
    return await httpJson<AuthMeResponse>(`${apiBaseUrl()}/v1/auth/me/`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 15000,
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      notifyUnauthorized();
      return null;
    }
    throw e;
  }
}

/** Serverdagi rolni mahalliy sessiyaga sinxronlash (asosiy ishonch manbai). */
export async function syncSessionRoleFromServer(): Promise<UserRole | null> {
  const me = await fetchAuthMe();
  if (!me?.role) return null;
  const role = normalizeBackendRole(me.role);
  syncCurrentUserRoleFromServer(role);
  const user = getCurrentLocalUser();
  if (user) {
    const patch: Partial<LocalStaffUser> = { role };
    if (me.first_name) patch.firstName = me.first_name;
    if (me.last_name) patch.lastName = me.last_name;
    if (me.photo_url !== undefined) patch.photoURL = me.photo_url?.trim() || null;
    if (me.student_id) patch.onlineTestStudentId = me.student_id;
    updateCurrentLocalUser(patch);
  }
  const cached = readCached();
  if (cached) {
    writeCached({
      ...cached,
      role,
      username: me.username,
      first_name: me.first_name,
      last_name: me.last_name,
      photo_url: me.photo_url,
      student_id: me.student_id,
    });
  }
  return role;
}

/** Saqlangan, muddati o'tmagan token — yangilamaydi va chiqarib yubormaydi (xato hisobotlari uchun). */
export function peekBackendAccessToken(): string | null {
  const cached = readCached();
  return cached?.access && cached.accessExpMs > Date.now() ? cached.access : null;
}

export async function getBackendAccessToken(): Promise<string | null> {
  const now = Date.now();
  const leewayMs = 30_000;
  const cached = readCached();
  if (!cached) return null;

  const localUser = getCurrentLocalUser();
  if (localUser && normalizeUserRole(localUser) !== cached.role) {
    notifyUnauthorized();
    return null;
  }
  if (cached.access && cached.accessExpMs - leewayMs > now) {
    return cached.access;
  }
  if (cached.refresh) {
    const refreshed = await refreshAccessToken(cached);
    if (refreshed?.access && refreshed.accessExpMs - Date.now() > 0) {
      return refreshed.access;
    }
    // Refresh o'tmadi. Agar sabab tarmoq/server bo'lsa, `refreshAccessToken`
    // sessiyani yopmagan — bu yerda ham yopmaymiz, chaqiruvchi shunchaki
    // xatoni ko'rsatadi va foydalanuvchi qayta urinadi. Sessiya faqat
    // refresh tokeni haqiqatan tugagan/rad etilgan holatda yopiladi.
    return null;
  }
  notifyUnauthorized();
  return null;
}

/** AI va boshqa JWT API lar uchun — token yo‘q bo‘lsa aniq xato */
export async function ensureBackendAccessToken(): Promise<string> {
  const token = await getBackendAccessToken();
  if (!token) {
    throw new Error('no-backend-token');
  }
  return token;
}

/** Serverdagi profil rasmini mahalliy sessiyaga sinxronlash. */
export async function syncStaffPhotoFromServer(): Promise<void> {
  const user = getCurrentLocalUser();
  if (!user?.phoneDigits) return;
  try {
    const token = await getBackendAccessToken();
    if (!token) return;
    const data = await httpJson<{ photo_url?: string }>(`${apiBaseUrl()}/v1/auth/me/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const serverPhoto = data.photo_url?.trim() || null;
    const current = user.photoURL ?? null;
    const currentIsLocalOnly = current?.startsWith('data:') ?? false;
    if (normalizePhotoUrlForCompare(serverPhoto) === normalizePhotoUrlForCompare(current)) return;
    if (!serverPhoto && currentIsLocalOnly) return;
    updateCurrentLocalUser({ photoURL: serverPhoto });
  } catch {
    /* offline yoki eski backend */
  }
}
