import type { ContentSlide, PresentationContent, SlideType } from './presentationContentSchema';
import { isImageSafe } from './imageSafety';

/**
 * Slayd rasmlari — OCHIQ manbadan (Wikipedia maqola rasmlari, Wikimedia
 * Commons). Qoidalar:
 *  1. HAR slaydda O'Z rasmi — bir rasm ikki slaydda TAKRORLANMAYDI (global dedupe).
 *  2. "Default"/umumiy zaxira rasm YO'Q — slaydning o'z mavzusiga mos rasm
 *     topilmasa, slayd rasmsiz (to'liq matnli) chiqadi. Avval bu yerda
 *     "human skin layers…" kabi qattiq yozilgan so'rovlar bor edi va butun
 *     taqdimot bitta rasmga to'lib ketardi.
 *  3. Rasm PPTX ga kichraytirib (max 1100px, JPEG) qo'yiladi — 5 MB lik fayl
 *     o'rniga ~0.5 MB.
 *  4. ODOB (2026-10-20, taqdimotda odobsiz rasm chiqdi). Uch qatlam:
 *     - nom/kategoriya/tavsifda yalang'ochlik, jinsiy mazmun bo'lsa — rasm olinmaydi;
 *     - intim a'zolar va jinsiy salomatlik mavzusida — faqat CHIZMA (sxema,
 *       diagramma, mikroskop/UZI), hech qachon foto. Klinik foto (masalan
 *       jinsiy a'zodagi yara) moderatsiyadan 0.02 bilan o'tib ketadi;
 *     - har rasm slaydga qo'yilishidan OLDIN serverda ko'rib tekshiriladi
 *       (`imageSafety`). Tekshirib bo'lmasa — rasm qo'yilmaydi.
 *     Openverse olib tashlandi: u Flickr va boshqa saytlardan hech qanday
 *     tavsifsiz rasm qaytarardi.
 */

const IRRELEVANT_IMAGE_HINTS =
  /portrait|photographer|painting|artwork|sculpture|statue|album cover|logo|flag of|coat of arms|stamp|banknote|coin\b|signature|map of|book cover/i;

/** Hech qachon slaydga tushmaydi (chizma bo'lsa ham). */
const EXPLICIT_HINTS =
  /\b(?:porn\w*|erotic\w*|nud(?:e|es|ity|ism|ist|ists)\b|naked\w*|topless\w*|bottomless|semi-?nude|undress\w*|sexual(?:ly)? (?:explicit|intercourse|act|activity|activities|position\w*|arousal)|sex (?:act|toy|toys|work|worker|workers|scene|position\w*)|intercourse|coitus|copulat\w*|masturbat\w*|orgasm\w*|ejaculat\w*|fetish\w*|bdsm|bondage|strip(?:tease|per|pers)|prostitut\w*|hentai|xxx|nsfw|lingerie|bikini\w*|swimsuit\w*|underwear|playboy|dildo\w*|kama ?sutra|upskirt|voyeur\w*|pin-?up)\b|порн|эрот|обнаж|голая|голый|секс|yalang'och|jinsiy aloqa/i;

/** Intim a'zolar — foto MUMKIN EMAS, faqat chizma. */
const INTIMATE_HINTS =
  /\b(?:penis\w*|penile|phall\w*|glans|foreskin|prepuce|scrot\w*|testic\w*|testes|vulva\w*|vagin\w*|labia\w*|labium|clitor\w*|hymen\w*|genital\w*|pubic|pubis|perine\w*|anus|anal|buttock\w*|breast\w*|nipple\w*|areola\w*|mammar\w*|circumcis\w*|crowning|condom\w*|sexual\w*)\b/i;

/**
 * Mavzu sezgir (jinsiy salomatlik, akusherlik, urologiya, venerologiya) —
 * butun slayd uchun faqat chizma qidiriladi va olinadi.
 */
const SENSITIVE_TOPIC =
  /\b(?:reproductive|obstetric\w*|gyn(?:a)?ecolog\w*|urolog\w*|androlog\w*|venere\w*|sexually transmitted|stis?|stds?|syphili\w*|chancre|gonorrh\w*|chlamydi\w*|trichomon\w*|hpv|condylom\w*|genital herpes|contracept\w*|childbirth|delivery|labou?r|postpartum|episiotom\w*|caesarean|cesarean|prostat\w*|erectile|infertil\w*|menstrua\w*|menopaus\w*|lactation|breastfeed\w*|mastectom\w*|puberty)\b/i;

