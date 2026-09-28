/**
 * Dizaynni ko'z bilan tekshirish uchun sahifa. Ishlab chiqarishga KIRMAYDI —
 * `harness.html` faqat `npm run dev` da ochiladi, `vite build` uni yig'maydi.
 *
 * Nima uchun kerak: o'qituvchi sahifalarini ko'rish uchun tizimga kirish
 * shart, kirish esa parol talab qiladi. Shu sabab dizayn o'zgarishlari
 * ko'r-ko'rona qilinardi va har safar foydalanuvchi "hali ham hunuk" deb
 * qaytarardi. Bu sahifa HAQIQIY komponentlarni haqiqiy uslublar bilan,
 * lekin soxta ma'lumot ustida chizadi: server ham, parol ham kerak emas.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import {
  AppLanguageContext,
  AppNavigationContext,
  GlobalLectureContext,
  GlobalTopicContext,
} from '../App';
import type { SyllabusTopicContext } from '../utils/syllabusTopicContext';

import LectureNotes from '../components/LectureNotes';
import PresentationMaterials from '../components/PresentationMaterials';
import TopicVideos from '../components/TopicVideos';
import HandoutMaterials from '../components/HandoutMaterials';
import CaseStudies from '../components/CaseStudies';
import TestQuestions from '../components/TestQuestions';
import UserProfile from '../components/UserProfile';
import TeacherSettings from '../components/settings/TeacherSettings';
import ControlPreview from './controlPreview';
import StaffTeachingSubjectsPicker from '../components/staff/StaffTeachingSubjectsPicker';

/* ── Soxta server ────────────────────────────────────────────────────────
 * Har so'rovga bo'sh, lekin TO'G'RI SHAKLDAGI javob qaytaradi. Shunda
 * sahifalar "yuklanmoqda" holatida qotib qolmaydi va bo'sh holatlarini
 * ko'rsatadi — aynan shu holatlar dizaynda eng ko'p muammo tug'diradi.
 */
const ACTIVITY_PAGES = (...v: Array<[string, number, number]>) =>
  v.map(([page, minutes, opens]) => ({ page, minutes, seconds: minutes * 60, opens }));

const ACTIVITY_OVERVIEW = {
  from: '2026-09-09',
  to: '2026-09-09',
  total: 3,
  totals: {
    minutes: 412,
    videos_viewed: 14,
    handouts_viewed: 9,
    cases_created: 3,
    tests_created: 5,
    active_teachers: 3,
  },
  teachers: [
    {
      owner_key: '998901112233', display_name: 'Aziza Karimova',
      department: 'Epidemiologiya kafedrasi', minutes: 214, active_days: 1,
      pages: ACTIVITY_PAGES(['syllabus', 24, 6], ['lectures', 78, 4], ['tests', 62, 3], ['videos', 30, 5], ['handouts', 20, 4]),
      videos_viewed: 8, handouts_viewed: 5, cases_created: 2, tests_created: 3, live_sessions: 1,
    },
    {
      owner_key: '998905633006', display_name: "Sardor To'rayev",
      department: 'Yuqumli kasalliklar kafedrasi', minutes: 141, active_days: 1,
      pages: ACTIVITY_PAGES(['presentation', 69, 3], ['syllabus', 31, 8], ['cases', 25, 2], ['lectures', 16, 2]),
      videos_viewed: 6, handouts_viewed: 4, cases_created: 1, tests_created: 2, live_sessions: 0,
    },
    {
      owner_key: '998916785301', display_name: 'Nodira Yusupova',
      department: 'Terapiya kafedrasi', minutes: 57, active_days: 1,
      pages: ACTIVITY_PAGES(['syllabus', 57, 2]),
      videos_viewed: 0, handouts_viewed: 0, cases_created: 0, tests_created: 0, live_sessions: 0,
    },
  ],
};

