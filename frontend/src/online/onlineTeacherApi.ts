/** Online portal — o'qituvchi API mijozi. */

import { httpJson } from '../api/httpClient';
import { authHeader } from './onlineAuth';
import type { Program } from './program';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function call<T>(path: string, init?: { method?: Method; body?: unknown }): Promise<T> {
  return httpJson<T>(`${apiBaseUrl()}/v1/online${path}`, {
    method: init?.method || 'GET',
    body: init?.body as never,
    headers: authHeader(),
  });
}

export const MATERIAL_KINDS = [
  'lecture',
  'presentation',
  'video',
  'handout',
  'case',
  'test',
  // Malaka oshirishdagi amaliy mashg'ulot — o'qituvchi yuklagan test.
  'practical',
] as const;

export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const KIND_LABEL: Record<MaterialKind, string> = {
  lecture: "Ma'ruza matni",
  presentation: 'Taqdimot',
  video: 'Video dars',
  handout: 'Tarqatma material',
  case: 'Vaziyatli masala',
  test: '10 ta test',
  practical: "Amaliy mashg'ulot",
};

/**
 * Dastur bo'yicha material turlari va ularning tartibi.
 *
 * Malakada vaziyatli masala va tarqatma yo'q, amaliy mashg'ulot bor.
 * Server ham shu ro'yxat bo'yicha tekshiradi (`PROGRAM_KINDS`).
 */
export const PROGRAM_KINDS: Record<Program, MaterialKind[]> = {
  online: ['lecture', 'presentation', 'video', 'handout', 'case', 'test'],
  malaka: ['lecture', 'presentation', 'video', 'practical', 'test'],
};

export function kindsFor(program: Program): MaterialKind[] {
  return PROGRAM_KINDS[program] || PROGRAM_KINDS.online;
}

/** Tur nomi. Malakada test soni belgilanmagan — shunchaki "Test". */
export function kindLabel(kind: MaterialKind, program: Program): string {
  if (program === 'malaka' && kind === 'test') return 'Test';
  return KIND_LABEL[kind];
}

export type TeacherCourse = {
  syllabus_id: number;
  subject_name: string;
  /** RAG uchun: server shu kod orqali fanning kafedrasini topadi. */
  subject_code: string;
  department_name: string;
  variant_label: string;
  topic_count: number;
  instruction_language: string;
  /** "online" | "malaka". */
  program?: Program;
};

export type TeacherMe = {
  is_online_teacher: boolean;
  full_name?: string;
  courses: TeacherCourse[];
};

export type TeacherTopic = {
  code: string;
  title: string;
  type: string;
  has: Record<MaterialKind, boolean>;
  ready: number;
};

export type Material = {
  id: number;
  syllabus_id: number;
  variant_label: string;
  topic_code: string;
  kind: MaterialKind;
  title: string;
  language: string;
  payload: Record<string, unknown>;
  file: string;
  file_name: string;
  file_size: number;
  external_url: string;
  author_name: string;
  created_at: string;
  updated_at: string;
};

export function fetchTeacherMe(program?: Program): Promise<TeacherMe> {
  // Portal faqat o'z dasturining fanlarini so'raydi: malaka fani
  // onlinetalim'da, online fan esa malaka portalida ko'rinmasin.
  return call(program ? `/teacher/me/?program=${program}` : '/teacher/me/');
}

export type CatalogSubject = {
  syllabus_id: number;
  subject_name: string;
  department_name: string;
  variants: Array<{ label: string; topic_count: number; mine: boolean }>;
};

/** O'qituvchi o'zi tanlay oladigan fanlar. */
export function fetchCatalog(program: Program): Promise<CatalogSubject[]> {
  return call(`/teacher/catalog/?program=${program}`);
}

export function takeCourse(syllabusId: number, variantLabel: string): Promise<{ created: boolean }> {
  return call('/teacher/courses/', {
    method: 'POST',
    body: { syllabus_id: syllabusId, variant_label: variantLabel },
  });
}

export function leaveCourse(syllabusId: number, variantLabel: string): Promise<void> {
  const q = new URLSearchParams({ syllabus_id: String(syllabusId), variant_label: variantLabel });
  return call(`/teacher/courses/?${q}`, { method: 'DELETE' });
}

