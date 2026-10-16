/**
 * Rektor hisobotining TALABALAR sahifasi — server bilan aloqa (2026-10-15).
 *
 * Yo'llar `/rector/students-report/...`; dekan cheklovi serverda
 * qo'llanadi, bu yerda hech narsa yashirilmaydi.
 */
import { get } from './rectorApi';

export type StudentFilters = {
  faculties: string[];
  groups: string[];
  courses: number[];
  subjects: { code: string; name: string }[];
  groups_by_faculty: Record<string, string[]>;
  students_total: number;
};

export type StudentRow = {
  student_id: string;
  student_key: string;
  full_name: string;
  group_name: string;
  course: number | null;
  faculty: string;
  direction: string;
  attempts: number;
  subjects: number;
  days: number;
  percent: number | null;
  /** 5 ballik baho (86+ — 5, 71+ — 4, 55+ — 3, qolgani — 2). */
  grade?: number | null;
  minutes: number;
  last_at: string | null;
};

export type StudentsReport = {
  from: string;
  to: string;
  headline: {
    students: number;
    took_test: number;
    never: number;
    attempts: number;
    percent: number | null;
  };
  students: StudentRow[];
};

export type LessonInfo = {
  para?: string;
  start_time?: string;
  group_name?: string;
  subject_name?: string;
  auditorium?: string;
  building?: string;
  department?: string;
};

export type StudentAttempt = {
  id: number;
  date: string;
  submitted_at: string;
  subject_code: string;
  subject_name: string;
  topic: string;
  variant: string;
  teacher_key: string;
  teacher_name: string;
  score: number;
  total: number;
  percent: number | null;
  minutes: number;
  too_fast: boolean;
  lesson: LessonInfo;
};

export type StudentAttempts = {
  student: {
    student_id: string;
    full_name: string;
    group_name: string;
    course: number | null;
    faculty: string;
    direction: string;
  };
  from: string;
  to: string;
  attempts: StudentAttempt[];
};

export type AttemptQuestion = {
  index: number;
  question: string;
  options: string[];
  selected_index: number | null;
  correct_index: number | null;
  is_correct: boolean;
  skipped: boolean;
  explanation: string;
};

export type AttemptDetail = {
  id: number;
  student: { student_id: string; full_name: string; group_name: string; course: number | null; faculty: string };
  date: string;
  submitted_at: string;
  started_at: string | null;
  subject_code: string;
  topic: string;
  variant: string;
  teacher_key: string;
  teacher_name: string;
  score: number;
  total: number;
  percent: number | null;
  minutes: number;
  too_fast: boolean;
  lesson: LessonInfo;
  questions: AttemptQuestion[];
  events: { type: string; question_index: number | null; at: string | null }[];
};

export type Summary = {
  students: number;
  took: number;
  coverage: number;
  attempts: number;
  percent: number | null;
};

/** Rahbariyat tahlili (2026-10-15): ro'yxat bilan bir xil filtr. */
export type StudentsOverview = {
  from: string;
  to: string;
  headline: Summary & {
    never: number;
    grade: number | null;
    tests: number;
    teachers: number;
    at_risk: number;
    /** Faqat shu davrda darsi bo'lgan guruhlar talabalari. */
    in_class: Summary;
  };
  previous: { from: string; to: string; took: number; coverage: number; attempts: number; percent: number | null };
  daily: { date: string; attempts: number; students: number; percent: number | null }[];
  distribution: { grade: number; label: string; from: number; students: number }[];
  by_course: (Summary & { course: number })[];
  by_faculty: (Summary & { faculty: string })[];
  /** Kafedra qaysi guruhlarga dars o'tgan bo'lsa — o'sha kesim (2026-10-15). */
  by_department?: (Summary & { department: string; groups: number; teachers: number })[];
  groups: (Summary & { group: string; faculty: string; course: number | null; lessons: number })[];
  at_risk: {
    student_key: string;
    full_name: string;
    group_name: string;
    course: number | null;
    attempts: number;
    percent: number;
  }[];
  integrity: {
    attempts: number;
    fast: { attempts: number; students: number; seconds_per_question: number };
    away: { attempts: number; students: number; seconds: number };
    copy: {
      groups: number;
      students: number;
      items: {
        date: string;
        topic: string;
        teacher_key: string;
        teacher_name: string;
        size: number;
        students: { student_key: string; full_name: string; group_name: string; percent: number | null }[];
      }[];
    };
  };
  teachers: {
    teacher_key: string;
    teacher_name: string;
    department: string;
    tests: number;
    students: number;
    attempts: number;
    percent: number | null;
    participation: number | null;
    low_participation: number;
    flagged_percent: number;
  }[];
  rules: { risk_attempts: number; risk_percent: number };
  /** Talabalar doirasi: monitorli darslar yoki hammasi (2026-10-15). */
  scope?: { kind: StudentScope; department: string; groups: number | null; teachers: number | null };
};

/**
 * "monitor" — faqat monitorli xonada dars o'tgan o'qituvchilarning
 * talabalari va o'sha o'qituvchilar o'tkazgan testlar (asosiy, rektor
 * talabi); "all" — butun kontingent.
 */
export type StudentScope = 'monitor' | 'all';

function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    q.set(key, String(value));
  }
  return q.toString();
}

export function fetchStudentFilters(): Promise<StudentFilters> {
  return get('/students-report/filters/');
}

export function fetchStudents(params: {
  from: string;
  to: string;
  faculty?: string;
  group?: string;
  course?: number | null;
  subject_code?: string;
  q?: string;
  scope?: StudentScope;
  department?: string;
}): Promise<StudentsReport> {
  return get(`/students-report/?${query(params)}`);
}

export function fetchStudentAttempts(
  studentKey: string,
  params: { from: string; to: string; scope?: StudentScope; department?: string },
): Promise<StudentAttempts> {
  return get(`/students-report/${encodeURIComponent(studentKey)}/attempts/?${query(params)}`);
}

export function fetchAttemptDetail(attemptId: number): Promise<AttemptDetail> {
  return get(`/students-report/attempt/${attemptId}/`);
}

export function fetchStudentsOverview(params: {
  from: string;
  to: string;
  faculty?: string;
  group?: string;
  course?: number | null;
  subject_code?: string;
  scope?: StudentScope;
  department?: string;
}): Promise<StudentsOverview> {
  return get(`/students-report/overview/?${query(params)}`);
}

/** Haftalar bo'yicha talabalar qamrovi va natijasi (2026-10-15). */
export type StudentsTrend = {
  from: string;
  to: string;
  weeks: Array<{
    week_start: string;
    week_end: string;
    students: number;
    took: number;
    coverage: number | null;
    attempts: number;
    percent: number | null;
  }>;
};

export function fetchStudentsTrend(params: {
  to: string;
  faculty?: string;
  group?: string;
  course?: number | null;
  subject_code?: string;
  scope?: StudentScope;
  department?: string;
  weeks?: number;
}): Promise<StudentsTrend> {
  return get(`/students-report/trend/?${query(params)}`);
}
