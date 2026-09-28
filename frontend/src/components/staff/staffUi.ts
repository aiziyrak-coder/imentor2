/** O'qituvchi sahifalarining umumiy tokenlari.
 *
 * Bir joyda turgani uchun bu yerdagi o'zgarish butun interfeysga tarqaladi.
 *
 * ── Dizayn tili ────────────────────────────────────────────────────────
 * Ilgari har blok o'zini ko'rsatishga urinardi: oq quti, chegara, soya,
 * rangli nishon, to'ldirilgan yorliq. Sahifada o'ntasi yonma-yon turganda
 * hammasi bir xil baland ovozda gapirar, ko'z esa qayerga qarashni
 * bilmasdi.
 *
 * Endi qoida sodda:
 *   – yuza oq qog'oz: soch tolasidek chegara, soya YO'Q;
 *   – bo'limlarni bo'sh joy va ingichka chiziq ajratadi, quti emas;
 *   – holat rang bilan emas, OG'IRLIK bilan ko'rsatiladi (muhimi to'q,
 *     qolgani och);
 *   – rang — kamyob narsa: faqat amal, to'g'ri javob va manba uchun.
 *
 * O'lchamlar: sarlavha 18-20px, bo'lim 15px, matn 13.5-14px, izoh 12px.
 */

export const STAFF_HEADING = 'text-slate-900';
export const STAFF_BODY = 'text-slate-600';
export const STAFF_MUTED = 'text-slate-400';

/**
 * Yuza — oq qog'oz.
 *
 * `ios-glass` shaffoflik va qo'sh soya berardi: ostidagi kartochkalar
 * ko'rinib turar, sahifa esa qavat-qavat bo'lib og'irlashardi. Endi
 * yuzani faqat soch tolasidek chiziq belgilaydi — kulrang fonda shuning
 * o'zi yetarli.
 */
export const staffCard = 'rounded-xl bg-white ring-1 ring-slate-900/[0.06]';
export const staffCardLg = 'rounded-2xl bg-white ring-1 ring-slate-900/[0.06]';

/**
 * Ro'yxat elementi — bosiladigan plitka.
 *
 * Mavzular ro'yxatida sinab ko'rilgan qoida: elementlarni CHIZIQ emas,
 * ORALIQ ajratadi. Ikki ustunda qatorlar har xil balandlikda tushadi va
 * chiziqlar hech qachon bir chiziqqa kelmaydi — natijada ustunlar ko'zga
 * bitta yaxlit matn bo'lib qo'shilib ketadi. Halqa faqat shaklni yopadi.
 */
export const staffTile =
  'rounded-xl bg-white ring-1 transition-all duration-200 ring-slate-900/[0.06]';
/** Bosiladigan plitka — ustiga kelganda halqa yorishadi. */
export const staffTileClickable = `${staffTile} hover:ring-slate-900/15`;
/** Tanlangan plitka — halqa qorayadi. */
export const staffTileOn = 'rounded-xl bg-white ring-1 ring-slate-900/25 transition-all duration-200';

const BTN =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold ' +
  'transition-colors duration-150 active:scale-[0.98] ' +
  'disabled:pointer-events-none disabled:opacity-40';

/**
 * Asosiy amal — qora, tekis.
 *
 * Ilgari ko'k edi va ikki qatlamli yorug'lik tashlardi: sahifadagi eng
 * og'ir narsa mazmun emas, shu tugma bo'lardi. Ko'k endi faqat HAVOLA va
 * MANBA rangi — o'qituvchi ko'k narsani ko'rsa "bosiladigan matn" deb
 * biladi. Amal esa qora: sahifada bittagina bo'ladi va shusiz ham
 * ko'rinadi.
 */
export const staffBtnPrimary =
  `${BTN} bg-slate-900 px-4 py-2.5 text-[13.5px] text-white hover:bg-slate-700`;

export const staffBtnSecondary =
  `${BTN} bg-white px-3.5 py-2.5 text-[13.5px] text-slate-700 ` +
  'ring-1 ring-slate-900/[0.08] hover:bg-slate-50 hover:text-slate-900';

export const staffBtnGhost =
  `${BTN} px-2.5 py-2 text-[13px] text-slate-500 hover:bg-slate-900/[0.04] hover:text-slate-900`;

/** Yorliq — to'ldirilgan emas, yengil. */
export const staffChip =
  'inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-500';

/** Asosiy yorliq (dars turi) — qora fon o'rniga to'q matn. */
export const staffChipAccent =
  'inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-900';

/**
 * Kiritish maydoni. Telefonda 16px — kichigida iOS maydonga bosilganda
 * sahifani kattalashtirib yuboradi va foydalanuvchi qo'lda qaytarishga
 * majbur bo'ladi.
 */
export const staffInput =
  'w-full rounded-lg bg-white px-3.5 py-3 text-[16px] text-slate-900 ' +
  'ring-1 ring-slate-900/[0.08] outline-none transition ' +
  'placeholder:text-slate-400 focus:ring-[1.5px] focus:ring-blue-500 ' +
  'sm:py-2.5 sm:text-[14px]';

export const staffLabel = 'mb-1.5 block text-[12.5px] font-medium text-slate-500';

/** Bo'lim ustidagi mayda yozuv — sahifaning eng tinch elementi. */
export const staffEyebrow =
  'text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400';

