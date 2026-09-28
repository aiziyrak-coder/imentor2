import { httpJson, HttpError } from '../api/httpClient';
import { unwrapPagedResults, type PagedResponse } from '../api/pagedResults';
import { getBackendAccessToken } from './backendAuth';
import type { SyllabusTopic } from '../services/aiService';
import type { AppLanguage } from '../i18n/language';
import type { SyllabusVariant } from './syllabusVariant';

/** Markaziy fan syllabus (admin katalog) */
export type CourseSyllabusRow = {
  id: number;
  subject_name: string;
  subject_code: string;
  description: string;
  instruction_language?: AppLanguage;
  file_name: string;
  topics: SyllabusTopic[];
  variants: SyllabusVariant[];
  /** Katalog `slim` rejimida mavzular tushirib qoldiriladi — soni shu yerda. */
  topic_count?: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  department?: number | null;
  department_name?: string;
  department_code?: string;
  /** Kafedra institut hujjatidagi klinik ro'yxatdami — AI domenini shu hal qiladi. */
  department_is_clinical?: boolean;
  /** OnlineTest yo'nalish kodi (DI, TPI, PI, …). */
  direction_code?: string;
  /** Ko'rsatish uchun tarjimalar (asl nom o'zgarmaydi — u kalit): */
  name_i18n?: Partial<Record<AppLanguage, string>>;
  topics_i18n?: Partial<Record<AppLanguage, Record<string, string>>>;
  /** O'qituvchi Excel'dan o'zi yuklagan shaxsiy fan (faqat unga ko'rinadi). */
  teacher_owned?: boolean;
};

export type StaffCourseSelectionRow = {
  id: number;
  syllabus: CourseSyllabusRow;
  /** Admin qat'iy biriktirgan bo'lsa — aynan shu variant/yo'nalish; bo'sh = erkin. */
  variant_label: string;
  selected_at: string;
  /** O'qituvchi bu fanni Excel'dan o'zi yuklagan — faqat unga ko'rinadi, o'zi o'chira oladi. */
  is_own?: boolean;
};

/** Admin ko'rinishi: fanga biriktirilgan o'qituvchi (owner_key bilan) */
export type AdminStaffCourseSelectionRow = {
  id: number;
  owner_key: string;
  owner_name: string;
  owner_phone_display: string;
  syllabus: CourseSyllabusRow;
  variant_label: string;
  selected_at: string;
};

export type ClientSyllabusDocument = {
  id: string;
  serverId?: number;
  fileName: string;
  topics: SyllabusTopic[];
  createdAt: number;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export type SyllabusCatalogStats = {
  departments_count: number;
  subjects_count: number;
  subjects_total: number;
  variants_count: number;
  topics_count: number;
  by_department: {
    id: number;
    name: string;
    code: string;
    subjects_count: number;
    sort_order?: number;
  }[];
};

// ——— Admin: markaziy katalog ———

export async function fetchAdminSyllabusCatalogStats(): Promise<SyllabusCatalogStats | null> {
  const token = await getBackendAccessToken();
  if (!token) return null;
  return httpJson<SyllabusCatalogStats>(`${apiBaseUrl()}/v1/admin/course-syllabuses/stats/`, {
    headers: authHeaders(token),
    timeoutMs: 30000,
  });
}

export async function fetchAdminCourseSyllabuses(): Promise<CourseSyllabusRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  // Fan katalogi to'liq kelishi kerak — default page_size=50 yetarli emas.
  const data = await httpJson<CourseSyllabusRow[] | PagedResponse<CourseSyllabusRow>>(
    `${apiBaseUrl()}/v1/admin/course-syllabuses/?page_size=1000`,
    {
      headers: authHeaders(token),
      timeoutMs: 60000,
    },
  );
  return unwrapPagedResults(data);
}

