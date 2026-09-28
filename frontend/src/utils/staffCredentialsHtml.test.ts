import { describe, expect, it } from 'vitest';
import { buildStaffCredentialsHtml, INITIAL_STAFF_PASSWORD } from './staffCredentialsHtml';
import type { StaffDirectoryEntry } from './staffDirectoryApi';

const base: StaffDirectoryEntry = {
  phone_digits: '',
  phone_display: '',
  first_name: '',
  last_name: '',
  display_name: '',
  role: 'hodim',
  faculty: '',
  department: '',
  direction: '',
  participant_kind: '',
  study_group: '',
  job_title: '',
  is_active: true,
  date_joined: '',
  last_login: null,
  password_is_initial: true,
};

function staff(over: Partial<StaffDirectoryEntry>): StaffDirectoryEntry {
  return { ...base, ...over };
}

describe('buildStaffCredentialsHtml', () => {
  const rows = [
    staff({ phone_digits: '3442012012', last_name: 'Egamberdiyeva', first_name: 'Gulnoraxon', department: 'Epidemiologiya', password_is_initial: true }),
    staff({ phone_digits: '3442112068', last_name: 'Qodirova', first_name: 'Aziza', department: 'Epidemiologiya', password_is_initial: true }),
    staff({ phone_digits: '998901112233', last_name: "To'rayev", first_name: 'Sardor', department: 'Terapiya', last_login: '2026-09-10', password_is_initial: false }),
  ];

  it('faqat kirmagan (boshlang‘ich parolli) xodimlarni chiqaradi', () => {
    const html = buildStaffCredentialsHtml(rows, { onlyInitial: true });
    expect(html).toContain('3442012012');
    expect(html).toContain('3442112068');
    // Kirgan xodim (paroli o'zgargan bo'lishi mumkin) ro'yxatga tushmaydi.
    expect(html).not.toContain('998901112233');
    expect(html).not.toContain('Sardor');
  });

  it('onlyInitial=false bo‘lsa hammasini, kirganga parol o‘rniga izoh chiqaradi', () => {
    const html = buildStaffCredentialsHtml(rows, { onlyInitial: false });
    expect(html).toContain('998901112233');
    // Kirgan xodimga boshlang'ich parol KO'RSATILMAYDI.
    expect(html).toContain('o’zi o’rnatgan');
    // Boshlang'ich parol faqat kirmaganlar uchun.
    expect(html).toContain(INITIAL_STAFF_PASSWORD);
  });

  it('kafedra bo‘yicha guruhlaydi', () => {
    const html = buildStaffCredentialsHtml(rows, { onlyInitial: false });
    expect(html).toContain('Epidemiologiya');
    expect(html).toContain('Terapiya');
    // Epidemiologiyada 2 kishi.
    expect(html).toContain('2 kishi');
  });

  it('kafedrasiz xodimni alohida guruhga qo‘yadi', () => {
    const html = buildStaffCredentialsHtml([staff({ phone_digits: '1234', department: '' })], {
      onlyInitial: false,
    });
    expect(html).toContain('Kafedra biriktirilmagan');
  });

  it('ism va kafedrani HTML dan himoyalaydi (XSS)', () => {
    const html = buildStaffCredentialsHtml(
      [staff({ phone_digits: '1', first_name: '<script>alert(1)</script>', department: 'X' })],
      { onlyInitial: false },
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('bo‘sh ro‘yxatda tushunarli xabar beradi', () => {
    const html = buildStaffCredentialsHtml([], { onlyInitial: true });
    expect(html).toContain('topilmadi');
  });
});
