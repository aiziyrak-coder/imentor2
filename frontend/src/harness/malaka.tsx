/**
 * Malaka oshirish portalini ko'z bilan tekshirish uchun sahifa. Ishlab
 * chiqarishga KIRMAYDI — `vite build` faqat `index.html` ni yig'adi.
 *
 * Haqiqiy `OnlineApp` (program="malaka") soxta server ustida chiziladi.
 * Xotiradagi kichik "backend" mavzu qo'shish, test saqlash, urinishlar va
 * kirish testi qulfini serverdagi qoidalar bo'yicha bajaradi — shunda har
 * bir holatni (qulflangan mavzu, 2/4 urinish, javoblar ochilishi) parolsiz
 * va serversiz ko'rish mumkin.
 *
 *   /malaka-harness.html?malaka=1&as=teacher    — o'qituvchi
 *   /malaka-harness.html?malaka=1&as=student    — tinglovchi
 *   /malaka-harness.html?malaka=1&as=pending    — birinchi kirish (parol almashtirish)
 *   /malaka-harness.html?malaka=1&as=login      — kirish oynasi
 *   &entry=done — kirish testi topshirilgan, mavzular ochiq
 */
import { createRoot } from 'react-dom/client';
import '../index.css';
import OnlineApp from '../online/OnlineApp';

