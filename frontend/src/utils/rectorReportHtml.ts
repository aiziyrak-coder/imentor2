import type { ActivityOverview, ActivityRow } from './activityReportApi';
import { formatMinutes } from './activityReportApi';

/**
 * Rektorga beriladigan hisobotning bosma ko'rinishi.
 *
 * Bitta HTML manba — ekrandagi ko'rinish ham, PDF ham shundan chiziladi.
 * Ikkitasini alohida yozsak, biri o'zgarganda ikkinchisi ortda qolardi va
 * rektor ekranda ko'rgani bilan qog'ozdagisi boshqacha bo'lib chiqardi.
 *
 * PDF `renderHtmlToPdf` orqali rasm sifatida chiziladi — shuning uchun
 * oʻ/gʻ kabi harflar ham, kirill ham to'g'ri chiqadi (jsPDF ning o'z
 * shriftlari bularni ko'rsata olmaydi).
 */

/** Ism va kafedra bazadan keladi — HTML ga qo'yishdan oldin zararsizlantiriladi. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAGE_LABEL: Record<string, string> = {
  syllabus: 'Mening fanlarim',
  lectures: "Ma'ruza matni",
  presentation: 'Taqdimotlar',
  videos: 'Videolar',
  handouts: 'Tarqatma materiallar',
  cases: 'Keys yaratish',
  tests: 'Test yaratish',
  'content-catalog': 'Keys va testlar bazasi',
  translator: 'Tarjima',
  profile: 'Profil',
  'admin-dashboard': 'Boshqaruv paneli',
  'admin-staff': 'Hodimlar',
  'admin-syllabuses': 'Sillabuslar',
  'admin-online-edu': "Online ta'lim",
  'admin-videos': 'Videolar (admin)',
  'admin-handouts': 'Tarqatmalar (admin)',
  'admin-books': 'Kitoblar',
  other: 'Boshqa',
};

function pageLabel(key: string): string {
  return PAGE_LABEL[key] || key;
}

const WEEKDAYS = [
  'yakshanba',
  'dushanba',
  'seshanba',
  'chorshanba',
  'payshanba',
  'juma',
  'shanba',
];

/** `2026-09-09` → `09.09.2026, chorshanba` */
export function formatReportDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}, ${WEEKDAYS[day]}`;
}

/** Faqat o'qituvchi bo'limlari — admin bo'limlari hisobotga kirmaydi. */
function teachingPages(row: ActivityRow): string {
  const pages = row.pages.filter((p) => !p.page.startsWith('admin-') && p.minutes > 0);
  if (pages.length === 0) return '—';
  return pages
    .slice(0, 4)
    .map((p) => `${esc(pageLabel(p.page))} ${p.minutes}′`)
    .join(', ');
}

function num(value: number): string {
  return value > 0 ? String(value) : '—';
}

export type RectorReportOptions = {
  /** Muassasa nomi — hisobot sarlavhasida turadi. */
  institution?: string;
};

export function buildRectorReportHtml(
  data: ActivityOverview,
  options: RectorReportOptions = {},
): string {
  const institution =
    options.institution || "Farg'ona jamoat salomatligi tibbiyot instituti";
  const single = data.from === data.to;
  const period = single
    ? formatReportDate(data.from)
    : `${formatReportDate(data.from)} — ${formatReportDate(data.to)}`;

  const active = data.teachers.filter((t) => t.minutes > 0);
  const idle = data.teachers.filter((t) => t.minutes <= 0);
  // `toLocaleString('uz-UZ')` YYYY-MM-DD beradi — hisobotning qolgan
  // qismida esa sana DD.MM.YYYY ko'rinishida. Qo'lda yig'iladi.
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const generated =
    `${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()} ` +
    `${two(now.getHours())}:${two(now.getMinutes())}`;

  const rows = active
    .map(
      (t, i) => `
      <tr data-pdf-block>
        <td class="n">${i + 1}</td>
        <td class="name">${esc(t.display_name)}</td>
        <td class="dept">${esc(t.department || '—')}</td>
        <td class="num strong">${esc(formatMinutes(t.minutes))}</td>
        <td class="pages">${teachingPages(t)}</td>
        <td class="num">${num(t.videos_viewed)}</td>
        <td class="num">${num(t.handouts_viewed)}</td>
        <td class="num">${num(t.cases_created)}</td>
        <td class="num">${num(t.tests_created)}</td>
      </tr>`,
    )
    .join('');

  const idleBlock = idle.length
    ? `
    <h2 data-pdf-keep-next>Faoliyat qayd etilmaganlar — ${idle.length} nafar</h2>
    <p class="idle">${idle.map((t) => esc(t.display_name)).join(' · ')}</p>`
    : '';

  return `
