/**
 * Yaratilgan savol/keys MAVZUGA tegishlimi — arzon, AI'siz tekshiruv.
 *
 * 2026-09-17 auditida mavzuning birorta asosiy so'zi ham uchramagan
 * materiallar topildi: "Dinshunoslik fanining predmeti" testida "45 yoshli
 * erkak hansirash bilan...", "Gigienaning predmeti va vazifalari" keysida
 * "68 yoshli bemor, qorin og'rig'i". Bu tekshiruv shunday natijani ushlaydi
 * va generatsiyani bir marta qayta so'rashga asos beradi.
 *
 * Faqat mavzu va natija BIR tilda bo'lganda ishlaydi — inglizcha natijani
 * o'zbekcha sarlavha so'zlari bilan solishtirib bo'lmaydi.
 */

/** Hech narsa aytmaydigan sarlavha so'zlari — ular bo'yicha moslik o'lchanmaydi. */
const STOP = new Set([
  'asoslari', 'asosiy', 'tushuncha', 'tushunchalar', 'tushunchasi', 'haqida', 'umumiy', 'predmeti',
  'vazifalari', 'maqsadi', 'fanining', 'kirish', 'mavzu', 'ahamiyati', 'xususiyatlari', 'turlari',
  'usullari', 'rivojlanish', 'bosqichlari', 'hamda', 'ularning', 'orqali', 'boyicha',
  'moduli', 'modul', 'amaliy', 'nazariy', 'mashgulot', 'bilan', 'uchun',
  'введение', 'основы', 'понятие', 'общие', 'задачи', 'предмет', 'значение', 'методы', 'виды',
  'introduction', 'basics', 'general', 'concept', 'concepts', 'methods', 'types', 'overview',
]);

function normalize(text: string): string {
  return (text || '').toLowerCase().replace(/['‘’`ʻʼ]/g, '').replace(/ё/g, 'е');
}

const WORD_RE = /[a-zа-яўқғҳ]{5,}/g;

/** Mavzuning asosiy so'z o'zaklari (5 harflik boshlanma — qo'shimchalardan xoli). */
export function topicTerms(topic: string): string[] {
  const words = normalize(topic).match(WORD_RE) || [];
  const stems = words.filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5));
  return [...new Set(stems)];
}

const CYRILLIC_RE = /[Ѐ-ӿ]/g;
const LATIN_RE = /[A-Za-z]/g;
const EN_WORD_RE = /\b(the|of|and|with|is|are|which|for|in|to)\b/gi;
const UZ_WORD_RE = /\b(va|bilan|uchun|hisoblanadi|qaysi|ushbu|emas|yoki|bu|shu)\b|\w+(lar|ning|dagi|lari)\b/gi;

/** Qo'pol til belgisi: kirill / o'zbek lotin / ingliz. `short` — qisqa sarlavha uchun. */
export function roughLanguage(text: string, short = false): 'cyr' | 'uz' | 'en' {
  const s = text || '';
  const cyr = (s.match(CYRILLIC_RE) || []).length;
  const lat = (s.match(LATIN_RE) || []).length;
  if (cyr > lat) return 'cyr';
  const en = (s.match(EN_WORD_RE) || []).length;
  if (short) return en > 0 ? 'en' : 'uz';
  const uz = (s.match(UZ_WORD_RE) || []).length;
  return en > uz ? 'en' : 'uz';
}

/** Mavzu so'zlaridan hech biri uchramagan bo'laklar ulushi (0..1). Tekshirib bo'lmasa — null. */
export function offTopicShare(topic: string, items: string[]): number | null {
  const terms = topicTerms(topic);
  const texts = items.filter((t) => (t || '').trim().length > 20);
  if (!terms.length || !texts.length) return null;
  // Natija boshqa tilda bo'lsa (masalan inglizcha guruh) sarlavha so'zlari bilan solishtirib bo'lmaydi.
  if (roughLanguage(topic, true) !== roughLanguage(texts.join(' '))) return null;
  let off = 0;
  for (const text of texts) {
    const hay = normalize(text);
    if (!terms.some((t) => hay.includes(t))) off += 1;
  }
  return off / texts.length;
}

/** Real ma'lumotda sozlangan chegara: 0.5 dan yuqorisi aniq mavzudan chetga chiqqan natija. */
export const OFF_TOPIC_THRESHOLD = 0.5;

/** Ko'rsatma: promptga qo'shiladi (test va keys, har ikki domen). */
export const TOPIC_FIT_RULE =
  'MAVZUGA MOSLIK (eng muhim qoida): har savol va keys FAQAT shu mavzuni o\'rgangan talaba yecha oladigan ' +
  'bo\'lsin. Fanning boshqa mavzusiga ham to\'g\'ri keladigan umumiy savol, mavzuga aloqasiz bemor ssenariysi ' +
  'yoki mavzu nomi faqat bezak bo\'lib qolgan savol TAQIQLANADI. Savol sharti yoki to\'g\'ri javobda mavzuning ' +
  'asosiy tushunchasi (sarlavhadagi atamalar) aniq qatnashsin.';

export const OFF_TOPIC_RETRY_NOTE =
  'OLDINGI NATIJA YAROQSIZ: savollarning ko\'pchiligi mavzudan chetga chiqqan — mavzuning asosiy atamalari umuman ' +
  'uchramadi. Butunlay qayta yozing: har savol AYNAN sarlavhadagi mavzuni tekshirsin.';

/**
 * Test variantlari va savol shakli.
 *
 * 2026-10-13 auditi (31 201 jonli savol) ko'rsatdi: qoida bajarilmagan —
 * 47,8% savolda to'g'ri javob eng uzun variant, 54,5% da bitta savol ichida
 * ikki savol, 6,4% da javob savolning o'zida aytilgan. Shuning uchun qoida
 * SANOQ bilan va man etilgan shakllar bilan qayta yozildi; natija
 * `utils/testQuality.ts` da tekshiriladi.
 */
export const OPTION_LENGTH_RULE =
  'SAVOL SHAKLI (qattiq talab, buzilgan savol OLINMAYDI):\n' +
  '1) BITTA savolda AYNAN BITTA so\'roq gap va AYNAN BITTA savol belgisi (?) bo\'lsin. ' +
  'Ikkita savol ("... nimani ko\'rsatadi? ... qanday bo\'lishi kerak?") TAQIQLANADI — ' +
  'ikki savol kerak bo\'lsa, ularni ikki alohida savol qilib yozing.\n' +
  '2) Javob savol matnida AYTILMASIN: savolda to\'g\'ri javobning raqami yoki iborasi ' +
  'takrorlanmasin (masalan savolda "1000 CFU/m³ dan oshsa" deb yozib, javobni ' +
  '"1000 CFU/m³ dan oshmasligi kerak" qilish TAQIQLANADI).\n' +
  '3) To\'g\'ri javob variantlar ichida eng uzuni yoki eng batafsili BO\'LMASIN — ' +
  '5 variantning uzunligi (so\'z soni ±20%), tuzilishi va aniqlik darajasi bir-biriga yaqin bo\'lsin. ' +
  'Javobni uzunligidan taxmin qilib bo\'lmasin.\n' +
  '4) Variantlar bir-birini TAKRORLAMASIN; "hammasi to\'g\'ri", "barcha javoblar to\'g\'ri", ' +
  '"yuqoridagilarning hammasi" TAQIQLANADI.\n' +
  '5) Variantlar bir xil turda bo\'lsin (hammasi tashxis, yoki hammasi dori, yoki hammasi me\'yor) — ' +
  'turlari aralashgan ro\'yxat javobni oshkor qiladi.';
