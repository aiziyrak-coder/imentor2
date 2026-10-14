/**
 * `**qalin**` belgilarini QALIN matnga aylantirish (2026-10-13).
 *
 * Rektor talabi: vaziyatli masalada klinik fikrlash uchun muhim joylar —
 * hal qiluvchi simptom, vaqt, hayotiy ko'rsatkich, chetga chiqqan tahlil —
 * qalin bo'lsin, talaba nimaga e'tibor berishni o'rganadi.
 *
 * Keys matni ko'p joyda SOF MATN sifatida chiqadi (o'qituvchining «Keys»
 * sahifasi, katalog, admin kutubxonasi, chop etish, PDF) — markdown faqat
 * onlayn talaba sahifasida ishlanadi. Shuning uchun bu yerda butun markdown
 * emas, FAQAT qalinlik ajratiladi: qolgan belgilar matnda qanday bo'lsa
 * shundayligida qoladi.
 *
 * Toq `**` matnni qalin qilib "oqizib" yubormaydi: juftlik topilmasa,
 * belgilar matnning o'zi sifatida qoladi.
 */
import React from 'react';

/** Juft `**...**` — ichida kamida bitta belgi, `**` yo'q. */
const BOLD_RE = /\*\*([^*]+?)\*\*/g;

export type BoldPiece = { bold: boolean; text: string };

/**
 * Matnni qalin va oddiy bo'laklarga ajratadi.
 *
 * Tarjima yoki qo'lda tahrir `**` ni buzib qo'ysa (bittasi yo'qolsa) —
 * bo'lak oddiy matn bo'lib qoladi, ya'ni hech narsa yo'qolmaydi.
 */
export function splitBold(text: string): BoldPiece[] {
  const source = text || '';
  const out: BoldPiece[] = [];
  let at = 0;
  BOLD_RE.lastIndex = 0;
  let hit = BOLD_RE.exec(source);
  while (hit) {
    const inner = hit[1].trim();
    if (inner) {
      if (hit.index > at) out.push({ bold: false, text: source.slice(at, hit.index) });
      out.push({ bold: true, text: inner });
      at = hit.index + hit[0].length;
    }
    hit = BOLD_RE.exec(source);
  }
  if (at < source.length) out.push({ bold: false, text: source.slice(at) });
  return out.length ? out : [{ bold: false, text: source }];
}

/** Matnda qalin belgisi bormi — ortiqcha ish qilmaslik uchun. */
export function hasBold(text: string): boolean {
  BOLD_RE.lastIndex = 0;
  return BOLD_RE.test(text || '');
}

/** `**` belgilarini olib tashlaydi (qalinligi ko'rinmaydigan joylar uchun). */
export function stripBold(text: string): string {
  return (text || '').replace(BOLD_RE, (_all, inner: string) => inner.trim());
}

/**
 * React ko'rinishi: qalin bo'laklar `<strong>` bo'ladi.
 *
 * Rang berilmaydi — `text-inherit` qolib, atrofdagi matn rangini oladi:
 * rektor "qora rangda qalinroq" deb so'radi, ya'ni ajratuvchi rang emas.
 */
export function renderBold(text: string, keyPrefix = 'b'): React.ReactNode {
  const pieces = splitBold(text);
  if (pieces.length === 1 && !pieces[0].bold) return pieces[0].text;
  return pieces.map((piece, i) =>
    piece.bold ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-[#06283d]">
        {piece.text}
      </strong>
    ) : (
      <React.Fragment key={`${keyPrefix}-${i}`}>{piece.text}</React.Fragment>
    ),
  );
}

/** PDF/HTML uchun: EKRANLANGAN matndagi `**...**` ni `<b>` ga aylantiradi. */
export function boldToHtml(escaped: string): string {
  return (escaped || '').replace(BOLD_RE, (_all, inner: string) => `<b>${inner.trim()}</b>`);
}
