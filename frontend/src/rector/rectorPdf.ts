import { renderHtmlToPdf } from '../utils/htmlToPdf';
import { formatReportDate } from '../utils/rectorReportHtml';
import {
  fetchDepartments,
  fetchOverview,
  fetchRisk,
  fetchSubjects,
  fetchTeachers,
  type DepartmentRow,
  type Overview,
  type ReportFilters,
  type RiskReport,
  type SubjectsReport,
  type TeacherRow,
} from './rectorApi';
import {
  HEADLINE,
  buildVerdicts,
  countStatuses,
  departmentHealth,
  overallStatus,
} from './RectorHealth';
import { STATUS_LABEL, fmtMinutes, statusOf, statusOfLow, type Status } from './RectorUi';

/**
 * Rektor hisobotining PDF nusxasi.
 *
 * Xulosalar va kafedralar reytingi EKRANDAGI hisob-kitobning o'zidan olinadi
 * (`buildVerdicts`, `departmentHealth`) — qog'ozdagi rang va raqam ekranda
 * ko'ringanidan farq qilmasin. PDF `renderHtmlToPdf` orqali rasm sifatida
 * chiziladi, shuning uchun oʻ/gʻ va kirill harflari to'g'ri chiqadi.
 */

export type RectorPdfData = {
  from: string;
  to: string;
  department: string;
  overview: Overview;
  teachers: TeacherRow[];
  departments: DepartmentRow[];
  risk: RiskReport | null;
  subjects: SubjectsReport | null;
  generatedAt?: Date;
};

const INSTITUTION = "Farg'ona jamoat salomatligi tibbiyot instituti";

const COLOR: Record<Status, { fg: string; bg: string; bar: string }> = {
  good: { fg: '#047857', bg: '#ecfdf5', bar: '#10b981' },
  warn: { fg: '#b45309', bg: '#fffbeb', bar: '#f59e0b' },
  bad: { fg: '#be123c', bg: '#fff1f2', bar: '#f43f5e' },
  none: { fg: '#64748b', bg: '#f1f5f9', bar: '#cbd5e1' },
};