/** Chizma yoki tibbiy tasvir (mikroskop, UZI, rentgen) — tana fotosi emas. */
const DRAWING_HINTS =
  /\b(?:diagram\w*|schematic\w*|schema|scheme|illustration\w*|drawing\w*|drawn|vector|infographic\w*|flow ?chart\w*|chart|cross[- ]section\w*|label(?:l)?ed|micrograph\w*|histolog\w*|microscop\w*|ultraso\w*|sonogra\w*|radiograph\w*|x-ray\w*|mammogra\w*|mri|ct scan\w*|electron micro\w*)\b/i;

function isDrawing(c: Pick<ImageCandidate, 'vector' | 'hint'>): boolean {
  return c.vector || DRAWING_HINTS.test(c.hint);
}

/** Slayd mavzusi sezgirmi — so'rov va sarlavhaga qarab. */
export function isSensitiveSlide(slide: Pick<ContentSlide, 'image_query' | 'title'>): boolean {
  const text = `${slide.image_query || ''} ${slide.title || ''}`;
  return SENSITIVE_TOPIC.test(text) || INTIMATE_HINTS.test(text);
}

/** Rasm slaydga yaraydimi — faqat metadata bo'yicha (rasmni ko'rmasdan). */
export function candidateAllowed(
  c: Pick<ImageCandidate, 'vector' | 'hint'>,
  sensitive: boolean,
): boolean {
  if (EXPLICIT_HINTS.test(c.hint)) return false;
  if ((sensitive || INTIMATE_HINTS.test(c.hint)) && !isDrawing(c)) return false;
  return true;
}

/**
 * Muzey/arxiv skanlari: eski atlas sahifasi, gravyura, qo'lyozma. Mavzuga
 * "mos" ko'rinadi, lekin slaydda o'qib bo'lmaydigan sarg'aygan kitob varag'i
 * chiqadi — dars uchun yaroqsiz.
 */
const ARCHIVE_SCAN_HINTS =
  /rijksmuseum|lithograph|engraving|etching|woodcut|manuscript|title page|\bfolio\b|\bplate [IVXLC0-9]|\d{4}\s*(?:edition|book)|wellcome collection\b.*\bprint\b/i;

const IMAGE_TYPES: SlideType[] = ['content_bullets', 'image_focus', 'two_column', 'case_study'];

/** Rasm nomi/URL bo'yicha yagona kalit — bir xil faylning turli o'lchamlari bitta sanaladi. */
function imageKey(url: string): string {
  const clean = url.split('?')[0];
  const commons = clean.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/i);
  if (commons) return decodeURIComponent(commons[1]).toLowerCase();
  const file = clean.split('/').pop() || clean;
  return decodeURIComponent(file).replace(/^\d+px-/, '').toLowerCase();
}

export type ImageCandidate = {
  url: string;
  credit: string;
  key: string;
  hint: string;
  /** SVG chizma (PNG ko'rinishida olinadi). */
  vector: boolean;
  /** Mavzu maqolasidagi rasm — qidiruv natijasidan ishonchliroq. */
  fromArticle?: boolean;
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'with', 'to', 'diagram',
  'illustration', 'medical', 'anatomy', 'photo', 'image', 'chart',
]);

/** Wikipedia maqolasini qidirish uchun qisqa asosiy atama. */
function coreTerm(query: string): string {
  const words = query
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  return words.slice(0, 3).join(' ').trim();
}

function isUsableMime(mime: string): boolean {
  return mime.startsWith('image/') && !mime.includes('svg') && !mime.includes('gif');
}

/** Commons `imageinfo` — File: sarlavhalaridan URL + litsenziya (bitta so'rovda 10 tagacha). */
async function commonsImageInfo(fileTitles: string[]): Promise<ImageCandidate[]> {
  if (!fileTitles.length) return [];
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
    `&titles=${encodeURIComponent(fileTitles.slice(0, 10).join('|'))}` +
    '&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1200';
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: { pages?: Record<string, WikiPage> };
  };
  return Object.values(data.query?.pages || {})
    .map(pageToCandidate)
    .filter((c): c is ImageCandidate => Boolean(c));
}

