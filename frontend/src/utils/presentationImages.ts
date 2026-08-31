import type { ContentSlide, PresentationContent, SlideType } from './presentationContentSchema';

/**
 * Slayd rasmlari — bir nechta OCHIQ manbadan (Wikipedia maqola rasmlari,
 * Wikimedia Commons, Openverse). Qoidalar:
 *  1. HAR slaydda O'Z rasmi — bir rasm ikki slaydda TAKRORLANMAYDI (global dedupe).
 *  2. "Default"/umumiy zaxira rasm YO'Q — slaydning o'z mavzusiga mos rasm
 *     topilmasa, slayd rasmsiz (to'liq matnli) chiqadi. Avval bu yerda
 *     "human skin layers…" kabi qattiq yozilgan so'rovlar bor edi va butun
 *     taqdimot bitta rasmga to'lib ketardi.
 *  3. Rasm PPTX ga kichraytirib (max 1100px, JPEG) qo'yiladi — 5 MB lik fayl
 *     o'rniga ~0.5 MB.
 */

const IRRELEVANT_IMAGE_HINTS =
  /portrait|photographer|painting|artwork|album cover|logo|flag of|coat of arms|stamp|banknote|coin\b|signature|map of|book cover/i;

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

export type ImageCandidate = { url: string; credit: string; key: string; hint: string };

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
    '&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1200';
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: { pages?: Record<string, WikiPage> };
  };
  return Object.values(data.query?.pages || {})
    .map(pageToCandidate)
    .filter((c): c is ImageCandidate => Boolean(c));
}

type WikiPage = {
  title?: string;
  imageinfo?: {
    thumburl?: string;
    url?: string;
    mime?: string;
    extmetadata?: {
      Artist?: { value?: string };
      LicenseShortName?: { value?: string };
      Categories?: { value?: string };
      ObjectName?: { value?: string };
      ImageDescription?: { value?: string };
    };
  }[];
};

function pageToCandidate(page: WikiPage): ImageCandidate | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  if (!isUsableMime(info.mime || '')) return null;
  const imgUrl = info.thumburl || info.url;
  if (!imgUrl) return null;
  const meta = info.extmetadata || {};
  const hint = `${page.title || ''} ${meta.ObjectName?.value || ''} ${meta.Categories?.value || ''} ${
    meta.ImageDescription?.value || ''
  }`.replace(/<[^>]+>/g, ' ');
  if (IRRELEVANT_IMAGE_HINTS.test(hint) || ARCHIVE_SCAN_HINTS.test(hint)) return null;
  const license = meta.LicenseShortName?.value || 'Wikimedia Commons';
  const artist = (meta.Artist?.value || '').replace(/<[^>]+>/g, '').trim().slice(0, 60);
  return {
    url: imgUrl,
    credit: artist ? `${artist} · ${license} (Wikimedia Commons)` : `${license} (Wikimedia Commons)`,
    key: imageKey(imgUrl),
    hint,
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
    const titles = (data.query?.search || []).map((s) => s.title).filter(Boolean) as string[];
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
      out.push(...(await commonsImageInfo(files)));
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** 2-manba: Wikimedia Commons to'g'ridan-to'g'ri qidiruvi. */
async function searchCommons(query: string): Promise<ImageCandidate[]> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!q) return [];
  try {
    const searchUrl =
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
      `&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=8` +
      '&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1200';
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
    return Object.values(data.query?.pages || {})
      .map(pageToCandidate)
      .filter((c): c is ImageCandidate => Boolean(c));
  } catch {
    return [];
  }
}

/** 3-manba: Openverse (Flickr, muzeylar va b. ochiq litsenziyali agregator). */
async function searchOpenverse(query: string): Promise<ImageCandidate[]> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!q) return [];
  try {
    const res = await fetch(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=8&mature=false`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: {
        id?: string;
        title?: string;
        url?: string;
        thumbnail?: string;
        creator?: string;
        license?: string;
        source?: string;
        tags?: { name?: string }[];
      }[];
    };
    return (data.results || [])
      .map((r) => {
        const url = r.thumbnail || r.url;
        if (!url) return null;
        const hint = `${r.title || ''} ${r.source || ''} ${(r.tags || []).map((t) => t.name).join(' ')}`;
        if (IRRELEVANT_IMAGE_HINTS.test(hint) || ARCHIVE_SCAN_HINTS.test(hint)) return null;
        const raw = (r.license || '').toUpperCase();
        const license = raw && !raw.startsWith('CC') && raw !== 'PDM' ? `CC ${raw}` : raw || 'Open';
        const creator = (r.creator || '').slice(0, 60);
        const source = r.source || 'Openverse';
        return {
          url,
          credit: creator ? `${creator} · ${license} (${source})` : `${license} (${source})`,
          key: imageKey(url),
          hint,
        };
      })
      .filter((c): c is ImageCandidate => Boolean(c));
  } catch {
    return [];
  }
}

/**
 * Slaydning O'Z mazmunidan so'rovlar. Fanga/mavzuga qattiq yozilgan zaxira
 * so'rovlar YO'Q — aks holda hamma slayd bitta rasmga tushib qoladi.
 */
function queriesForSlide(slide: ContentSlide): string[] {
  const primary = (slide.image_query || '').replace(/\s+/g, ' ').trim();
  const title = (slide.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return [primary, coreTerm(primary), title]
    .map((q) => q.trim())
    .filter((q, i, arr) => q.length >= 3 && arr.indexOf(q) === i)
    .slice(0, 3);
}

/** Bir slayd uchun nomzodlar (yuklab olinmaydi — faqat ro'yxat). */
async function collectCandidates(slide: ContentSlide): Promise<ImageCandidate[]> {
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
  for (const [i, query] of queries.entries()) {
    const sources = i === 0
      ? [searchWikipediaArticleImages(query), searchCommons(query)]
      : [searchCommons(query)];
    const results = await Promise.all(sources.map((p) => p.catch(() => [] as ImageCandidate[])));
    results.forEach(push);
    if (out.length >= 6) break;
  }
  // Wikimedia hech narsa bermasa — uchinchi manba (rate-limit tufayli oxirida).
  if (!out.length && queries[0]) {
    push(await searchOpenverse(queries[0]).catch(() => []));
  }
  return out;
}

/** Rasmni yuklab, kichraytirib data URL qiladi (PPTX hajmi uchun). */
const MAX_IMAGE_PX = 1100;
const MAX_IMAGE_BYTES = 8_000_000;

export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(14000) });
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
  const taken = new Set<string>();
  const plan = targets.map((target, i) => {
    const queue = (candidateLists[i] || []).filter((c) => !taken.has(c.key));
    const chosen = queue[0];
    if (chosen) taken.add(chosen.key);
    return { ...target, chosen, queue };
  });

  // 3-bosqich: tanlanganlarni yuklab olamiz; yiqilsa — navbatdagi band bo'lmagani.
  const resolved = await inBatches(plan, DOWNLOAD_CONCURRENCY, async (item) => {
    for (const candidate of item.queue.slice(0, 3)) {
      if (candidate.key !== item.chosen?.key && taken.has(candidate.key)) continue;
      const dataUrl = await fetchImageAsDataUrl(candidate.url);
      if (dataUrl) {
        taken.add(candidate.key);
        return { index: item.index, dataUrl, credit: candidate.credit, src: candidate.url };
      }
    }
    return { index: item.index, dataUrl: null, credit: '', src: '' };
  });

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