<div class="rector-report">
  <style>
    .rector-report { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.45; }
    .rector-report h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: -0.2px; }
    .rector-report h2 { font-size: 12px; margin: 18px 0 7px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
    .rector-report .inst { font-size: 11px; color: #475569; margin: 0 0 1px; text-transform: uppercase; letter-spacing: 0.8px; }
    .rector-report .period { font-size: 12px; color: #0f172a; font-weight: 600; margin: 4px 0 0; }
    .rector-report .head { border-bottom: 2px solid #0f172a; padding-bottom: 9px; margin-bottom: 14px; }
    .rector-report table { width: 100%; border-collapse: collapse; }
    .rector-report th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.7px;
      color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 0 5px 5px; font-weight: 600; }
    .rector-report td { padding: 6px 5px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .rector-report td.n { color: #94a3b8; width: 22px; }
    .rector-report td.name { font-weight: 600; width: 150px; }
    .rector-report td.dept { color: #475569; width: 135px; }
    .rector-report td.pages { color: #475569; font-size: 10px; }
    .rector-report td.num { text-align: right; white-space: nowrap; width: 46px; }
    .rector-report td.strong { font-weight: 600; }
    .rector-report .totals { display: flex; flex-wrap: wrap; gap: 0; border: 1px solid #cbd5e1; margin-bottom: 4px; }
    .rector-report .totals div { flex: 1 1 0; min-width: 92px; padding: 8px 10px; border-right: 1px solid #e2e8f0; }
    .rector-report .totals div:last-child { border-right: 0; }
    .rector-report .totals span { display: block; font-size: 8.5px; text-transform: uppercase;
      letter-spacing: 0.7px; color: #64748b; }
    .rector-report .totals b { display: block; font-size: 15px; margin-top: 2px; }
    .rector-report .idle { color: #475569; font-size: 10px; line-height: 1.7; margin: 0; }
    .rector-report .foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0;
      font-size: 9.5px; color: #94a3b8; display: flex; justify-content: space-between; }
    .rector-report .none { color: #64748b; font-style: italic; padding: 14px 0; }
  </style>

  <div class="head">
    <p class="inst">${esc(institution)}</p>
    <h1>iMentor — ${single ? 'kunlik faollik hisoboti' : 'faollik hisoboti'}</h1>
    <p class="period">${esc(period)}</p>
  </div>

  <div class="totals" data-pdf-block>
    <div><span>O'qituvchi</span><b>${data.total}</b></div>
    <div><span>Ishlagan</span><b>${data.totals.active_teachers}</b></div>
    <div><span>Umumiy vaqt</span><b>${esc(formatMinutes(data.totals.minutes))}</b></div>
    <div><span>Video</span><b>${data.totals.videos_viewed}</b></div>
    <div><span>Tarqatma</span><b>${data.totals.handouts_viewed}</b></div>
    <div><span>Keys</span><b>${data.totals.cases_created}</b></div>
    <div><span>Test</span><b>${data.totals.tests_created}</b></div>
  </div>

  <h2 data-pdf-keep-next>Faoliyat ko'rsatganlar — ${active.length} nafar</h2>
  ${
    active.length
      ? `<table>
    <thead>
      <tr>
        <th></th><th>F.I.Sh.</th><th>Kafedra</th><th style="text-align:right">Vaqt</th>
        <th>Bo'limlar</th><th style="text-align:right">Video</th><th style="text-align:right">Tarqatma</th>
        <th style="text-align:right">Keys</th><th style="text-align:right">Test</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
      : `<p class="none">Bu kunda hech bir o'qituvchi platformada ishlamagan.</p>`
  }

  ${idleBlock}

  <div class="foot">
    <span>iMentor — ${esc(institution)}</span>
    <span>Hisobot ${esc(generated)} da tayyorlandi</span>
  </div>
</div>`;
}