type Q = { question: string; options: string[]; correctOptionIndex: number; explanation: string };
type Mat = {
  id: number;
  syllabus_id: number;
  variant_label: string;
  topic_code: string;
  kind: string;
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
type Topic = { code: string; title: string; type: string };
type Attempt = { score: number; total: number; answers: number[]; at: string; no: number };
type Body = Record<string, unknown>;

const params = new URLSearchParams(location.search);
const as = params.get('as') || 'teacher';
const NOW = '2026-09-14T09:00:00Z';

const PED = 7;
const UZI = 8;
const DEPT = 'Malaka oshirish va qayta tayyorlash fakulteti';
const SUBJECT_NAME: Record<number, string> = {
  [PED]: 'Maxsus pedagogika (Tibbiy pedagogika)',
  [UZI]: 'Klinik ultratovush diagnostikasi',
};

const q = (question: string, options: string[], correct = 0, explanation = ''): Q => ({
  question,
  options,
  correctOptionIndex: correct,
  explanation,
});

const TOPIC_TEST: Q[] = [
  q('Tibbiy pedagogikaning asosiy predmeti nima?', [
    'Tibbiyot xodimini o‘qitish va tarbiyalash jarayoni',
    'Kasalliklarni davolash usullari',
    'Shifoxona boshqaruvi',
    'Farmakologik vositalar tasnifi',
  ], 0, 'Tibbiy pedagogika — tibbiyot kadrlarini o‘qitish va tarbiyalash qonuniyatlari haqidagi fan.'),
  q('Klinik fikrlashni rivojlantirishda eng samarali usul qaysi?', [
    'Ma’ruzani yod olish',
    'Vaziyatli masalalar va keys-stadi',
    'Faqat test yechish',
    'Darslikni qayta o‘qish',
  ], 1),
  q('OSKE nima?', [
    'Obyektiv tuzilgan klinik imtihon',
    'Og‘zaki suhbat',
    'Yozma nazorat ishi',
    'Kurs ishi himoyasi',
  ], 0),
  q('Formativ baholash qachon o‘tkaziladi?', [
    'Faqat kurs oxirida',
    'O‘qitish jarayonida — rivojlanishni kuzatish uchun',
    'Faqat qabul imtihonida',
    'Diplom himoyasida',
  ], 1),
];

const PRACTICAL: Q[] = [
  q('Simulyatsion mashg‘ulotda debrifing bosqichining maqsadi nima?', [
    'Harakatlarni tahlil qilish va xulosa chiqarish',
    'Baho qo‘yish',
    'Jihozlarni yig‘ishtirish',
    'Keyingi mavzuni e’lon qilish',
  ], 0),
  q('Standartlashtirilgan bemor (SP) kim?', [
    'O‘qitilgan aktyor yoki ko‘ngilli',
    'Haqiqiy og‘ir bemor',
    'Robot-manekenning o‘zi',
    'Kurator o‘qituvchi',
  ], 0),
  q('Mini-CEX qaysi ko‘nikmani baholaydi?', [
    'Bemor bilan muloqot va klinik ko‘rik',
    'Faqat nazariy bilim',
    'Ilmiy maqola yozish',
    'Laboratoriya tahlili',
  ], 0),
];

const ENTRY: Q[] = [
  q('Pedagogika so‘zining lug‘aviy ma’nosi?', ['Bola yetaklovchi', 'Shifokor', 'Olim', 'Rahbar'], 0),
  q('Didaktika nimani o‘rganadi?', ['Ta’lim nazariyasini', 'Anatomiyani', 'Iqtisodni', 'Huquqni'], 0),
  q('Bloom taksonomiyasining eng yuqori darajasi?', ['Eslab qolish', 'Tushunish', 'Yaratish', 'Qo‘llash'], 2),
  q('Andragogika kimlarni o‘qitish haqida?', ['Kattalarni', 'Maktabgacha yoshdagilarni', 'O‘smirlarni', 'Chaqaloqlarni'], 0),
];

const EXIT: Q[] = ENTRY.map((x) => ({ ...x, question: `${x.question} (yakuniy)` }));

const LECTURE = [
  '## Tibbiy pedagogikaning predmeti',
  '',
  'Tibbiy pedagogika — tibbiyot xodimlarini o‘qitish, tarbiyalash va kasbiy rivojlantirish qonuniyatlarini o‘rganadigan fan. U umumiy pedagogika, psixologiya va klinik fanlar tutashgan joyda turadi.',
  '',
  '### Asosiy vazifalari',
  '',
  '- klinik fikrlashni shakllantirish usullarini ishlab chiqish;',
  '- bemor bilan muloqot ko‘nikmasini o‘qitish;',
  '- amaliy ko‘nikmalarni xavfsiz muhitda (simulyatsiya) mashq qildirish;',
  '- bilim va ko‘nikmani obyektiv baholash (OSKE, Mini-CEX).',
].join('\n');

let nextId = 100;
function mat(code: string, kind: string, title: string, payload: Body = {}, extra: Partial<Mat> = {}): Mat {
  nextId += 1;
  return {
    id: nextId,
    syllabus_id: PED,
    variant_label: '',
    topic_code: code,
    kind,
    title,
    language: 'uz',
    payload,
    file: '',
    file_name: '',
    file_size: 0,
    external_url: '',
    author_name: 'Namunova Dilnoza',
    created_at: NOW,
    updated_at: NOW,
    ...extra,
  };
}

const state = {
  topics: {
    [PED]: [
      { code: '1', title: 'Tibbiy pedagogikaning predmeti, maqsadi va vazifalari', type: 'lecture' },
      { code: '2', title: 'Tibbiy ta’limda baholash: formativ va summativ usullar', type: 'lecture' },
      { code: '3', title: 'Klinik fikrlashni o‘qitish metodikasi', type: 'lecture' },
      { code: '4', title: 'Simulyatsion ta’lim va standartlashtirilgan bemor', type: 'lecture' },
    ],
    [UZI]: [],
  } as Record<number, Topic[]>,
  materials: [
    mat('1', 'lecture', 'Ma’ruza', { text: LECTURE }),
    mat('1', 'presentation', 'Taqdimot', {}, {
      file: 'online/demo/tibbiy-pedagogika-1.pdf',
      file_name: 'Tibbiy-pedagogika-1-mavzu.pdf',
      file_size: 2_400_000,
    }),
    mat('1', 'video', 'Kirish ma’ruzasi', {}, { external_url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }),
    mat('1', 'video', 'OSKE stansiyasi: amaliy ko‘rsatma', {}, { external_url: 'https://youtu.be/aqz-KE-bpKQ' }),
    mat('1', 'practical', 'Amaliy mashg‘ulot', { questions: PRACTICAL }),
    mat('1', 'test', '4 ta test', { questions: TOPIC_TEST }),
    mat('2', 'lecture', 'Ma’ruza', { text: LECTURE }),
    mat('2', 'test', '4 ta test', { questions: TOPIC_TEST }),
    mat('__entry__', 'test', 'Kirish testi', { questions: ENTRY, published: true }),
    mat('__exit__', 'test', 'Chiqish testi', { questions: EXIT, published: params.get('exit') === 'open' }),
  ],
  attempts: new Map<string, Attempt[]>(),
  viewed: new Set<string>(),
};

if (params.get('entry') === 'done') {
  state.attempts.set('__entry__|entry', [{ score: 3, total: 4, answers: [0, 0, 2, 1], at: NOW, no: 1 }]);
  state.attempts.set('1|test', [
    { score: 2, total: 4, answers: [0, 0, 0, 0], at: NOW, no: 1 },
    { score: 3, total: 4, answers: [0, 1, 0, 0], at: NOW, no: 2 },
  ]);
  state.viewed.add('1|lecture');
}

/* ==================== Server qoidalari (malaka_service bilan bir xil) ==================== */

const KINDS = ['lecture', 'presentation', 'video', 'practical', 'test'];
const MAX: Record<string, number> = { test: 4, practical: 4, entry: 1, exit: 1 };
const pct = (s: number, t: number) => (t ? Math.round((s * 100) / t) : 0);

function best(rows: Attempt[]): Attempt | null {
  return rows.reduce<Attempt | null>(
    (b, r) => (!b || pct(r.score, r.total) >= pct(b.score, b.total) ? r : b),
    null,
  );
}

function summarize(rows: Attempt[], kind: string) {
  const b = best(rows);
  const last = rows[rows.length - 1];
  return {
    kind,
    max_attempts: MAX[kind],
    used: rows.length,
    left: Math.max(0, MAX[kind] - rows.length),
    finished: rows.length >= MAX[kind],
    best_percent: b ? pct(b.score, b.total) : null,
    best_score: b ? b.score : null,
    best_total: b ? b.total : null,
    last_score: last ? last.score : null,
    last_total: last ? last.total : null,
    last_submitted_at: last ? last.at : null,
  };
}

const questionsOf = (m?: Mat): Q[] => ((m?.payload.questions as Q[] | undefined) || []);
const rowsOf = (code: string, kind: string) => state.attempts.get(`${code}|${kind}`) || [];

function testView(questions: Q[], rows: Attempt[], kind: string) {
  const s = summarize(rows, kind);
  const reveal = s.finished || s.best_percent === 100;
  return {
    attempts: s,
    question_count: questions.length,
    questions: questions.map((x) =>
      reveal
        ? { question: x.question, options: x.options, correct_index: x.correctOptionIndex, explanation: x.explanation }
        : { question: x.question, options: x.options },
    ),
    ...(reveal ? { my_answers: best(rows)?.answers || [] } : {}),
  };
}

const subjectMat = (code: string, syllabus = PED) =>
  state.materials.find((m) => m.syllabus_id === syllabus && m.topic_code === code && m.kind === 'test');

function entryOpen(syllabus = PED): boolean {
  const m = subjectMat('__entry__', syllabus);
  if (!m || m.payload.published === false || !questionsOf(m).length) return true;
  return rowsOf('__entry__', 'entry').length > 0;
}

function kindsOf(code: string, syllabus = PED): Set<string> {
  return new Set(
    state.materials.filter((m) => m.syllabus_id === syllabus && m.topic_code === code).map((m) => m.kind),
  );
}

function topicResult(code: string, kinds: Set<string>) {
  const out: Record<string, unknown> = { test: null, practical: null, grade: null };
  const parts: Array<number | null> = [];
  for (const k of ['test', 'practical']) {
    const rows = rowsOf(code, k);
    if (kinds.has(k) || rows.length) out[k] = summarize(rows, k);
    if (kinds.has(k)) parts.push((out[k] as { best_percent: number | null }).best_percent);
  }
  if (parts.length && parts.every((p) => p !== null)) {
    out.grade = Math.round((parts as number[]).reduce((a, b) => a + b, 0) / parts.length);
  }
  return out;
}

function subjectStatus(code: '__entry__' | '__exit__') {
  const m = subjectMat(code);
  const kind = code === '__entry__' ? 'entry' : 'exit';
  const qs = questionsOf(m);
  return {
    available: Boolean(m && m.payload.published !== false && qs.length),
    title: m?.title || (kind === 'entry' ? 'Kirish testi' : 'Chiqish testi'),
    question_count: qs.length,
    ...summarize(rowsOf(code, kind), kind),
  };
}

function stripPrefixes(options: string[]): string[] {
  const all = options.every((o, i) => new RegExp(`^\\(?\\s*[${'ABCDEFGH'[i]}${'abcdefgh'[i]}]\\s*[).:]\\s*`).test(o));
  return all ? options.map((o) => o.replace(/^\(?\s*[A-Ha-h]\s*[).:]\s*/, '').trim()) : options;
}

/* ==================== Marshrutlar ==================== */

type Out = [number, unknown];

const fail = (status: number, detail: string): Out => [status, { detail }];

function studentTopics(): unknown[] {
  const gate = entryOpen();
  return state.topics[PED].map((t) => {
    const present = kindsOf(t.code);
    const open = gate && present.size > 0;
    return {
      topic_code: t.code,
      title: t.title,
      type: t.type,
      is_open: open,
      opened_at: null,
      locked_reason: open ? null : gate ? 'empty' : 'entry',
      has: open ? Object.fromEntries(KINDS.map((k) => [k, present.has(k)])) : {},
      viewed: Object.fromEntries(['lecture', 'presentation', 'video'].map((k) => [k, state.viewed.has(`${t.code}|${k}`)])),
      ...topicResult(t.code, present),
    };
  });
}

function progressReport(): unknown {
  const topics = state.topics[PED];
  const row = (
    id: string,
    name: string,
    group: string,
    entry: number | null,
    exit: number | null,
    marks: Array<[number | null, number | null]>,
    seen: boolean,
  ) => {
    const mk = (p: number | null, kind: string, used = 1) =>
      p === null
        ? summarize([], kind)
        : summarize(
            Array.from({ length: used }, (_, i) => ({ score: Math.round((p * 4) / 100), total: 4, answers: [], at: NOW, no: i + 1 })),
            kind,
          );
    const topicRows = topics.map((t, i) => {
      const [test, practical] = marks[i] || [null, null];
      const present = kindsOf(t.code);
      const tr = present.has('test') ? mk(test, 'test', test === null ? 0 : 2) : null;
      const pr = present.has('practical') ? mk(practical, 'practical', practical === null ? 0 : 1) : null;
      const parts = [tr, pr].filter(Boolean) as Array<{ best_percent: number | null }>;
      const grade = parts.length && parts.every((p) => p.best_percent !== null)
        ? Math.round(parts.reduce((a, p) => a + (p.best_percent || 0), 0) / parts.length)
        : null;
      return {
        topic_code: t.code,
        topic_title: t.title,
        viewed: { lecture: seen && i < 2, presentation: seen && i === 0, video: seen && i === 0 },
        test: tr,
        practical: pr,
        grade,
      };
    });
    const grades = topicRows.map((t) => t.grade).filter((g): g is number => g !== null);
    return {
      student_id: id,
      student_name: name,
      group_name: group,
      entry: mk(entry, 'entry'),
      exit: mk(exit, 'exit'),
      topics: topicRows,
      graded_count: grades.length,
      average_grade: grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : null,
      last_seen: seen ? NOW : null,
    };
  };
  const g1 = 'Tibbiy pedagogika — 1-guruh';
  const g2 = 'Tibbiy pedagogika — 2-guruh';
  return {
    subject_name: SUBJECT_NAME[PED],
    topic_count: topics.length,
    has_entry: true,
    entry_published: true,
    has_exit: true,
    exit_published: false,
    groups: [
      { id: 1, name: g1, count: 30 },
      { id: 2, name: g2, count: 30 },
    ],
    students: [
      row('AA1234567', 'Aliyev Vali Salimovich', g1, 75, null, [[75, 100], [50, null]], true),
      row('AA7654321', 'Karimov Anvar Botirovich', g1, 50, null, [[100, 67], [null, null]], true),
      row('AA1112223', 'Toshmatov Bekzod Alievich', g1, null, null, [], false),
      row('AA3334445', 'Sobirov Jasur Kamolovich', g2, 100, null, [[50, 33]], true),
    ],
  };
}

function route(method: string, url: URL, body: Body, form: FormData | null): Out | Promise<Out> {
  const p = url.pathname.replace(/^\/api\/v1/, '');
  const qp = url.searchParams;
  const sid = Number(qp.get('syllabus_id') || body.syllabus_id || PED);

  /* ---------- auth ---------- */
  if (p === '/auth/malaka-login/') {
    return [200, {
      access: 'harness', refresh: 'harness', role: 'student', username: 'AA1234567',
      first_name: 'Vali', last_name: 'Aliyev', student_id: 'AA1234567',
      group_name: 'Tibbiy pedagogika — 1-guruh', must_change_password: true,
    }];
  }
  if (p === '/auth/local-login/') {
    return [200, {
      access: 'harness', refresh: 'harness', role: 'hodim', username: 'OQITUVCHI1',
      first_name: 'Dilnoza Anvarovna', last_name: 'Namunova', must_change_password: true,
    }];
  }
  if (p === '/auth/change-password/') return [200, { ok: true }];
  if (p === '/auth/token/refresh/') return [200, { access: 'harness', refresh: 'harness' }];

  /* ---------- o'qituvchi ---------- */
  if (p === '/online/teacher/me/') {
    return [200, {
      is_online_teacher: true,
      full_name: 'Professor, DSc Namunova Dilnoza Anvarovna',
      courses: [PED, UZI].map((id) => ({
        syllabus_id: id, subject_name: SUBJECT_NAME[id], subject_code: `malaka-${id}`,
        department_name: DEPT, variant_label: '', topic_count: state.topics[id].length,
        instruction_language: 'uz', program: 'malaka',
      })),
    }];
  }
  if (p === '/online/teacher/topics/') {
    return [200, state.topics[sid].map((t) => {
      const present = kindsOf(t.code, sid);
      return {
        code: t.code, title: t.title, type: t.type,
        has: Object.fromEntries(KINDS.map((k) => [k, present.has(k)])),
        ready: KINDS.filter((k) => present.has(k)).length,
      };
    })];
  }
  if (p === '/online/teacher/materials/' && method === 'GET') {
    const code = qp.get('topic_code') || '';
    return [200, state.materials.filter((m) => m.syllabus_id === sid && m.topic_code === code)];
  }
  if (p === '/online/teacher/materials/' && method === 'POST') {
    const kind = String(body.kind);
    const code = String(body.topic_code);
    let payload = (body.payload as Body) || {};
    if (kind === 'test' || kind === 'practical') {
      const qs = ((payload.questions as Q[]) || []).map((x) => ({ ...x, options: stripPrefixes(x.options) }));
      if (!qs.length) return fail(400, 'Testda savol yo‘q.');
      payload = { questions: qs };
      if (code.startsWith('__')) {
        payload.published = (body.payload as Body)?.published ?? code === '__entry__';
      }
    }
    const existing =
      kind === 'video'
        ? undefined
        : state.materials.find((m) => m.syllabus_id === sid && m.topic_code === code && m.kind === kind);
    if (existing) {
      Object.assign(existing, { payload, title: body.title || existing.title, external_url: body.external_url || '' });
      return [201, existing];
    }
    const m = mat(code, kind, String(body.title || ''), payload, {
      syllabus_id: sid,
      external_url: String(body.external_url || ''),
    });
    state.materials.push(m);
    return [201, m];
  }
  if (p === '/online/teacher/materials/upload/') {
    const file = form?.get('file') as File | null;
    const code = String(form?.get('topic_code') || '');
    const kind = String(form?.get('kind') || 'presentation');
    state.materials = state.materials.filter((m) => !(m.topic_code === code && m.kind === kind && m.syllabus_id === sid));
    const m = mat(code, kind, file?.name || 'fayl', {}, {
      syllabus_id: Number(form?.get('syllabus_id') || PED),
      file: `online/demo/${file?.name || 'fayl.pdf'}`,
      file_name: file?.name || 'fayl.pdf',
      file_size: file?.size || 0,
    });
    state.materials.push(m);
    return [201, m];
  }
  const del = p.match(/^\/online\/teacher\/materials\/(\d+)\/$/);
  if (del && method === 'DELETE') {
    state.materials = state.materials.filter((m) => m.id !== Number(del[1]));
    return [204, null];
  }
  if (p === '/malaka/teacher/topics/' && method === 'POST') {
    const list = state.topics[sid];
    const title = String(body.title || '').trim();
    if (list.some((t) => t.title.toLowerCase() === title.toLowerCase())) {
      return fail(409, 'Bunday nomli mavzu allaqachon bor.');
    }
    const code = String(Math.max(0, ...list.map((t) => Number(t.code) || 0)) + 1);
    const topic = { code, title, type: 'lecture' };
    list.push(topic);
    return [201, topic];
  }
  const tm = p.match(/^\/malaka\/teacher\/topics\/([^/]+)\/(move\/)?$/);
  if (tm) {
    const list = state.topics[sid];
    const i = list.findIndex((t) => t.code === decodeURIComponent(tm[1]));
    if (i < 0) return fail(404, 'Mavzu topilmadi.');
    if (tm[2]) {
      const j = body.direction === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
      return [200, list];
    }
    if (method === 'PATCH') {
      list[i] = { ...list[i], title: String(body.title) };
      return [200, list[i]];
    }
    if (method === 'DELETE') {
      const n = state.materials.filter((m) => m.syllabus_id === sid && m.topic_code === list[i].code).length;
      if (n) return fail(409, `Mavzuda ${n} ta material bor. Avval ularni o‘chiring.`);
      list.splice(i, 1);
      return [204, null];
    }
  }
  if (p === '/malaka/teacher/test-import/') {
    return new Promise<Out>((resolve) =>
      window.setTimeout(
        () =>
          resolve([200, {
            questions: [
              { question: 'Pedagogik texnologiya deganda nima tushuniladi?', options: ['Tasodifiy usullar yig‘indisi', 'Maqsadga erishishni kafolatlaydigan tizimli jarayon', 'Faqat kompyuter dasturlari', 'Dars jadvali'], correctOptionIndex: 1, explanation: '', answer_source: 'document' },
              { question: 'Case-study usuli qaysi ko‘nikmani ko‘proq rivojlantiradi?', options: ['Yod olish', 'Tahlil va qaror qabul qilish', 'Tez yozish', 'Chizmachilik'], correctOptionIndex: 1, explanation: '', answer_source: 'ai' },
              { question: 'Portfolio baholashning afzalligi?', options: ['Rivojlanishni vaqt davomida ko‘rsatadi', 'Eng tez usul', 'O‘qituvchi ishtirokisiz', 'Faqat bitta ko‘nikmani o‘lchaydi'], correctOptionIndex: 0, explanation: '', answer_source: 'document' },
            ],
            ai_decided: 1, truncated: false, chunks: 1, failed_chunks: 0,
            source: (form?.get('file') as File | null)?.name || 'matn', chars: 2400,
          }]),
        1400,
      ),
    );
  }
  if (p === '/malaka/teacher/progress/') return [200, progressReport()];

  /* ---------- tinglovchi ---------- */
  if (p === '/online/student/subjects/') {
    const topics = studentTopics() as Array<{ is_open: boolean; grade: number | null; test: unknown; practical: unknown }>;
    const grades = topics.map((t) => t.grade).filter((g): g is number => g !== null);
    return [200, [{
      syllabus_id: PED, subject_name: SUBJECT_NAME[PED], department_name: DEPT, variant_label: '',
      program: 'malaka', topic_count: topics.length, open_count: topics.filter((t) => t.is_open).length,
      done_count: state.topics[PED].filter((t) => rowsOf(t.code, 'test').length || rowsOf(t.code, 'practical').length).length,
      graded_count: grades.length,
      average_grade: grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : null,
      entry: subjectStatus('__entry__'), exit: subjectStatus('__exit__'),
    }]];
  }
  if (p === '/online/student/topics/') return [200, studentTopics()];
  if (p === '/online/student/topic/') {
    const code = qp.get('topic_code') || '';
    if (!entryOpen()) return fail(403, 'Avval fanning kirish testini topshiring — mavzular undan keyin ochiladi.');
    const rows = state.materials
      .filter((m) => m.syllabus_id === PED && m.topic_code === code && KINDS.includes(m.kind))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
    if (!rows.length) return fail(403, 'Bu mavzuga hali material joylanmagan.');
    return [200, {
      topic_code: code,
      title: state.topics[PED].find((t) => t.code === code)?.title || '',
      subject_name: SUBJECT_NAME[PED],
      program: 'malaka',
      opened_at: null,
      materials: rows.map((m) => ({
        id: m.id, kind: m.kind, title: m.title, language: m.language,
        file: m.file ? `/media/${m.file}` : '', file_name: m.file_name, external_url: m.external_url,
        ...(m.kind === 'lecture' ? { text: String(m.payload.text || '') } : {}),
        ...(m.kind === 'test' || m.kind === 'practical' ? testView(questionsOf(m), rowsOf(code, m.kind), m.kind) : {}),
      })),
      viewed: Object.fromEntries(['lecture', 'presentation', 'video'].map((k) => [k, state.viewed.has(`${code}|${k}`)])),
      result: topicResult(code, new Set(rows.map((m) => m.kind))),
    }];
  }
  if (p === '/online/student/view/') {
    state.viewed.add(`${body.topic_code}|${body.kind}`);
    return [200, { marked: body.kind }];
  }
  if (p === '/malaka/student/subject-test/') {
    const code = qp.get('code') === 'exit' ? '__exit__' : '__entry__';
    const kind = code === '__entry__' ? 'entry' : 'exit';
    const m = subjectMat(code);
    if (!m || m.payload.published === false) return fail(404, 'Bu test hali e’lon qilinmagan.');
    return [200, {
      code: kind, title: m.title, subject_name: SUBJECT_NAME[PED],
      ...testView(questionsOf(m), rowsOf(code, kind), kind),
    }];
  }
  if (p === '/malaka/student/attempt/') {
    const code = String(body.topic_code);
    const kind = code === '__entry__' ? 'entry' : code === '__exit__' ? 'exit' : String(body.kind);
    const m = code.startsWith('__')
      ? subjectMat(code)
      : state.materials.find((x) => x.topic_code === code && x.kind === kind && x.syllabus_id === PED);
    const qs = questionsOf(m);
    const rows = rowsOf(code, kind);
    if (rows.length >= MAX[kind]) return fail(409, `Urinishlar tugagan (${rows.length}/${MAX[kind]}).`);
    const answers = (body.answers as number[]) || [];
    const score = qs.filter((x, i) => x.correctOptionIndex === answers[i]).length;
    const next = [...rows, { score, total: qs.length, answers, at: NOW, no: rows.length + 1 }];
    state.attempts.set(`${code}|${kind}`, next);
    return [200, { score, total: qs.length, percent: pct(score, qs.length), ...testView(qs, next, kind) }];
  }

  return fail(404, `Harness: ${method} ${p} yo‘q`);
}

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = String(typeof input === 'string' ? input : (input as Request).url || input);
  const url = new URL(raw, location.origin);
  const method = (init?.method || 'GET').toUpperCase();
  let body: Body = {};
  let form: FormData | null = null;
  if (init?.body instanceof FormData) {
    form = init.body;
    form.forEach((v, k) => {
      if (typeof v === 'string') body[k] = v;
    });
  } else if (typeof init?.body === 'string') {
    try {
      body = JSON.parse(init.body) as Body;
    } catch {
      body = {};
    }
  }
  const [status, data] = await route(method, url, body, form);
  await new Promise((r) => window.setTimeout(r, 120));
  if (status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

/* ---------- Seans ---------- */
const KEY = 'imentor-malaka-session-v1';
const SESSIONS: Record<string, unknown> = {
  teacher: {
    role: 'teacher', access: 'harness', refresh: 'harness', username: 'OQITUVCHI1',
    displayName: 'Dilnoza Anvarovna Namunova', studentId: '', groupName: '', mustChangePassword: false,
  },
  student: {
    role: 'student', access: 'harness', refresh: 'harness', username: 'AA1234567',
    displayName: 'Vali Aliyev', studentId: 'AA1234567',
    groupName: 'Tibbiy pedagogika — 1-guruh', mustChangePassword: false,
  },
  pending: {
    role: 'student', access: 'harness', refresh: 'harness', username: 'AA1234567',
    displayName: 'Vali Aliyev', studentId: 'AA1234567',
    groupName: 'Tibbiy pedagogika — 1-guruh', mustChangePassword: true,
  },
};
try {
  if (as === 'login') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(SESSIONS[as] || SESSIONS.teacher));
} catch {
  /* xotira yopiq bo'lsa ham sahifa chiziladi */
}

createRoot(document.getElementById('root')!).render(<OnlineApp program="malaka" />);
