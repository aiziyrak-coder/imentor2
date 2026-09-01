/**
 * Online portal seansi.
 *
 * Ikki xil kirish bor va ikkalasi ham MAVJUD backend marshrutlaridan
 * foydalanadi — yangi autentifikatsiya yozilmaydi:
 *   - o'qituvchi: telefon + parol (`/auth/local-login/`)
 *   - talaba: OnlineTest ID + parol (`/auth/online-test-login/`)
 *
 * Token alohida kalitda saqlanadi, chunki portal boshqa domenda turadi va
 * hozirgi iMentor seansiga aralashmasligi kerak.
 */

import { httpJson } from '../api/httpClient';

const TOKEN_KEY = 'imentor-online-session-v1';

export type OnlineRole = 'teacher' | 'student';

export type OnlineSession = {
  role: OnlineRole;
  access: string;
  refresh: string;
  username: string;
  displayName: string;
  studentId: string;
  groupName: string;
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
  };
}

export async function loginTeacher(phone: string, password: string): Promise<OnlineSession> {
  const r = await httpJson<LoginResponse>(`${apiBaseUrl()}/v1/auth/local-login/`, {
    method: 'POST',
    body: { phone_digits: phone, password },
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

/** So'rov uchun sarlavha. Token yo'q bo'lsa bo'sh — chaqiruvchi 401 ni ko'radi. */
export function authHeader(): Record<string, string> {
  const s = loadOnlineSession();
  return s ? { Authorization: `Bearer ${s.access}` } : {};
}