const ACTIVITY_DETAIL = {
  owner_key: '998901112233', display_name: 'Aziza Karimova',
  department: 'Epidemiologiya kafedrasi', from: '2026-09-03', to: '2026-09-09',
  total_minutes: 214,
  pages: ACTIVITY_OVERVIEW.teachers[0].pages,
  videos_viewed: 8, handouts_viewed: 5, cases_created: 2, tests_created: 3, live_sessions: 1,
  days: [
    { date: '2026-09-09', minutes: 132, pages: ACTIVITY_PAGES(['lectures', 78, 4], ['tests', 34, 2], ['syllabus', 20, 5]),
      videos_viewed: 5, handouts_viewed: 3, cases_created: 1, tests_created: 2, live_sessions: 1 },
    { date: '2026-09-08', minutes: 82, pages: ACTIVITY_PAGES(['videos', 30, 5], ['tests', 28, 1], ['handouts', 20, 4], ['syllabus', 4, 1]),
      videos_viewed: 3, handouts_viewed: 2, cases_created: 1, tests_created: 1, live_sessions: 0 },
  ],
};

const CATALOG_ROW = (id: number, name: string, dept: string, topics: number) => ({
  id, subject_name: name, subject_code: `fan-${id}`, description: '', file_name: '',
  topics: [], variants: [], topic_count: topics, sort_order: 0, is_active: true,
  created_at: '', updated_at: '', department: null, department_name: dept,
  instruction_language: 'uz',
});
const CATALOG = {
  count: 4,
  results: [
    CATALOG_ROW(101, 'Epidemiologiya 10-s TPI', 'Epidemiologiya va yuqumli kasalliklar', 23),
    CATALOG_ROW(102, 'Pediatriya ishi 2021-2022 (Milliy) 9-semestr', 'Epidemiologiya va yuqumli kasalliklar', 19),
    CATALOG_ROW(103, 'Yuqumli kasalliklar. Bolalar yuqumli kasalliklari', 'Epidemiologiya va yuqumli kasalliklar', 21),
    CATALOG_ROW(104, 'Tibbiy profilaktika ishi 2021-2022 (Milliy)', 'Epidemiologiya va yuqumli kasalliklar', 36),
  ],
};