/** Nomlar bazadan keladi — HTML ga qo'yishdan oldin zararsizlantiriladi. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chip(status: Status, text: string): string {
  const c = COLOR[status];
  return `<span class="chip" style="color:${c.fg};background:${c.bg}">${esc(text)}</span>`;
}

function dot(status: Status): string {
  return `<span class="dot" style="background:${COLOR[status].bar}"></span>`;
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function box(label: string, value: string | number, status?: Status, hint?: string): string {
  const color = status ? COLOR[status].fg : '#0f172a';
  const edge = status ? `border-left:4px solid ${COLOR[status].bar};` : '';
  return (
    `<div class="box" style="${edge}">` +
    `<p class="box-label">${esc(label)}</p>` +
    `<p class="box-value" style="color:${color}">${esc(value)}</p>` +
    (hint ? `<p class="box-hint">${esc(hint)}</p>` : '') +
    '</div>'
  );
}

function stamp(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()} ${two(now.getHours())}:${two(now.getMinutes())}`;
}

const STYLE = `
  .rp { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.45; }
  .rp h1 { font-size: 18px; margin: 0 0 2px; letter-spacing: -0.2px; }
  .rp h2 { font-size: 11.5px; margin: 18px 0 7px; text-transform: uppercase; letter-spacing: 1px; color: #475569; }
  .rp p { margin: 0; }
  .rp .inst { font-size: 10.5px; color: #475569; text-transform: uppercase; letter-spacing: 0.8px; }
  .rp .period { font-size: 12px; font-weight: 600; margin-top: 4px; }
  .rp .head { border-bottom: 2px solid #0f172a; padding-bottom: 9px; margin-bottom: 12px; }
  .rp .summary { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
  .rp .summary .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; }
  .rp .summary .headline { font-size: 17px; font-weight: 700; margin: 2px 0 3px; }
  .rp .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .rp .box { flex: 1 1 110px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 8px; }
  .rp .box-label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; }
  .rp .box-value { font-size: 16px; font-weight: 700; }
  .rp .box-hint { font-size: 9.5px; color: #64748b; }
  .rp .verdict { border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 10px; margin-bottom: 6px; }
  .rp .verdict-top { display: flex; justify-content: space-between; gap: 10px; }
  .rp .verdict .area { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; }
  .rp .verdict .title { font-size: 12.5px; font-weight: 700; }
  .rp .verdict .figure { font-size: 18px; font-weight: 700; text-align: right; }
  .rp .verdict .text { margin-top: 3px; }
  .rp .verdict .advice { margin-top: 4px; background: #f8fafc; border-radius: 6px; padding: 4px 7px; color: #334155; }
  .rp table { width: 100%; border-collapse: collapse; }
  .rp th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 4px 5px; }
  .rp td { border-bottom: 1px solid #e2e8f0; padding: 4px 5px; vertical-align: top; }
  .rp td.num, .rp th.num { text-align: right; white-space: nowrap; }
  .rp .chip { display: inline-block; border-radius: 4px; padding: 1px 5px; font-weight: 600; font-size: 10px; white-space: nowrap; }
  .rp .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .rp .muted { color: #64748b; }
  .rp .legend { margin-top: 16px; padding-top: 8px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 10px; }
  .rp .legend span { margin-right: 12px; }
`;

export function buildRectorPdfHtml(data: RectorPdfData): string {
  const { overview: ov } = data;
  const t = ov.teachers;
  const s = ov.students;
  const o = ov.online;

  const period =
    data.from === data.to
      ? formatReportDate(data.from)
      : `${formatReportDate(data.from)} — ${formatReportDate(data.to)}`;

  const scopedDepartments = data.department
    ? data.departments.filter((d) => d.name === data.department)
    : data.departments;
  const verdicts = buildVerdicts(ov, data.teachers, scopedDepartments);
  const counts = countStatuses(verdicts);
  const overall = overallStatus(counts);
  const league = departmentHealth(data.departments, data.department).sort(
    (a, b) =>
      ({ bad: 0, warn: 1, good: 2, none: 3 })[a.overall] -
        ({ bad: 0, warn: 1, good: 2, none: 3 })[b.overall] ||
      (a.ready ?? -1) - (b.ready ?? -1),
  );

  const parts: string[] = [];

  // ---------- Sarlavha ----------
  parts.push(`
    <div class="head">
      <p class="inst">${esc(INSTITUTION)}</p>
      <h1>Rektor hisoboti — iMentor</h1>
      <p class="period">${esc(period)}${data.department ? ` · ${esc(data.department)}` : ''}</p>
    </div>`);

  // ---------- Umumiy holat ----------
  const c = COLOR[overall];
  parts.push(`
    <div class="summary" data-pdf-block style="border-left:6px solid ${c.bar}">
      <p class="label">Institut umumiy holati</p>
      <p class="headline" style="color:${c.fg}">${esc(HEADLINE[overall])}</p>
      <p>${verdicts.length} ta yo‘nalishdan ${counts.bad} tasi qizil, ${counts.warn} tasi sariq, ${counts.good} tasi yashil${
        counts.none ? `, ${counts.none} tasida ma’lumot yo‘q` : ''
      }.</p>
      <div class="row">
        ${(['bad', 'warn', 'good', 'none'] as Status[]).map((st) => box(STATUS_LABEL[st], counts[st], st)).join('')}
      </div>
    </div>`);

  // ---------- Yo'nalishlar ----------
  parts.push('<h2 data-pdf-keep-next>Yo‘nalishlar bo‘yicha xulosa — eng muhimidan</h2>');
  for (const v of verdicts) {
    const vc = COLOR[v.status];
    const needsAction = v.status === 'bad' || v.status === 'warn';
    parts.push(`
      <div class="verdict" data-pdf-block style="border-left:5px solid ${vc.bar}">
        <div class="verdict-top">
          <div>
            <p class="area">${esc(v.area)}</p>
            <p class="title">${esc(v.title)}</p>
          </div>
          <div>
            <p class="figure" style="color:${vc.fg}">${esc(v.figure)}</p>
            <p style="text-align:right">${chip(v.status, STATUS_LABEL[v.status])}</p>
          </div>
        </div>
        <p class="text">${esc(v.sentence)}</p>
        ${needsAction && v.advice ? `<p class="advice"><b>Nima qilish kerak:</b> ${esc(v.advice)}</p>` : ''}
      </div>`);
  }

  // ---------- Kafedralar ----------
  if (league.length) {
    parts.push('<h2 data-pdf-keep-next>Kafedralar holati — qizildan boshlab</h2>');
    parts.push(`
      <table>
        <thead data-pdf-block><tr>
          <th>Kafedra</th><th>Holat</th><th class="num">Faol o‘qituvchi</th>
          <th class="num">Ta’minlangan</th><th>Umuman yo‘q</th>
        </tr></thead>
        <tbody>
          ${league
            .map(
              (d) => `
            <tr data-pdf-block>
              <td>${dot(d.overall)}${esc(d.name)}</td>
              <td>${chip(d.overall, STATUS_LABEL[d.overall])}</td>
              <td class="num">${d.teachers ? chip(d.activity, `${d.active} / ${d.teachers}`) : '—'}</td>
              <td class="num">${
                !d.hasSyllabus ? chip('bad', 'sillabus yo‘q') : d.ready === null ? '—' : chip(d.readiness, `${d.ready}%`)
              }</td>
              <td class="muted">${d.missing.length ? esc(d.missing.join(', ')) : '—'}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`);
  }

  // ---------- Asosiy raqamlar ----------
  const activePct = t.total ? Math.round((t.active * 100) / t.total) : null;
  const failing = s.bands.find((b) => b.key === 'qoniqarsiz')?.count ?? 0;
  parts.push('<h2 data-pdf-keep-next>Asosiy raqamlar</h2>');
  parts.push(`
    <div data-pdf-block>
      <p class="muted">O‘qituvchilar</p>
      <div class="row">
        ${box('O‘qituvchi', t.total)}
        ${box('Faol', t.active, statusOf(activePct, 60, 30), `${activePct ?? 0}%`)}
        ${box('Umuman kirmagan', t.inactive, statusOfLow(t.total ? Math.round((t.inactive * 100) / t.total) : null, 40, 70))}
        ${box('Jami vaqt', fmtMinutes(t.minutes))}
        ${box('Dars o‘tilgan', t.live_sessions + t.online_lessons, t.live_sessions + t.online_lessons ? undefined : 'bad')}
      </div>
    </div>
    <div data-pdf-block style="margin-top:8px">
      <p class="muted">Yaratilgan material (administrator ommaviy yuklagani hisobga olinmagan)</p>
      <div class="row">
        ${box('Vaziyatli masala', t.cases_created, t.cases_created ? undefined : 'bad')}
        ${box('Test', t.tests_created, t.tests_created ? undefined : 'bad')}
        ${box('Tarqatma', t.handouts_created, t.handouts_created ? undefined : 'bad')}
        ${box('Video', t.videos_created, t.videos_created ? undefined : 'bad')}
        ${box('Taqdimot', t.presentations_created, t.presentations_created ? undefined : 'bad')}
      </div>
    </div>
    <div data-pdf-block style="margin-top:8px">
      <p class="muted">Talabalar va online ta’lim</p>
      <div class="row">
        ${box('Test topshirgan', s.total)}
        ${box('O‘rtacha ball', pct(s.avg_percent), statusOf(s.avg_percent, 71, 56))}
        ${box('Qoniqarsiz', failing, s.total ? statusOfLow(Math.round((failing * 100) / s.total), 15, 35) : 'none')}
        ${box('Online darsda', o.attendance_students)}
        ${box('Malaka urinishi', o.malaka_attempts)}
      </div>
    </div>`);

  // ---------- Xavf guruhi ----------
  if (data.risk) {
    const r = data.risk;
    const risky = r.tiers.inactive + r.tiers.low;
    const share = (n: number) => (r.total ? Math.round((n * 100) / r.total) : 0);
    parts.push(`<h2 data-pdf-keep-next>Xavf guruhi — oylik faollik (${esc(r.from)} — ${esc(r.to)})</h2>`);
    parts.push(`
      <div data-pdf-block>
        <div class="row">
          ${box('Xavf guruhida', risky, statusOfLow(share(risky), 20, 50), `${share(risky)}%`)}
          ${box('Nofaol', r.tiers.inactive, 'bad', `${share(r.tiers.inactive)}%`)}
          ${box('Past', r.tiers.low, 'warn', `${share(r.tiers.low)}%`)}
          ${box('Yetarli', r.tiers.sufficient, 'good', `${share(r.tiers.sufficient)}%`)}
          ${box('Faol', r.tiers.active, 'good', `${share(r.tiers.active)}%`)}
        </div>
      </div>`);
    const worst = [...r.departments]
      .sort((a, b) => (b.at_risk_pct ?? 0) - (a.at_risk_pct ?? 0));
    if (worst.length) {
      parts.push(`
        <table style="margin-top:8px">
          <thead data-pdf-block><tr>
            <th>Kafedra</th><th class="num">Xavf guruhi</th><th class="num">Nofaol</th>
            <th class="num">Past</th><th class="num">Keys yo‘q</th><th class="num">Test yo‘q</th>
          </tr></thead>
          <tbody>
            ${worst
              .map(
                (d) => `
              <tr data-pdf-block>
                <td>${dot(statusOfLow(d.at_risk_pct, 20, 50))}${esc(d.department)} <span class="muted">(${d.teachers})</span></td>
                <td class="num">${chip(statusOfLow(d.at_risk_pct, 20, 50), pct(d.at_risk_pct))}</td>
                <td class="num">${d.inactive}</td><td class="num">${d.low}</td>
                <td class="num">${d.no_cases}</td><td class="num">${d.no_tests}</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>`);
    }
  }

  // ---------- Fanlar ----------
  const subjectRows = (data.subjects?.results || []).filter(
    (row) => !data.department || row.department === data.department,
  );
  if (data.subjects && subjectRows.length) {
    const sj = data.subjects;
    parts.push(
      `<h2 data-pdf-keep-next>Fanlar kesimida natija — o‘tish chegarasi ${sj.pass_percent}%</h2>`,
    );
    parts.push(`
      <table>
        <thead data-pdf-block><tr>
          <th>Fan</th><th class="num">O‘tish foizi</th><th class="num">O‘rtacha ball</th>
          <th class="num">Talaba</th><th class="num">Urinish</th>
        </tr></thead>
        <tbody>
          ${subjectRows
            .map(
              (r) => `
            <tr data-pdf-block>
              <td>${dot(statusOf(r.pass_rate, 80, 60))}${esc(r.subject_name)}<br /><span class="muted">${esc(r.department || '—')}</span></td>
              <td class="num">${chip(statusOf(r.pass_rate, 80, 60), pct(r.pass_rate))}</td>
              <td class="num">${chip(statusOf(r.avg_percent, 71, 56), pct(r.avg_percent))}</td>
              <td class="num">${r.students}</td><td class="num">${r.attempts}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`);
  }

  // ---------- Izoh ----------
  parts.push(`
    <div class="legend" data-pdf-block>
      <span>${dot('good')}Yashil — joyida</span>
      <span>${dot('warn')}Sariq — e’tibor kerak</span>
      <span>${dot('bad')}Qizil — muammo</span>
      <span>${dot('none')}Kulrang — ma’lumot yo‘q (nol emas)</span>
      <p style="margin-top:4px">Yaratildi: ${stamp(data.generatedAt ?? new Date())} · imentor.uz/rektor</p>
    </div>`);

  return `<div class="rp"><style>${STYLE}</style>${parts.join('')}</div>`;
}

/** Barcha bo'limlarni yuklab, bitta PDF qilib saqlaydi. */
export async function downloadRectorPdf(filters: ReportFilters): Promise<void> {
  const { from, to } = filters;
  const department = filters.department || '';

  // Asosiy qism majburiy — usiz PDF ma'nosiz.
  const [overview, teachers, departments] = await Promise.all([
    fetchOverview({ from, to, department }),
    fetchTeachers({ from, to, department }),
    fetchDepartments({ from, to }),
  ]);
  // Bo'lim yuklanmasa, to'liq bo'lmagan hujjatni saqlamaymiz.
  const [risk, subjects] = await Promise.all([
    fetchRisk('monthly', to, department),
    fetchSubjects({ from, to }),
  ]);

  const html = buildRectorPdfHtml({
    from,
    to,
    department,
    overview,
    teachers: teachers.results,
    departments: departments.results,
    risk,
    subjects,
  });
  const suffix = from === to ? from : `${from}_${to}`;
  await renderHtmlToPdf(html, `rektor-hisoboti-${suffix}.pdf`);
}
