/**
 * Nazorat panelini haqiqiy shakldagi namuna ma'lumot bilan ko'rish (dizayn tekshiruvi).
 * Faqat harness uchun — ilovaga kirmaydi.
 */
import { ControlReportView } from '../rector/ControlReport';
import type { ControlReport as Report, ControlStudents } from '../rector/rectorApi';

const REPORT: Report = {
  from: '2026-09-21',
  to: '2026-09-26',
  headline: {
    monitor_lessons: 2191, monitor_used: 302, monitor_percent: 14, band: 'bad',
    watched_teachers: 239, idle_teachers: 127,
    other_lessons: 3400, other_used: 86, other_percent: 3,
    unlinked_teachers: 82, total_lessons: 5591, blamed_teachers: 3, check_room_teachers: 1,
  },
  source: {
    synced_at: '2026-09-26T06:47:00+05:00', lessons: 5591, teachers: 321,
    unlinked_teachers: 82, rooms_without_monitor: 74,
  },
  room_summary: { rooms: 100, ok: 61, suspect: 12, quiet: 27, suspect_lessons: 214 },
  rooms: [
    { monitor_id: 'MON-014', room: 'Asosiy (3-bino) 26-xona', department: 'Fiziologiya', hemis_rooms: ['26', '26 (3-bino)'], building: '3-o‘quv bino', lessons: 24, used: 0, percent: 0, teachers: 6, used_teachers: 0, departments: ['Fiziologiya'], last_used: null, status: 'suspect', status_label: 'tekshirish kerak' },
    { monitor_id: 'MON-031', room: 'Oq uy 2 qavat 204-xona', department: 'Pediatriya', hemis_rooms: ['204 (Oq uy)'], building: 'Oq uy binosi', lessons: 18, used: 0, percent: 0, teachers: 4, used_teachers: 0, departments: ['Pediatriya'], last_used: null, status: 'suspect', status_label: 'tekshirish kerak' },
    { monitor_id: 'MON-007', room: 'Asosiy (2-bino) 308-xona', department: 'Tibbiy va biologik kimyo', hemis_rooms: ['308'], building: '2- o‘quv bino', lessons: 31, used: 27, percent: 87, teachers: 5, used_teachers: 4, departments: ['Tibbiy va biologik kimyo'], last_used: '2026-09-25', status: 'ok', status_label: 'ishlayapti' },
    { monitor_id: 'MON-052', room: 'Vivariy 3-xona', department: 'Gistologiya', hemis_rooms: ['3 (Vivariy)'], building: 'Vivariy (laboratoriya) binosi', lessons: 3, used: 0, percent: 0, teachers: 1, used_teachers: 0, departments: ['Gistologiya'], last_used: null, status: 'quiet', status_label: "ma'lumot kam" },
  ],
  attention: [
    { teacher_key: 'a', teacher_name: 'MADRAXIMOVA N. R.', department: 'Yu. Nishonov nomidagi Normal anatomiya', monitor_lessons: 29, days: 5, rooms: ['1-xona', "201-xona Ma'ruza"], other_used: 0, other_lessons: 4  , employee_id: '461', proven_lessons: 4, excuse: 'none' },
    { teacher_key: 'b', teacher_name: 'MAXMUDOVA M. A.', department: 'Fakultativ terapiya (UASH)', monitor_lessons: 24, days: 4, rooms: ['S29-xona', 'S30-xona'], other_used: 2, other_lessons: 9 , employee_id: '461', proven_lessons: 4, excuse: 'none' },
    { teacher_key: 'c', teacher_name: 'ALIMOVA I. A.', department: 'Pediatriya', monitor_lessons: 24, days: 5, rooms: ['S29-xona'], other_used: 0, other_lessons: 0 , employee_id: '461', proven_lessons: 4, excuse: 'none' },
    { teacher_key: 'd', teacher_name: 'UMAROV SH. U.', department: 'Ijtimoiy fanlar', monitor_lessons: 23, days: 5, rooms: ["201-xona Ma'ruza"], other_used: 0, other_lessons: 6 , employee_id: '461', proven_lessons: 4, excuse: 'none' },
  ],
  check_room: [
    { teacher_key: 'g', teacher_name: 'TOSHMATOV Q. Q.', employee_id: '803', department: 'Gistologiya', monitor_lessons: 12, days: 4, rooms: ['26-xona'], other_used: 0, other_lessons: 2, proven_lessons: 0, excuse: 'check_room' },
  ],
  daily: [
    { date: '2026-09-21', weekday: 'Dushanba', lessons: 427, used: 50, percent: 12 },
    { date: '2026-09-22', weekday: 'Seshanba', lessons: 470, used: 49, percent: 10 },
    { date: '2026-09-23', weekday: 'Chorshanba', lessons: 426, used: 55, percent: 13 },
    { date: '2026-09-24', weekday: 'Payshanba', lessons: 427, used: 72, percent: 17 },
    { date: '2026-09-25', weekday: 'Juma', lessons: 429, used: 76, percent: 18 },
    { date: '2026-09-26', weekday: 'Shanba', lessons: 12, used: 0, percent: 0 },
  ],
  departments: [
    { department: "O'zbek va xorijiy tillar", monitor_lessons: 113, monitor_used: 0, percent: 0, band: 'bad', teachers: 11, active_teachers: 0, other_lessons: 24 },
    { department: 'Pediatriya', monitor_lessons: 64, monitor_used: 0, percent: 0, band: 'bad', teachers: 6, active_teachers: 0, other_lessons: 140 },
    { department: 'Tibbiy va biologik kimyo', monitor_lessons: 246, monitor_used: 104, percent: 42, band: 'warn', teachers: 16, active_teachers: 10, other_lessons: 31 },
    { department: 'Stomatologiya va otoloringologiya', monitor_lessons: 8, monitor_used: 4, percent: 50, band: 'warn', teachers: 3, active_teachers: 1, other_lessons: 92 },
    { department: 'Fiziologiya', monitor_lessons: 120, monitor_used: 92, percent: 77, band: 'good', teachers: 9, active_teachers: 7, other_lessons: 12 },
  ],
  quality: { minutes: 1840, worked: 64, viewed: 39, visit: 28, never: 108, no_subject: 51, profile_incomplete: 173, teachers: 239 },
  modules: [
    { page: 'tests', label: 'Test', minutes: 620, opens: 410, people: 88 },
    { page: 'cases', label: 'Keys (vaziyatli masala)', minutes: 385, opens: 233, people: 54 },
    { page: 'lectures', label: "Ma'ruza matni", minutes: 300, opens: 190, people: 47 },
    { page: 'handouts', label: 'Tarqatma', minutes: 210, opens: 175, people: 61 },
    { page: 'presentation', label: 'Taqdimot', minutes: 180, opens: 98, people: 33 },
    { page: 'videos', label: 'Video', minutes: 95, opens: 120, people: 40 },
    { page: 'profile', label: 'Profil', minutes: 50, opens: 210, people: 96 },
  ],
  created: { tests: 128, cases: 74, lectures: 21, presentations: 33, handouts: 56, videos: 12, live_sessions: 204 },
  created_labels: { tests: 'Test', cases: 'Keys', lectures: "Ma'ruza", presentations: 'Taqdimot', handouts: 'Tarqatma', videos: 'Video', live_sessions: 'Jonli test' },
  teachers: [
    { teacher_key: 'a', teacher_name: 'MADRAXIMOVA N. R.', employee_id: '461', linked: true, department: 'Yu. Nishonov nomidagi Normal anatomiya', monitor_lessons: 29, monitor_used: 0, monitor_percent: 0, band: 'bad', other_lessons: 4, other_used: 0, lessons: 33, students: 0, days: 5, rooms: ['1-xona'], last_used: null, proven_lessons: 9, excuse: 'none', minutes: 0, active_days: 0, created: {tests: 0, cases: 0, lectures: 0, presentations: 0, handouts: 0, videos: 0, live_sessions: 0}, created_total: 0, top_module: '', depth: 'none', profile_percent: 40, profile_missing: ['Surat', 'Lavozim', 'Yuz ro‘yxatda'], subjects_linked: 1, material_percent: 12, material_topics: 42, material_empty: 37 },
    { teacher_key: 'e', teacher_name: 'NAZAROVA Y. X.', employee_id: '512', linked: true, department: 'Tibbiy va biologik kimyo', monitor_lessons: 22, monitor_used: 21, monitor_percent: 95, band: 'good', other_lessons: 2, other_used: 1, lessons: 24, students: 218, days: 5, rooms: ['308-xona'], last_used: '2026-09-25', proven_lessons: 22, excuse: 'none', minutes: 214, active_days: 5, created: {tests: 9, cases: 4, lectures: 2, presentations: 3, handouts: 6, videos: 1, live_sessions: 12}, created_total: 37, top_module: 'Test', depth: 'worked', profile_percent: 100, profile_missing: [], subjects_linked: 3, material_percent: 88, material_topics: 60, material_empty: 7 },
    { teacher_key: 'f', teacher_name: 'MAMASOLIYEVA N. X.', employee_id: '77', linked: true, department: 'Fiziologiya', monitor_lessons: 17, monitor_used: 11, monitor_percent: 65, band: 'warn', other_lessons: 0, other_used: 0, lessons: 17, students: 21, days: 4, rooms: ['26-xona'], last_used: '2026-09-24', proven_lessons: 17, excuse: 'none', minutes: 31, active_days: 3, created: {tests: 0, cases: 0, lectures: 0, presentations: 0, handouts: 0, videos: 0, live_sessions: 0}, created_total: 0, top_module: 'Materiallar katalogi', depth: 'viewed', profile_percent: 80, profile_missing: ['Surat'], subjects_linked: 2, material_percent: 55, material_topics: 38, material_empty: 17 },
    { teacher_key: '', teacher_name: 'XOLMATOV B. T.', employee_id: '901', linked: false, department: 'Urologiya va onkologiya', monitor_lessons: 12, monitor_used: 0, monitor_percent: 0, band: 'none', other_lessons: 8, other_used: 0, lessons: 20, students: 0, days: 5, rooms: ['S29-xona'], last_used: null, proven_lessons: 9, excuse: 'none', minutes: 0, active_days: 0, created: {tests: 0, cases: 0, lectures: 0, presentations: 0, handouts: 0, videos: 0, live_sessions: 0}, created_total: 0, top_module: '', depth: 'none', profile_percent: null, profile_missing: [], subjects_linked: 0, material_percent: null, material_topics: 0, material_empty: 0 },
  ],
};