const FIXTURES: Array<[RegExp, unknown]> = [
  [/staff\/me\/profile/, {
    login: '3442112018', first_name: 'Farog‘at', last_name: 'Melibayeva', job_title: 'assistent', faculty: '',
    department_id: 2, department: 'Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari',
    face_linked: false, pinfl_linked: true,
  }],
  [/staff\/departments/, [
    { id: 2, name: 'Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari' },
    { id: 5, name: 'Epidemiologiya va yuqumli kasalliklar hamshiralik ishi' },
  ]],
  [/staff\/library/, {
    department: 'Epidemiologiya va yuqumli kasalliklar hamshiralik ishi',
    items: [
      { id: 1, title: '20. Yuqumli / Botulizm / Milliy klinik protokol 2025', kind: 'protocol', status: 'ready', status_note: '', chunk_count: 41, owner_key: '', uploader_name: '', can_delete: false, created_at: null },
      { id: 2, title: 'Dalillarga asoslangan tibbiyot — o‘quv qo‘llanma', kind: 'book', status: 'processing', status_note: '', chunk_count: 0, owner_key: '3442112018', uploader_name: 'Melibayeva Farog‘at', can_delete: true, created_at: null },
      { id: 3, title: '121-buyruq parazitologiya (skaner)', kind: 'protocol', status: 'failed', status_note: 'Matn topilmadi. Skanerlangan PDF bo‘lsa, matnli nusxasini yuklang.', chunk_count: 0, owner_key: '3442112018', uploader_name: 'Melibayeva Farog‘at', can_delete: true, created_at: null },
    ],
  }],
  [/course-syllabuses\/catalog/, CATALOG],
  [/admin\/reports\/activity\/[^/]+\//, ACTIVITY_DETAIL],
  [/admin\/reports\/activity\//, ACTIVITY_OVERVIEW],
  [/prepared-content\/mine/, { count: 0, page: 1, page_size: 100, results: [] }],
  [/handouts/, { count: 0, results: [] }],
  [/topic-videos/, { count: 0, results: [] }],
  [/course-selections|syllabus/, { count: 0, results: [] }],
  [/.*/, { count: 0, results: [] }],
];

window.fetch = (async (input: RequestInfo | URL) => {
  const url = String(typeof input === 'string' ? input : (input as Request).url || input);
  const hit = FIXTURES.find(([re]) => re.test(url));
  return new Response(JSON.stringify(hit ? hit[1] : {}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

/* ── Soxta token ─────────────────────────────────────────────────────────
 * Ba'zi so'rovlar (masalan fanlar katalogi) token bo'lmasa tarmoqqa umuman
 * chiqmaydi va bo'sh qaytadi — sahifa bo'sh holatda qotib qolardi. `fetch`
 * yuqorida soxtalashtirilgan, shuning uchun bu qiymat hech qayerga
 * yuborilmaydi va hech narsani ochmaydi: u faqat "token bor" shartini
 * qanoatlantiradi. */
try {
  localStorage.setItem(
    'salomatlik-backend-jwt-v1',
    JSON.stringify({
      access: 'harness-fixture',
      refresh: '',
      accessExpMs: Date.now() + 365 * 86_400_000,
      role: 'hodim',
    }),
  );
} catch {
  /* xotira yopiq bo'lsa — sahifa tokensiz holatda chiziladi */
}

/* ── Soxta tanlangan mavzu ─────────────────────────────────────────────── */
const TOPIC: SyllabusTopicContext = {
  id: 'M1',
  title:
    "Asosiy epidemiologik tushunchalar. Epidemik jarayon haqidagi ta'limot. " +
    'Epidemiyaga qarshi chora-tadbirlar. Emlash va shoshilinch profilaktika ' +
    'tarkibi va uni tashkillashtirish. Xavfsiz immunoprofilaktika asoslari.',
  type: 'lecture',
  syllabusId: 142,
  subjectName: 'Epidemiologiya 10-s DI',
  subjectCode: 'EPI-10',
  variantLabel: 'asosiy',
  instructionLanguage: 'uz',
  departmentName: 'Epidemiologiya kafedrasi',
} as SyllabusTopicContext;

const PAGES: Array<[string, React.ComponentType]> = [
  ["Ma'ruza matni", LectureNotes],
  ['Taqdimotlar', PresentationMaterials],
  ['Videolar', TopicVideos],
  ['Tarqatma materiallar', HandoutMaterials],
  ['Keys yaratish', CaseStudies],
  ['Test yaratish', TestQuestions],
  ['Profil', UserProfile],
  ['Sozlamalar (o‘qituvchi)', TeacherSettings],
  ['Rektor nazorat paneli', ControlPreview],
  ['Fan tanlash', () => <StaffTeachingSubjectsPicker variant="onboarding" initialSelectedIds={[]} />],
];

function Harness() {
  const [content, setContent] = React.useState('');
  // `?p=3` bilan to'g'ridan-to'g'ri kerakli sahifa ochiladi — tekshirishda
  // har safar tugma bosib yurmaslik uchun.
  const [index, setIndex] = React.useState(() => {
    const p = Number(new URLSearchParams(location.search).get('p'));
    return Number.isInteger(p) && p >= 0 && p < PAGES.length ? p : 0;
  });
  const Page = PAGES[index][1];

  return (
    <AppLanguageContext.Provider value={{ language: ((new URLSearchParams(location.search).get('lang') || 'uz') as 'uz' | 'ru' | 'en'), setLanguage: () => {} }}>
      <AppNavigationContext.Provider value={{ openSyllabus: () => {} }}>
        <GlobalTopicContext.Provider value={TOPIC}>
          <GlobalLectureContext.Provider value={{ content, setContent }}>
            <div className="min-h-[100dvh] bg-[#f4f6fa]">
              <div className="flex flex-wrap gap-1 border-b border-slate-900/10 bg-white px-4 py-2">
                {PAGES.map(([name], i) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                      i === index ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <Page />
            </div>
          </GlobalLectureContext.Provider>
        </GlobalTopicContext.Provider>
      </AppNavigationContext.Provider>
    </AppLanguageContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