export type WikiPage = {
  title?: string;
  imageinfo?: {
    thumburl?: string;
    url?: string;
    mime?: string;
    width?: number;
    height?: number;
    extmetadata?: {
      Artist?: { value?: string };
      LicenseShortName?: { value?: string };
      Categories?: { value?: string };
      ObjectName?: { value?: string };
      ImageDescription?: { value?: string };
    };
  }[];
};

export function pageToCandidate(page: WikiPage): ImageCandidate | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const mime = info.mime || '';
  // SVG chizmalar (anatomik sxema, mexanizm) — eng yaxshi dars rasmi; Commons
  // ularni PNG ko'rinishida beradi (thumburl).
  const vector = mime.includes('svg');
  if (!isUsableMime(mime) && !(vector && info.thumburl)) return null;
  const imgUrl = info.thumburl || info.url;
  if (!imgUrl) return null;
  // Belgi/ikonka va ingichka banner — slaydga yaramaydi.
  const w = info.width || 0;
  const h = info.height || 0;
  if (!vector && w && h && (Math.max(w, h) < 300 || Math.max(w, h) / Math.min(w, h) > 3.5)) return null;
  const meta = info.extmetadata || {};
  const hint = `${page.title || ''} ${meta.ObjectName?.value || ''} ${meta.Categories?.value || ''} ${
    meta.ImageDescription?.value || ''
  }`.replace(/<[^>]+>/g, ' ');
  if (IRRELEVANT_IMAGE_HINTS.test(hint) || ARCHIVE_SCAN_HINTS.test(hint)) return null;
  if (EXPLICIT_HINTS.test(hint)) return null;
  const license = meta.LicenseShortName?.value || 'Wikimedia Commons';
  const artist = (meta.Artist?.value || '').replace(/<[^>]+>/g, '').trim().slice(0, 60);
  return {
    url: imgUrl,
    credit: artist ? `${artist} · ${license} (Wikimedia Commons)` : `${license} (Wikimedia Commons)`,
    key: imageKey(imgUrl),
    hint,
    vector,
  };
}

/**
 * 1-manba: Wikipedia MAQOLASI rasmlari. Eng mos manba — "impetigo" so'ralganda
 * aynan impetigo maqolasidagi klinik rasmlar qaytadi (umumiy "teri" chizmasi emas).
 */
async function searchWikipediaArticleImages(query: string): Promise<ImageCandidate[]> {
  const term = coreTerm(query);
  if (!term) return [];
  try {
    const searchUrl =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search' +
      `&srsearch=${encodeURIComponent(term)}&srlimit=2&srnamespace=0`;
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { query?: { search?: { title?: string }[] } };
    const titles = ((data.query?.search || []).map((s) => s.title).filter(Boolean) as string[])
      // "Nudity", "Pornography" kabi maqolalar — rasmlari ham shunday.
      .filter((title) => !EXPLICIT_HINTS.test(title));
    const out: ImageCandidate[] = [];
    for (const title of titles) {
      const mediaRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title)}`,
        { signal: AbortSignal.timeout(9000) },
      );
      if (!mediaRes.ok) continue;
      const media = (await mediaRes.json()) as {
        items?: { type?: string; title?: string; showInGallery?: boolean }[];
      };
      const files = (media.items || [])
        .filter((i) => i.type === 'image' && i.title?.startsWith('File:'))
        .map((i) => i.title as string)
        .slice(0, 8);
      out.push(...(await commonsImageInfo(files)).map((c) => ({ ...c, fromArticle: true })));
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Commons qidiruvida bu so'zlar bor fayllar umuman qaytmasin (CirrusSearch
 * `-so'z`). Metadata filtri baribir ishlaydi — bu birinchi to'siq.
 */
const SEARCH_EXCLUDE = ' -nude -naked -nudity -erotic -porn -sex -topless -lingerie';

/** 2-manba: Wikimedia Commons to'g'ridan-to'g'ri qidiruvi. */
async function searchCommons(query: string): Promise<ImageCandidate[]> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!q) return [];
  try {
    const searchUrl =
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
      `&generator=search&gsrsearch=${encodeURIComponent(q + SEARCH_EXCLUDE)}&gsrnamespace=6&gsrlimit=10` +
      '&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1200';
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage & { index?: number }> } };
    return Object.values(data.query?.pages || {})
      // Qidiruv tartibi (eng mosi birinchi) — `pages` obyektida u yo'qoladi.
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
      .map(pageToCandidate)
      .filter((c): c is ImageCandidate => Boolean(c));
  } catch {
    return [];
  }
}

