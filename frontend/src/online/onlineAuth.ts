/**
 * Online portal seansi.
 *
 * Kirishning uch yo'li bor:
 *   - o'qituvchi: telefon yoki login + parol (`/auth/local-login/`)
 *   - 6-kurs talabasi: OnlineTest ID + parol (`/auth/online-test-login/`)
 *   - malaka tinglovchisi: pasport seriyasi + parol (`/auth/malaka-login/`)
 *
 * Token alohida kalitda saqlanadi, chunki portal boshqa domenda turadi va
 * hozirgi iMentor seansiga aralashmasligi kerak.
 */

import { httpJson } from '../api/httpClient';
import { FaceLoginError } from '../utils/backendAuth';
import { currentProgram } from './program';

// Ikki dastur ALOHIDA kalitda: bitta brauzerda ikkala portal ochilsa
// (ishlab chiqishda `?malaka=1`) seanslar bir-birini bosib ketmasin.
const TOKEN_KEY =
  currentProgram() === 'malaka' ? 'imentor-malaka-session-v1' : 'imentor-online-session-v1';

export type OnlineRole = 'teacher' | 'student';

export type OnlineSession = {
  role: OnlineRole;
  access: string;
  refresh: string;
  username: string;
  displayName: string;
  studentId: string;
  groupName: string;
  /** Boshqa odam bergan parol bilan kirgan — avval o'z parolini qo'yadi. */
  mustChangePassword?: boolean;
};

type LoginResponse = {
  access: string;
  refresh: string;
  username: string;
  first_name: string;
  last_name: string;
  role: string;
  student_id?: string | null;
  group_name?: string | null;
  must_change_password?: boolean;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

export function loadOnlineSession(): OnlineSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnlineSession;
    return parsed?.access ? parsed : null;
  } catch {
    return null;
  }
}

function store(session: OnlineSession): OnlineSession {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
  } catch {
    /* xotira yopiq bo'lsa ham joriy seans ishlaydi */
  }
  return session;
}

export function clearOnlineSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* muhim emas */
  }
}

function toSession(role: OnlineRole, r: LoginResponse): OnlineSession {
  const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
  return {
    role,
    access: r.access,
    refresh: r.refresh,
    username: r.username,
    displayName: name || r.username,
    studentId: String(r.student_id || ''),
    groupName: String(r.group_name || ''),
    mustChangePassword: Boolean(r.must_change_password),
  };
}

export async function loginTeacher(login: string, password: string): Promise<OnlineSession> {
  const r = await httpJson<LoginResponse>(`${apiBaseUrl()}/v1/auth/local-login/`, {
    method: 'POST',
    body: { phone_digits: login, password },
  });
  return store(toSession('teacher', r));
}

export async function loginStudent(studentId: string, password: string): Promise<OnlineSession> {
  const r = await httpJson<LoginResponse>(`${apiBaseUrl()}/v1/auth/online-test-login/`, {
    method: 'POST',
    body: { id: studentId, password },
  });
  return store(toSession('student', r));
}

/** Yuz orqali kirish (talaba, malaka tinglovchisi yoki o'qituvchi) — server kimligini o'zi aniqlaydi.
 *  Xato bo'lsa `FaceLoginError` (FaceLogin komponenti matnini ko'rsatadi). */
export async function loginWithFace(frames: Blob[]): Promise<OnlineSession> {
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
  const r = (await res.json()) as LoginResponse;
  return store(toSession(r.role === 'student' ? 'student' : 'teacher', r));
}

/** Malaka tinglovchisi — login pasport seriyasi va raqami (bo'sh joy ahamiyatsiz). */
export async function loginListener(login: string, password: string): Promise<OnlineSession> {
  const r = await httpJson<LoginResponse>(`${apiBaseUrl()}/v1/auth/malaka-login/`, {
    method: 'POST',
    body: { login, password },
  });
  return store(toSession('student', r));
}

/** So'rov uchun sarlavha. Token yo'q bo'lsa bo'sh — chaqiruvchi 401 ni ko'radi. */
export function authHeader(): Record<string, string> {
  const s = loadOnlineSession();
  return s ? { Authorization: `Bearer ${s.access}` } : {};
}

/**
 * Parolni almashtiradi. Majburiy almashtirish belgisi server tomonida
 * shu zahoti tushadi, shuning uchun joriy token ham darhol to'liq ishlaydi.
 */
export async function changePassword(current: string, next: string): Promise<void> {
  await httpJson(`${apiBaseUrl()}/v1/auth/change-password/`, {
    method: 'POST',
    body: { current_password: current, new_password: next },
    headers: authHeader(),
  });
  const s = loadOnlineSession();
  if (s) store({ ...s, mustChangePassword: false });
}

/**
 * Muddati tugagan access tokenni refresh orqali yangilaydi.
 *
 * Portal `refresh` tokenni saqlab qo'yardi, lekin uni HECH QACHON
 * ishlatmasdi. Access token 12 soatdan keyin tugaydi, ya'ni ertasi kuni
 * kirgan talaba tizimda ko'rinib turardi — sarlavhada ismi ham, guruhi ham
 * bor edi — lekin har bir so'rov 401 qaytarardi va ekranda "HTTP 401" degan
 * boshi berk yozuvdan boshqa hech narsa yo'q edi.
 *
 * Bir vaqtda ketgan bir nechta so'rov bitta yangilashga birlashtiriladi;
 * aks holda sahifa ochilishida yettita so'rov yettita refresh yuborardi.
 */
let inFlightRefresh: Promise<string | null> | null = null;

export function refreshOnlineAccess(): Promise<string | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = doRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

async function doRefresh(): Promise<string | null> {
  const session = loadOnlineSession();
  if (!session?.refresh) {
    clearOnlineSession();
    return null;
  }
  try {
    const r = await httpJson<{ access?: string; refresh?: string }>(
      `${apiBaseUrl()}/v1/auth/token/refresh/`,
      {
        method: 'POST',
        body: { refresh: session.refresh },
        // Yangilashning o'zi 401 bersa qayta urinish ma'nosiz — refresh
        // tokenning ham muddati tugagan, qaytadan kirish kerak.
        retryOnUnauthorized: false,
      },
    );
    if (!r?.access) {
      clearOnlineSession();
      return null;
    }
    store({ ...session, access: r.access, refresh: r.refresh || session.refresh });
    return r.access;
  } catch {
    clearOnlineSession();
    return null;
  }
}