const STUDENTS: ControlStudents = {
  from: '2026-09-21',
  to: '2026-09-26',
  students: [
    { student_key: '344251100387', name: 'ABDURASULOVA SALIMAXON', group: 'DI-2825', course: 1, faculty: 'Davolash ishi fakulteti', in_contingent: true, attempts: 4, avg_score: 72 },
    { student_key: '344251300221', name: 'XAYDAROVA XALIMAXON', group: 'Pediatriya-25 (ordinatura)', course: 1, faculty: 'Pediatriya fakulteti', in_contingent: true, attempts: 0, avg_score: 0 },
  ],
  totals: { contingent: 7053, tested: 1150, matched_to_contingent: 1089, attempts: 2119, avg_score: 60, coverage: 15, groups_active: 103, groups_total: 562 },
  groups: [
    { group: 'P-5025', tested_students: 15, group_size: 15, coverage: 100, attempts: 61, avg_score: 82 },
    { group: 'S-6025', tested_students: 17, group_size: 17, coverage: 100, attempts: 58, avg_score: 67 },
    { group: 'P-5225', tested_students: 16, group_size: 16, coverage: 100, attempts: 55, avg_score: 57 },
    { group: 'DI-4124', tested_students: 9, group_size: 21, coverage: 43, attempts: 18, avg_score: 41 },
  ],
};


export default function ControlPreview() {
  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <ControlReportView data={REPORT} students={STUDENTS} />
    </div>
  );
}