const DRAWING_WORDS = /\b(?:diagram|schematic|illustration|drawing|scheme)\b/i;

/**
 * Slaydning O'Z mazmunidan so'rovlar. Fanga/mavzuga qattiq yozilgan zaxira
 * so'rovlar YO'Q — aks holda hamma slayd bitta rasmga tushib qoladi.
 * Sezgir mavzuda so'rovga "diagram" qo'shiladi — foto emas, sxema qidiriladi.
 */
export function queriesForSlide(slide: ContentSlide): string[] {
  const sensitive = isSensitiveSlide(slide);
  const primary = (slide.image_query || '').replace(/\s+/g, ' ').trim();
  const title = (slide.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return [primary, coreTerm(primary), title]
    .map((q) => q.trim())
    .map((q) => (sensitive && q && !DRAWING_WORDS.test(q) ? `${q} diagram` : q))
    .filter((q, i, arr) => q.length >= 3 && arr.indexOf(q) === i)
    .slice(0, 3);
}

/** So'rovning mazmunli so'zlari (o'zak — "lesions" ham "lesion" ga mos). */
function queryStems(queries: string[]): string[] {
  const words = queries
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !DRAWING_WORDS.test(w));
  return [...new Set(words.map((w) => w.slice(0, Math.max(4, w.length - 2))))];
}

/**
 * Nomzodlarni saralash: avval odob, keyin moslik. Qidiruv natijasida so'rov
 * so'zlaridan birortasi ham bo'lmasa — u tasodifiy rasm, olinmaydi.
 */
export function rankCandidates(
  candidates: ImageCandidate[],
  queries: string[],
  sensitive: boolean,
): ImageCandidate[] {
  const stems = queryStems(queries);
  return candidates
    .filter((c) => candidateAllowed(c, sensitive))
    .map((c, order) => {
      const hint = c.hint.toLowerCase();
      const hits = stems.filter((s) => hint.includes(s)).length;
      const score = hits + (c.fromArticle ? 1 : 0) + (c.vector || DRAWING_HINTS.test(c.hint) ? 0.5 : 0);
      return { c, hits, score, order };
    })
    .filter(({ c, hits }) => c.fromArticle || hits > 0 || !stems.length)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ c }) => c);
}

/** Bir slayd uchun nomzodlar (yuklab olinmaydi — faqat ro'yxat). */
async function collectCandidatesUncached(slide: ContentSlide): Promise<ImageCandidate[]> {
  const out: ImageCandidate[] = [];
  const seen = new Set<string>();
  const push = (list: ImageCandidate[]) => {
    for (const c of list) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push(c);
    }
  };
  const queries = queriesForSlide(slide);
  const sensitive = isSensitiveSlide(slide);
  for (const [i, query] of queries.entries()) {
    const sources = i === 0
      ? [searchWikipediaArticleImages(query), searchCommons(query)]
      : [searchCommons(query)];
    const results = await Promise.all(sources.map((p) => p.catch(() => [] as ImageCandidate[])));
    results.forEach(push);
    if (rankCandidates(out, queries, sensitive).length >= 6) break;
  }
  return rankCandidates(out, queries, sensitive);
}

const candidateCache = new Map<string, Promise<ImageCandidate[]>>();
async function collectCandidates(slide: ContentSlide): Promise<ImageCandidate[]> {
  const key = JSON.stringify(queriesForSlide(slide));
  if (!candidateCache.has(key)) {
    if (candidateCache.size >= 128) candidateCache.delete(candidateCache.keys().next().value!);
    candidateCache.set(key, collectCandidatesUncached(slide).then((items) => {
      if (!items.length) candidateCache.delete(key);
      return items;
    }).catch(() => { candidateCache.delete(key); return []; }));
  }
  return candidateCache.get(key)!;
}

/** Rasmni yuklab, kichraytirib data URL qiladi (PPTX hajmi uchun). */
const MAX_IMAGE_PX = 1100;
const MAX_IMAGE_BYTES = 8_000_000;