export async function createAdminCourseSyllabus(payload: {
  subject_name: string;
  subject_code?: string;
  department_id?: number | null;
  direction_code?: string;
  description?: string;
  instruction_language?: AppLanguage;
  file_name?: string;
  topics?: SyllabusTopic[];
  variants?: SyllabusVariant[];
  sort_order?: number;
}): Promise<CourseSyllabusRow> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<CourseSyllabusRow>(`${apiBaseUrl()}/v1/admin/course-syllabuses/`, {
    method: 'POST',
    headers: authHeaders(token),
    body: payload,
    timeoutMs: 120000,
  });
}

export async function updateAdminCourseSyllabus(
  id: number,
  payload: Partial<{
    subject_name: string;
    description: string;
    department_id: number | null;
    direction_code: string;
    instruction_language: AppLanguage;
    file_name: string;
    topics: SyllabusTopic[];
    variants: SyllabusVariant[];
    append_variants: boolean;
    sort_order: number;
    is_active: boolean;
  }>,
): Promise<CourseSyllabusRow> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<CourseSyllabusRow>(`${apiBaseUrl()}/v1/admin/course-syllabuses/${id}/`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: payload,
    timeoutMs: 120000,
  });
}

export async function deleteAdminCourseSyllabus(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/course-syllabuses/${id}/`, {
    method: 'DELETE',
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
}

// ——— Admin: o'qituvchi-fan biriktiruvi ———

export async function fetchAdminStaffCourseSelections(
  syllabusId: number,
): Promise<AdminStaffCourseSelectionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<
    AdminStaffCourseSelectionRow[] | PagedResponse<AdminStaffCourseSelectionRow>
  >(`${apiBaseUrl()}/v1/admin/staff-course-selections/?syllabus_id=${syllabusId}`, {
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
  return unwrapPagedResults(data);
}

/** Barcha o'qituvchi–fan biriktiruvlari (fan bo'yicha filtrsiz) */
export async function fetchAllStaffCourseSelections(): Promise<AdminStaffCourseSelectionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<
    AdminStaffCourseSelectionRow[] | PagedResponse<AdminStaffCourseSelectionRow>
  >(`${apiBaseUrl()}/v1/admin/staff-course-selections/?page_size=500`, {
    headers: authHeaders(token),
    timeoutMs: 30000,
  });
  return unwrapPagedResults(data);
}

export async function assignStaffToCourseSyllabus(
  phoneDigits: string,
  syllabusId: number,
  variantLabels: string[] = [],
): Promise<AdminStaffCourseSelectionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<AdminStaffCourseSelectionRow[]>(`${apiBaseUrl()}/v1/admin/staff-course-selections/`, {
    method: 'POST',
    headers: authHeaders(token),
    body: { phone_digits: phoneDigits, syllabus_id: syllabusId, variant_labels: variantLabels },
    timeoutMs: 20000,
  });
}

export async function removeStaffCourseSelection(selectionId: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/staff-course-selections/${selectionId}/`, {
    method: 'DELETE',
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
}

// ——— Hodim: katalog va tanlov ———

export async function fetchCourseSyllabusCatalog(): Promise<CourseSyllabusRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<CourseSyllabusRow[] | PagedResponse<CourseSyllabusRow>>(
    // `slim=1` — mavzu NOMLARI kerak emas, faqat soni (`topic_count`).
    // To'liq javob 4.4 MB edi va uni har o'qituvchi birinchi kirishida
    // yuklab olardi.
    `${apiBaseUrl()}/v1/course-syllabuses/catalog/?page_size=1000&slim=1`,
    {
      headers: authHeaders(token),
      timeoutMs: 60000,
    },
  );
  return unwrapPagedResults(data);
}

/** Sahifa ochilganda App, SyllabusView va UserProfile bir vaqtda shu ro'yxatni
 * so'raydi — javob esa ~250 KB. Bir vaqtda ketayotgan so'rovlar bittaga
 * birlashtiriladi (kesh emas: so'rov tugagach dedupe bekor qilinadi, shuning
 * uchun fanlar o'zgartirilgandan keyin keyingi chaqiruv yangi ma'lumot oladi). */
let inFlightMySelections: Promise<StaffCourseSelectionRow[]> | null = null;

