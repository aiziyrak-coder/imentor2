import type { IntelligenceAnalysis, IntelligenceReport, IntelligenceRow } from './intelligenceApi';
import type { TeacherDetail } from './rectorApi';
import { renderHtmlDocumentsToPdf } from '../utils/htmlToPdf';
import { STATUS_LABELS } from './ReportStatus';
import { BOARD_LABELS } from './InteractiveBoard';

const esc = (value: unknown) =>
  String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const delta = (value: number | undefined) =>
  value === undefined ? '—' : `${value > 0 ? '+' : ''}${value}`;
export function buildIntelligencePdf(
  report: IntelligenceReport,
  rows: IntelligenceRow[],
  analysis: IntelligenceAnalysis | null,
  detail?: TeacherDetail,
): string {
  const personal = rows.length === 1;
  const ids = new Set(rows.map((r) => r.owner_key));
  const priorities = analysis?.priorities.filter((p) => ids.has(p.owner_key)) || [];
  return `<div class="ri"><style>
    .ri{font:12px/1.5 Arial,sans-serif;color:#172033}.ri h1{font-size:23px;margin:4px 0}.ri h2{font-size:15px;margin:20px 0 7px}
    .ri p{margin:4px 0}.ri .muted{color:#607086;font-size:10px}.ri .head{border-bottom:3px solid #163952;padding-bottom:12px;margin-bottom:14px}
    .ri .box{padding:12px;border:1px solid #d6e0e8;margin:10px 0;border-radius:8px}.ri table{width:100%;border-collapse:collapse;font-size:10px}
    .ri td,.ri th{border-bottom:1px solid #dce4eb;padding:6px;text-align:left;vertical-align:top}.ri th{background:#eef4f8;color:#33465a}
    .ri .num{white-space:nowrap;text-align:right}.ri .name{font-weight:bold}.ri .note{background:#f0f5f8;padding:8px 12px;font-size:10px}
    </style><div class="head" data-pdf-block><p class="muted">FARG‘ONA JAMOAT SALOMATLIGI TIBBIYOT INSTITUTI · iMentor</p>
    <h1>${personal ? 'O‘qituvchining shaxsiy hisoboti' : 'Familiyalar bo‘yicha rektor hisoboti'}</h1>
    <p>${esc(report.from)} — ${esc(report.to)} · ${esc(report.filters.department || 'Barcha kafedralar')}</p>
    <p class="muted">${rows.length} o‘qituvchi. Qidiruv: ${esc(report.filters.q || 'barchasi')}. Belgilar: ${esc(
      report.filters.focus
        .split(',')
        .filter(Boolean)
        .map((k) => report.signal_labels[k])
        .join(', ') || 'barchasi',
    )}.</p>
    <p class="muted">Ma’lumot olindi: ${esc(new Date(report.generated_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' }))} (Toshkent).</p></div>
    <p class="note">Mezon: ${esc({ usage: 'iMentordan foydalanish', materials: 'Material yaratish', lessons: 'Dars o‘tish', results: 'Talabalar natijasi' }[report.filters.criterion || 'usage'])}. Rang filtri: ${esc(report.filters.status === 'all' || !report.filters.status ? 'Barchasi' : STATUS_LABELS[report.filters.status])}.
    ${report.filters.criterion === 'usage' ? `Yashil: kuniga o‘rtacha kamida ${esc(report.filters.green_minutes_per_day)} daqiqa; qizil: 0 daqiqa; sariq: oraliq.` : report.filters.criterion === 'materials' ? 'Qizil: 0; sariq: 1–4; yashil: 5+ material.' : report.filters.criterion === 'lessons' ? 'Faqat doskasi borlarga: qizil 0; sariq 1–2; yashil 3+ dars. Doska yo‘q yoki aniqlanmagan bo‘lsa baholanmaydi.' : 'Kamida 5 urinish: qizil <56%; sariq 56–70%; yashil 71%+. Qolganlar: ma’lumot kam.'}</p>
    <p class="note" data-pdf-block>Faqat platformada qayd etilgan ishlar. Natija yo‘q qiymati 0% emas. Faollik ishga kelish yoki kasbiy malaka bahosi emas.
    ${report.previous_from ? `Solishtirish: ${esc(report.previous_from)} — ${esc(report.previous_to)}.` : ''}</p>
    <div class="box" data-pdf-block><b>${rows.length}</b> o‘qituvchi · <b>${rows.reduce((n, r) => n + r.minutes, 0)}</b> daqiqa ·
    <b>${rows.reduce((n, r) => n + r.created_total, 0)}</b> material · <b>${rows.reduce((n, r) => n + r.lessons_total, 0)}</b> dars ·
    <b>${rows.reduce((n, r) => n + r.student_attempts, 0)}</b> test urinishi</div>
    ${
      analysis
        ? `<h2 data-pdf-keep-next>AI tavsiyasi — dalillarga tayangan tahlil</h2><p class="muted">${analysis.analyzed_count} o‘qituvchi tahlil qilindi, filtrda ${analysis.matched_count} o‘qituvchi.</p>
    ${!personal ? `<p class="box" data-pdf-block>${esc(analysis.summary)}</p>` : ''}
    ${priorities.map((p) => `<div class="box" data-pdf-block><b>${esc(p.display_name)}</b><p>${esc(p.action)}</p><p><b>Tekshirish:</b> ${esc(p.verification)}</p><p class="muted">Dalil: ${p.evidence.map((e) => `${esc(e.label)}: ${esc(e.value)}`).join(' · ')}</p></div>`).join('')}`
        : ''
    }
    <h2 data-pdf-keep-next>${personal ? esc(rows[0].display_name) : 'Filtrga mos to‘liq ro‘yxat'}</h2>
    <table><thead data-pdf-block><tr><th>Familiya, ism / kafedra</th><th>Daqiqa / farq</th><th>Material</th><th>Dars</th><th>Holat</th><th>Urinish / natija</th></tr></thead><tbody>
    ${rows
      .map(
        (
          r,
        ) => `<tr data-pdf-block><td><b>${esc(r.display_name)}</b><br>${esc(r.department)}<br><span class="muted">${esc(r.owner_key)}<br>${esc(BOARD_LABELS[r.board?.status || 'unknown'])}${r.board?.status === 'available' ? ` · ${r.board.rooms.length} xona` : ' · Dars ko‘rsatkichi baholanmaydi'}</span></td>
    <td class="num">${r.minutes}<br><span class="muted">${delta(r.delta?.minutes)}</span></td><td class="num">${r.created_total}</td><td class="num">${r.lessons_total}</td>
    <td>${esc(STATUS_LABELS[r.status || 'none'])}</td><td class="num">${r.student_attempts} / ${r.avg_student_score === null ? '—' : `${r.avg_student_score}%`}${r.small_sample ? '<br><span class="muted">5 tadan kam urinish</span>' : ''}</td></tr>`,
      )
      .join('')}</tbody></table>
    ${
      personal
        ? `<div class="box" data-pdf-block><p><b>Materiallar:</b> ${rows[0].cases_created} keys, ${rows[0].tests_created} test, ${rows[0].handouts_created} tarqatma, ${rows[0].videos_created} video, ${rows[0].presentations_created} taqdimot.</p>
    <p><b>Belgilar:</b> ${esc(rows[0].signals.map((s) => report.signal_labels[s]).join('; ') || 'Yo‘q')}</p>
    <p><b>Dars imkoniyati:</b> ${esc(rows[0].board?.reason || 'Doska mavjudligi aniqlanmagan.')}</p>
    ${rows[0].board?.rooms.length ? `<p><b>Doskali auditoriyalar:</b> ${rows[0].board.rooms.map(esc).join('; ')}</p>` : ''}
    ${rows[0].board?.unavailable_rooms.length ? `<p><b>Nosoz:</b> ${rows[0].board.unavailable_rooms.map(esc).join('; ')}</p>` : ''}
    <p class="muted">Manba: interaktiv doskalar jadvali · ${esc(rows[0].board?.checked_on)} · ${esc(rows[0].board?.inventory_row)}-band.</p></div>`
        : ''
    }
    ${
      detail
        ? `<h2 data-pdf-keep-next>Kunma-kun faollik</h2><table><thead data-pdf-block><tr><th>Sana</th><th>Daqiqa</th><th>Video ko‘rish</th><th>Tarqatma ochish</th><th>Keys / test</th></tr></thead><tbody>${detail.days.map((d) => `<tr data-pdf-block><td>${esc(d.date)}</td><td>${d.minutes}</td><td>${d.videos_viewed}</td><td>${d.handouts_viewed}</td><td>${d.cases_created} / ${d.tests_created}</td></tr>`).join('')}</tbody></table>
    <h2 data-pdf-keep-next>O‘tilgan darslar (${detail.lessons.length})</h2><table><thead data-pdf-block><tr><th>Mavzu / fan</th><th>Sana</th><th>Talaba</th><th>Natija</th></tr></thead><tbody>${detail.lessons.map((l) => `<tr data-pdf-block><td>${esc(l.topic || l.subject_name)}</td><td class="num">${esc(l.held_at?.slice(0, 10))}</td><td>${l.students}</td><td>${l.avg_score === null ? '—' : `${l.avg_score}%`}</td></tr>`).join('')}</tbody></table>`
        : ''
    }
    <p class="muted" style="margin-top:16px" data-pdf-block>iMentor · Rektor hisoboti · imentor.uz/rektor</p></div>`;
}
export function* intelligencePdfParts(
  report: IntelligenceReport,
  rows: IntelligenceRow[],
  analysis: IntelligenceAnalysis | null = null,
  detail?: TeacherDetail,
): Generator<string> {
  const size = 25;
  const total = Math.max(
    1,
    Math.ceil(rows.length / size),
    Math.ceil((detail?.days.length || 0) / size),
    Math.ceil((detail?.lessons.length || 0) / size),
  );
  for (let i = 0; i < total; i++) {
    const group = rows.length === 1 ? rows : rows.slice(i * size, (i + 1) * size);
    const dayPart = detail
      ? {
          ...detail,
          days: detail.days.slice(i * size, (i + 1) * size),
          lessons: detail.lessons.slice(i * size, (i + 1) * size),
        }
      : undefined;
    const html = buildIntelligencePdf(report, group, i === 0 ? analysis : null, dayPart);
    yield html.replace(
      '</h1>',
      `</h1><p class="muted">Qism ${i + 1} / ${total} · Hisobotda jami ${rows.length} o‘qituvchi. Quyidagi raqamlar shu qismdagi qatorlar uchun.</p>`,
    );
  }
}
export function downloadIntelligencePdf(
  report: IntelligenceReport,
  rows = report.rows,
  analysis: IntelligenceAnalysis | null = null,
  detail?: TeacherDetail,
) {
  return renderHtmlDocumentsToPdf(
    intelligencePdfParts(report, rows, analysis, detail),
    `rektor-${rows.length === 1 ? rows[0].owner_key : 'familiyalar'}-${report.from}_${report.to}.pdf`,
  );
}