export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache', signal: AbortSignal.timeout(14000) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!isUsableMime(contentType)) return null;
    const blob = await res.blob();
    if (blob.size < 3_000 || blob.size > MAX_IMAGE_BYTES) return null;
    return (await shrinkToDataUrl(blob)) ?? (await blobToDataUrl(blob));
  } catch {
    return null;
  }
}

async function blobToDataUrl(blob: Blob): Promise<string | null> {
  // Node/test muhitida FileReader yo'q — Buffer bilan.
  if (typeof FileReader === 'undefined') {
    if (typeof Buffer === 'undefined') return null;
    const buf = Buffer.from(await blob.arrayBuffer());
    return `data:${blob.type || 'image/jpeg'};base64,${buf.toString('base64')}`;
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || '') || null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/** Canvas orqali max 1100px ga kichraytirish; muhit qo'llamasa — null. */
async function shrinkToDataUrl(blob: Blob): Promise<string | null> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMAGE_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Shaffof PNG lar qora bo'lib qolmasin.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

/**
 * Rasm topilmasa: image_focus → content_bullets (to'liq matn layout).
 * Soxta "default" rasm yoki geometrik art qo'yilmaydi.
 */
export function demoteSlidesWithoutImages(content: PresentationContent): PresentationContent {
  return {
    ...content,
    slides: content.slides.map((slide) => {
      if (slide.imageUrl) return slide;
      if (slide.slide_type === 'image_focus') {
        return { ...slide, slide_type: 'content_bullets' as const };
      }
      return slide;
    }),
  };
}

const SEARCH_CONCURRENCY = 4;
const DOWNLOAD_CONCURRENCY = 4;
/** Bir slayd uchun nechta nomzod yuklab, tekshirib ko'riladi. */
const TRIES_PER_SLIDE = 4;

/** Server bergan hukm — bir rasm bir sessiyada bir marta tekshiriladi. */
const verdictCache = new Map<string, Promise<boolean>>();

function verdictKey(sourceUrl: string, dataUrl: string): string {
  return sourceUrl ? sourceUrl.split('?')[0] : `data:${dataUrl.length}:${dataUrl.slice(-160)}`;
}

function checkedSafe(sourceUrl: string, dataUrl: string, context: string): Promise<boolean> {
  const key = verdictKey(sourceUrl, dataUrl);
  let verdict = verdictCache.get(key);
  if (!verdict) {
    if (verdictCache.size >= 600) verdictCache.delete(verdictCache.keys().next().value!);
    verdict = isImageSafe(dataUrl, context).then((safe) => {
      // Tarmoq yiqilgan bo'lishi mumkin — "xavfli" hukmini eslab qolmaymiz,
      // keyingi safar yana tekshiriladi (rasm baribir qo'yilmaydi).
      if (!safe) verdictCache.delete(key);
      return safe;
    });
    verdictCache.set(key, verdict);
  }
  return verdict;
}

/** Saqlangan havola nomidagi belgilar — rasmni ko'rmasdan ham rad etiladi. */
function sourceUrlAllowed(sourceUrl: string, slide: Pick<ContentSlide, 'image_query' | 'title'>): boolean {
  if (!sourceUrl) return true;
  let name = sourceUrl.split('?')[0];
  try {
    name = decodeURIComponent(name);
  } catch {
    /* noto'g'ri kodlangan havola — o'zicha */
  }
  const vector = /\.svg\b/i.test(name);
  return candidateAllowed({ hint: name.replace(/[_\-./]+/g, ' '), vector }, isSensitiveSlide(slide));
}

/**
 * PPTX yig'ishdan oldin: HAR rasmli slayd tekshiriladi — saqlangan taqdimot
 * (rasm havoladan qayta tortiladi), eski qoralama (data:URL bilan) ham.
 * O'tmagan rasm olib tashlanadi, `image_focus` slayd matnliga aylanadi.
 */
export async function ensureSafeSlideImages(content: PresentationContent): Promise<PresentationContent> {
  const items = content.slides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => slide.imageUrl?.startsWith('data:') || slide.imageSourceUrl);
  if (!items.length) return content;
  const checked = await inBatches(items, DOWNLOAD_CONCURRENCY, async ({ slide, index }) => {
    const src = slide.imageSourceUrl || '';
    if (!sourceUrlAllowed(src, slide)) return { index, dataUrl: null };
    const dataUrl = slide.imageUrl?.startsWith('data:') ? slide.imageUrl : await fetchImageAsDataUrl(src);
    if (!dataUrl) return { index, dataUrl: null };
    const safe = await checkedSafe(src, dataUrl, slide.image_query || slide.title || '');
    return { index, dataUrl: safe ? dataUrl : null };
  });
  const byIndex = new Map(checked.map((c) => [c.index, c.dataUrl]));
  const slides = content.slides.map((slide, index) => {
    if (!byIndex.has(index)) return slide;
    const dataUrl = byIndex.get(index);
    if (dataUrl) return { ...slide, imageUrl: dataUrl };
    const { imageUrl: _img, imageCredit: _credit, imageSourceUrl: _src, ...rest } = slide;
    return rest as ContentSlide;
  });
  const dropped = checked.filter((c) => !c.dataUrl).length;
  if (dropped) console.warn(`[presentationImages] ${dropped} ta rasm tekshiruvdan o'tmadi yoki yuklanmadi — olib tashlandi`);
  return demoteSlidesWithoutImages({ ...content, slides });
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export async function resolvePresentationImages(
  content: PresentationContent,
): Promise<PresentationContent> {
  const targets = content.slides
    .map((slide, index) => ({ slide, index }))
    // Faqat layoutida rasm sloti BOR slaydlar. statistics/comparison/process
    // uchun ham image_query keladi, lekin ular rasmni ko'rsatmaydi — behuda
    // qidiruv generatsiyani sekinlashtirardi.
    .filter(
      ({ slide }) => !slide.imageUrl?.startsWith('data:') && IMAGE_TYPES.includes(slide.slide_type),
    );

  // 1-bosqich: nomzodlarni parallel yig'amiz (hali yuklab olmaymiz).
  const candidateLists = await inBatches(targets, SEARCH_CONCURRENCY, ({ slide }) =>
    collectCandidates(slide).catch(() => [] as ImageCandidate[]),
  );

  // 2-bosqich: GLOBAL band qilish — bir rasm faqat bitta slaydga.
  const taken = new Set<string>(content.slides.filter(s => s.imageSourceUrl).map(s => imageKey(s.imageSourceUrl!)));
  const plan = targets.map((target, i) => {
    const queue = (candidateLists[i] || []).filter((c) => !taken.has(c.key));
    const chosen = queue[0];
    if (chosen) taken.add(chosen.key);
    return { ...target, chosen, queue };
  });

  // 3-bosqich: tanlanganlarni yuklab, ODOB bo'yicha tekshiramiz; yiqilsa yoki
  // rad etilsa — navbatdagi band bo'lmagani.
  let rejected = 0;
  const resolved = await inBatches(plan, DOWNLOAD_CONCURRENCY, async (item) => {
    for (const candidate of item.queue.slice(0, TRIES_PER_SLIDE)) {
      if (candidate.key !== item.chosen?.key && taken.has(candidate.key)) continue;
      taken.add(candidate.key); // reserve before awaiting: parallel fallbacks cannot choose the same file
      const dataUrl = await fetchImageAsDataUrl(candidate.url);
      if (!dataUrl) continue;
      const context = item.slide.image_query || item.slide.title || '';
      if (!(await checkedSafe(candidate.url, dataUrl, context))) {
        rejected += 1;
        continue;
      }
      return { index: item.index, dataUrl, credit: candidate.credit, src: candidate.url };
    }
    return { index: item.index, dataUrl: null, credit: '', src: '' };
  });
  if (rejected) console.warn(`[presentationImages] ${rejected} ta rasm odob tekshiruvidan o'tmadi`);

  const byIndex = new Map(resolved.filter((r) => r.dataUrl).map((r) => [r.index, r]));
  const slides = content.slides.map((slide, index) => {
    const hit = byIndex.get(index);
    if (!hit?.dataUrl) return slide;
    return { ...slide, imageUrl: hit.dataUrl, imageCredit: hit.credit, imageSourceUrl: hit.src };
  });

  const withImages = slides.filter((s) => s.imageUrl).length;
  if (withImages < targets.length) {
    console.warn(`[presentationImages] ${targets.length} dan ${withImages} slaydga rasm topildi`);
  }
  return demoteSlidesWithoutImages({ ...content, slides });
}