export function fetchMyCourseSelections(): Promise<StaffCourseSelectionRow[]> {
  if (!inFlightMySelections) {
    inFlightMySelections = doFetchMyCourseSelections().finally(() => {
      inFlightMySelections = null;
    });
  }
  return inFlightMySelections;
}

async function doFetchMyCourseSelections(): Promise<StaffCourseSelectionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const rows = await httpJson<StaffCourseSelectionRow[]>(`${apiBaseUrl()}/v1/course-syllabuses/my/`, {
    headers: authHeaders(token),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

/** Xodim kafedrasidagi fanlar (onboarding / profile tanlash). */
export async function fetchDepartmentCourseSyllabuses(): Promise<CourseSyllabusRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<CourseSyllabusRow[] | PagedResponse<CourseSyllabusRow>>(
    `${apiBaseUrl()}/v1/course-syllabuses/department/?page_size=1000`,
    {
      headers: authHeaders(token),
      timeoutMs: 60000,
    },
  );
  return unwrapPagedResults(data);
}

/** O'qitadigan fanlar to'plamini almashtirish. Bo'sh ro'yxat ham mumkin — tanlash majburiy emas. */
export async function setMyTeachingSubjects(syllabusIds: number[]): Promise<StaffCourseSelectionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const rows = await httpJson<StaffCourseSelectionRow[]>(`${apiBaseUrl()}/v1/course-syllabuses/my/`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: { syllabus_ids: syllabusIds },
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

/** O'qituvchi namuna Excel'idan o'z fanini yaratadi (faqat o'ziga ko'rinadi). */
export async function createOwnSyllabus(payload: {
  subjectName: string;
  fileName: string;
  instructionLanguage: AppLanguage;
  topics: Array<{ title: string; type: string }>;
}): Promise<StaffCourseSelectionRow> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<StaffCourseSelectionRow>(`${apiBaseUrl()}/v1/course-syllabuses/own/`, {
    method: 'POST',
    headers: authHeaders(token),
    body: {
      subject_name: payload.subjectName,
      file_name: payload.fileName,
      instruction_language: payload.instructionLanguage,
      topics: payload.topics,
    },
    timeoutMs: 30000,
  });
}

export type OwnSyllabusUpdateStats = {
  added?: number;
  removed?: number;
  kept_with_material?: number;
  total?: number;
};

/** O'z fanini tahrirlash: nom, til yoki yangi Excel (mavzular kodini saqlab birlashtiriladi). */
export async function updateOwnSyllabus(
  syllabusId: number,
  payload: {
    subjectName?: string;
    instructionLanguage?: AppLanguage;
    fileName?: string;
    topics?: Array<{ title: string; type: string }>;
  },
): Promise<{ syllabus: CourseSyllabusRow; stats: OwnSyllabusUpdateStats }> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const body: Record<string, unknown> = {};
  if (payload.subjectName !== undefined) body.subject_name = payload.subjectName;
  if (payload.instructionLanguage !== undefined) body.instruction_language = payload.instructionLanguage;
  if (payload.fileName) body.file_name = payload.fileName;
  if (payload.topics) body.topics = payload.topics;
  return httpJson(`${apiBaseUrl()}/v1/course-syllabuses/own/${Number(syllabusId)}/`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body,
    timeoutMs: 30000,
  });
}

/** O'zi yuklagan fanni o'chirish (server yashiradi, materiallar saqlanadi). */
export async function deleteOwnSyllabus(syllabusId: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/course-syllabuses/own/${Number(syllabusId)}/`, {
    method: 'DELETE',
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
}

export async function selectCourseSyllabus(syllabusId: number): Promise<StaffCourseSelectionRow> {
  const rows = await setMyTeachingSubjects([syllabusId]);
  if (!rows[0]) throw new Error('select-failed');
  return rows[0];
}

export async function unselectCourseSyllabus(_syllabusId: number): Promise<void> {
  throw new Error('Use setMyTeachingSubjects to update teaching subjects.');
}

export function isSyncUnavailable(err: unknown): boolean {
  if (err instanceof HttpError && (err.status === 401 || err.status === 403)) return true;
  return false;
}
