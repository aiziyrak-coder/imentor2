import type { StaffDirectoryEntry } from './staffDirectoryApi';

/**
 * Xodimlar uchun "kirish varaqasi" — chop etiladigan login/parol ro'yxati.
 *
 * Nima uchun kerak: 600 dan ortiq xodim import qilingan, login — Xodim ID,
 * parol — boshlang'ich `fjsti123`. Ko'pchilik buni bilmagani uchun tizimga
 * kira olmayapti. Bu ro'yxat kafedralar bo'yicha guruhlanadi: dekanat yoki
 * kafedra mudiri chop etib, har kimga o'z qatorini beradi.
 *
 * Parol ustuni FAQAT hali kirmagan xodimlarga to'ldiriladi (paroli hamon
 * boshlang'ich). Allaqachon kirgan odam parolini o'zi biladi — unga
 * boshlang'ich parolni ko'rsatish xato bo'lardi.
 */

/** Import va admin-panel yaratgan xodimlarning boshlang'ich paroli. */
export const INITIAL_STAFF_PASSWORD = 'fjsti123';

const KAFEDRASIZ = 'Kafedra biriktirilmagan';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fullName(u: StaffDirectoryEntry): string {
  const name = `${u.last_name || ''} ${u.first_name || ''}`.trim();
  return name || u.display_name || u.phone_digits;
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  klinika_admin: 'Klinika admini',
  hodim: "O'qituvchi / xodim",
};

/**
 * Ro'yxatni chop etiladigan HTML sahifaga aylantiradi.
 *
 * `onlyInitial` — faqat hali kirmagan (paroli boshlang'ich) xodimlarni
 * chiqaradi. Aynan ular kira olmayotgani uchun odatiy holat shu.
 */
export function buildStaffCredentialsHtml(
  rows: StaffDirectoryEntry[],
  opts: { onlyInitial: boolean; title?: string },
): string {
  const list = opts.onlyInitial ? rows.filter((u) => u.password_is_initial) : rows;

  // Kafedra bo'yicha guruhlash — har kafedra o'z varaqasini oladi.
  const byDept = new Map<string, StaffDirectoryEntry[]>();
  for (const u of list) {
    const key = (u.department || '').trim() || KAFEDRASIZ;
    const arr = byDept.get(key);
    if (arr) arr.push(u);
    else byDept.set(key, [u]);
  }
  const depts = [...byDept.keys()].sort((a, b) => {
    if (a === KAFEDRASIZ) return 1;
    if (b === KAFEDRASIZ) return -1;
    return a.localeCompare(b, 'uz');
  });

  const now = new Date().toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const title = opts.title || 'iMentor — kirish ma’lumotlari';

  const sections = depts
    .map((dept) => {
      const people = byDept
        .get(dept)!
        .slice()
        .sort((a, b) => fullName(a).localeCompare(fullName(b), 'uz'));
      const body = people
        .map((u, i) => {
          const pwd = u.password_is_initial
            ? `<code>${esc(INITIAL_STAFF_PASSWORD)}</code>`
            : '<span class="muted">o’zi o’rnatgan</span>';
          return `<tr>
            <td class="num">${i + 1}</td>
            <td>${esc(fullName(u))}</td>
            <td><code>${esc(u.phone_digits)}</code></td>
            <td>${pwd}</td>
          </tr>`;
        })
        .join('');
      return `<section>
        <h2>${esc(dept)} <span class="count">${people.length} kishi</span></h2>
        <table>
          <thead>
            <tr><th class="num">#</th><th>F.I.Sh.</th><th>Login (Xodim ID)</th><th>Parol</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const empty = list.length === 0
    ? '<p class="empty">Ko’rsatadigan xodim topilmadi.</p>'
    : '';

  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 24px; background: #f6f7f9; }
  header { max-width: 900px; margin: 0 auto 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #555; font-size: 13px; margin: 0 0 4px; }
  .how { background: #eef4ff; border: 1px solid #cfe0ff; border-radius: 10px; padding: 10px 14px; font-size: 12.5px; color: #21406e; max-width: 900px; margin: 8px auto 0; }
  .how b { color: #123; }
  .toolbar { max-width: 900px; margin: 12px auto; }
  button { font: inherit; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 0; background: #2563eb; color: #fff; cursor: pointer; }
  section { max-width: 900px; margin: 0 auto 18px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; page-break-inside: avoid; }
  h2 { font-size: 15px; margin: 0 0 8px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .count { font-size: 12px; font-weight: 500; color: #777; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #888; }
  td.num, th.num { width: 34px; color: #aaa; text-align: right; }
  code { font-family: "SF Mono", Consolas, monospace; font-size: 13px; background: #f2f4f7; padding: 2px 6px; border-radius: 5px; }
  .muted { color: #999; font-size: 12px; }
  .empty { max-width: 900px; margin: 40px auto; text-align: center; color: #777; }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none; }
    .how { background: #fff; }
    section { border: 0; padding: 0 0 10px; }
  }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <p class="sub">Farg’ona jamoat salomatligi tibbiyot instituti · ${esc(now)} · ${list.length} xodim</p>
  <div class="how">
    <b>Qanday kiriladi:</b> <b>imentor.uz</b> saytini oching → “Xodim” bo’limini tanlang →
    <b>Login</b> (Xodim ID) va <b>parol</b>ni kiriting. Kirgach parolingizni almashtirishingiz mumkin.
    Parolni unutgan yoki “o’zi o’rnatgan” deb yozilgan xodim administratorga murojaat qilsin.
  </div>
</header>
<div class="toolbar"><button onclick="window.print()">🖨 Chop etish</button></div>
${sections}
${empty}
</body>
</html>`;
}

/** Ro'yxatni yangi oynada ochadi (chop etish uchun). */
export function openStaffCredentials(
  rows: StaffDirectoryEntry[],
  opts: { onlyInitial: boolean; title?: string },
): boolean {
  const html = buildStaffCredentialsHtml(rows, opts);
  const win = window.open('', '_blank');
  if (!win) return false; // popup bloklangan
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