export function fetchTeacherTopics(
  syllabusId: number,
  variantLabel: string,
): Promise<TeacherTopic[]> {
  const q = new URLSearchParams({
    syllabus_id: String(syllabusId),
    variant_label: variantLabel,
  });
  return call(`/teacher/topics/?${q}`);
}

export function fetchMaterials(
  syllabusId: number,
  variantLabel: string,
  topicCode: string,
): Promise<Material[]> {
  const q = new URLSearchParams({
    syllabus_id: String(syllabusId),
    variant_label: variantLabel,
    topic_code: topicCode,
  });
  return call(`/teacher/materials/?${q}`);
}

export function saveMaterial(body: {
  /** Berilsa — aynan shu yozuv yangilanadi (video ro'yxatidagi bittasi). */
  material_id?: number;
  syllabus_id: number;
  variant_label: string;
  topic_code: string;
  kind: MaterialKind;
  title?: string;
  language?: string;
  payload?: Record<string, unknown>;
  external_url?: string;
}): Promise<Material> {
  return call('/teacher/materials/', { method: 'POST', body });
}

export function deleteMaterial(id: number): Promise<void> {
  return call(`/teacher/materials/${id}/`, { method: 'DELETE' });
}

/** Fayl yuklash — `multipart/form-data`, shuning uchun `fetch` to'g'ridan-to'g'ri. */
export async function uploadMaterial(
  file: File,
  meta: {
    syllabus_id: number;
    variant_label: string;
    topic_code: string;
    kind: 'handout' | 'presentation';
    title?: string;
    language?: string;
  },
): Promise<Material> {
  const form = new FormData();
  form.append('file', file);
  form.append('syllabus_id', String(meta.syllabus_id));
  form.append('variant_label', meta.variant_label);
  form.append('topic_code', meta.topic_code);
  form.append('kind', meta.kind);
  form.append('title', meta.title || '');
  form.append('language', meta.language || 'uz');

  const res = await fetch(`${apiBaseUrl()}/v1/online/teacher/materials/upload/`, {
    method: 'POST',
    headers: authHeader(),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail || text;
    } catch {
      /* matn shaklida qoldiramiz */
    }
    throw new Error(detail || `Yuklash xatosi (${res.status})`);
  }
  return JSON.parse(text) as Material;
}

/** Guruhdagi talabalar — davomat belgilashda ro'yxatdan tanlash uchun. */
export type GroupStudent = { student_id: string; student_name: string };

export function fetchGroupStudents(groupId: number): Promise<GroupStudent[]> {
  return call(`/teacher/group-students/?group_id=${groupId}`);
}

export type StudentTopicProgress = {
  topic_code: string;
  topic_title: string;
  viewed: Record<string, boolean>;
  test_score: number | null;
  test_total: number | null;
  test_submitted_at: string | null;
  case_answer: string;
  /* Mavzu bahosi — test va vaziyatli masalaning o'rtachasi. */
  test_percent: number | null;
  case_percent: number | null;
  grade: number | null;
  test_done: boolean;
  case_done: boolean;
};

export type StudentProgress = {
  student_id: string;
  student_name: string;
  group_name: string;
  topics: StudentTopicProgress[];
  tests_taken: number;
  cases_taken: number;
  score_sum: number;
  score_total: number;
  /** Faqat testlar bo'yicha foiz. */
  percent: number | null;
  /** Yakuniy o'rtacha baho — test va masala o'rtachalaridan. */
  average_grade: number | null;
  graded_count: number;
};

export type ProgressReport = {
  subject_name: string;
  topic_count: number;
  students: StudentProgress[];
};

export function fetchTeacherProgress(
  syllabusId: number,
  variantLabel: string,
  groupId?: number,
): Promise<ProgressReport> {
  const q = new URLSearchParams({
    syllabus_id: String(syllabusId),
    variant_label: variantLabel,
  });
  if (groupId) q.set('group_id', String(groupId));
  return call(`/teacher/progress/?${q}`);
}