/* ─────────────────────────────────────────────────────────────────────────
 * DARS MATERIALI TOKENLARI
 *
 * To'rt bo'lim (Ma'ruza, Taqdimot, Keys, Test) bir xil ko'rinishda bo'lishi
 * uchun material bloklari SHU yerdagi tokenlardan yig'iladi.
 *
 * Rang qoidasi:
 *   KO'K   — manba/adabiyot va tushuntirish (o'qituvchi ishonadigan ma'lumot)
 *   YASHIL — to'g'ri javob
 *   SARIQ  — faqat ogohlantirish (xato emas, lekin e'tibor talab qiladi)
 *
 * Ranglar endi TO'LDIRMAYDI — chap chekkadagi ingichka chiziq bo'lib
 * turadi. Shunda o'qituvchining ko'zi rangga emas, matnga tushadi.
 * ───────────────────────────────────────────────────────────────────────── */

/** Bo'lim ichidagi kichik sarlavha ("TO'G'RI JAVOB TAHLILI", "MANBALAR"). */
export const staffBlockTitle =
  'flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em]';

/** Savol/keys raqami — nishon emas, oddiy raqam. */
export const staffIndexBadge =
  'w-6 shrink-0 text-right text-[12px] font-semibold tabular-nums text-slate-400';

/** Savol matni — kartochkadagi eng muhim satr, shuning uchun to'q. */
export const staffQuestionText =
  'text-[15px] sm:text-[16px] font-semibold leading-relaxed text-slate-900';

/** Javob variantlari — to'g'risi yashil chiziq bilan, qolgani tinch. */
export const staffOptionCorrect =
  'rounded-lg border-l-2 border-emerald-500 bg-emerald-50/50 px-3 py-2.5 ' +
  'text-[13.5px] font-semibold text-emerald-900';
export const staffOptionNeutral =
  'rounded-lg border-l-2 border-slate-200 px-3 py-2.5 text-[13.5px] text-slate-600';

/** Tushuntirish/yechim bloki — KO'K chiziq. */
export const staffExplainBox = 'border-l-2 border-blue-500/40 pl-4 space-y-2.5';
export const staffExplainTitle = `${staffBlockTitle} text-blue-600`;
export const staffExplainBody =
  'text-[14px] leading-relaxed text-slate-700 whitespace-pre-wrap';

/**
 * MANBALAR bloki — HAMISHA KO'K.
 * Ilgari sariq (amber) edi va ogohlantirishlar bilan bir xil rangda bo'lib,
 * o'qituvchi uni "diqqat" belgisi deb o'qirdi. Sariq endi faqat ogohlantirish.
 */
export const staffSourceBox = 'border-l-2 border-blue-500/40 pl-4';
export const staffSourceTitle = `${staffBlockTitle} text-blue-600`;
export const staffSourceItem = 'text-slate-700 leading-relaxed';
export const staffSourceLink =
  'font-semibold text-blue-600 hover:text-blue-700 hover:underline underline-offset-2 inline-flex items-center gap-1 break-words';
export const staffSourceMeta = 'text-slate-400';

export const staffProse =
  // prose-lg ning standart h1 o'lchami uzun tibbiy sarlavhalarda ekranni to'sib
  // qo'yardi — h1 aniq o'lchamga bog'landi.
  //
  // Muhim qo'shimchalar (dars o'qish uchun):
  //  - `prose-strong` — AI qalin qilgan atama/ko'rsatkichlar haqiqatan ajralib
  //    tursin (rang + qalinlik), aks holda oddiy matndan farqi bilinmasdi;
  //  - `prose-a` KO'K — havola/manba butun tizimda bir xil rangda;
  //  - satr oralig'i va ro'yxat oralig'i kattaroq — proyektordan ham o'qiladi.
  'staff-prose prose prose-slate prose-base sm:prose-lg max-w-none text-slate-800 ' +
  'prose-headings:text-slate-900 prose-headings:font-semibold prose-headings:tracking-tight ' +
  'prose-h1:text-[22px] sm:prose-h1:text-[26px] prose-h1:leading-snug prose-h1:mt-0 prose-h1:mb-5 ' +
  'prose-h2:text-[18px] sm:prose-h2:text-[20px] prose-h2:mt-8 prose-h2:mb-3 prose-h2:pb-2 prose-h2:border-b prose-h2:border-slate-900/[0.07] ' +
  'prose-h3:text-[16px] sm:prose-h3:text-[17px] prose-h3:mt-6 prose-h3:mb-2 ' +
  'prose-p:leading-[1.75] prose-p:text-slate-700 ' +
  'prose-strong:text-slate-900 prose-strong:font-semibold ' +
  'prose-li:marker:text-slate-300 prose-li:my-1 prose-ul:my-4 prose-ol:my-4 ' +
  'prose-a:text-blue-600 prose-a:font-medium prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-blue-700 ' +
  'prose-blockquote:border-l-slate-300 prose-blockquote:text-slate-600 prose-blockquote:not-italic prose-blockquote:font-normal ' +
  'prose-table:text-[14px] prose-th:text-slate-900 prose-th:font-semibold ' +
  'prose-code:text-slate-900 prose-code:bg-slate-900/[0.05] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none';
