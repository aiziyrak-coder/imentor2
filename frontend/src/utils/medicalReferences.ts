/** Ilmiy manbalar — test, keys va ma'ruza uchun. */

export interface MedicalReference {
  title: string;
  authors?: string;
  year?: string;
  publisher?: string;
  /** Tashqi havola. Kitob (RAG darsligi) manbalarida bo'lmaydi. */
  url?: string;
  /** Darslik sahifalari ("114" yoki "114-118, 220"). Faqat kitob manbalarida. */
  pages?: string;
  note?: string;
  citeIndex?: number;
  /** Ko'rinish: kitob vs jurnal gipersilkasi. */
  kind?: 'book' | 'pubmed' | 'scholar' | 'wikipedia' | 'journal';
}

const TRUSTED_HOSTS = [
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'doi.org',
  'who.int',
  'cdc.gov',
  'nih.gov',
  'cochranelibrary.com',
  'nice.org.uk',
  'ema.europa.eu',
  'medscape.com',
  'bmj.com',
  'thelancet.com',
  'nejm.org',
  'lex.uz',
  'fjsti.uz',
];

export const MEDICAL_REFERENCES_AI_RULES = `
MAJBURIY ilmiy asoslash:
- Har bir savol/keys uchun "references" maydoni: kamida 2 ta manba (to'g'ridan-to'g'ri tegishli).
- Butun JSON da umumiy "references": 3–6 ta asosiy adabiyot.
- Har bir manba obyekti: title, authors (ixtiyoriy), year, publisher (nashriyot/sayt nomi), url (to'liq https://...).
- URL faqat haqiqiy ochiladigan manbalardan: PubMed, DOI, WHO, CDC, NIH, Cochrane, NICE, Medscape, BMJ, Lancet, lex.uz.
- PubMed: https://pubmed.ncbi.nlm.nih.gov/PMID/ yoki qidiruv https://pubmed.ncbi.nlm.nih.gov/?term=...
- Manba sarlavhasi va URL mos kelishi shart; o'ylab topilgan yoki umumiy sahifa taqiqlanadi.
- explanation/answer matnida [1], [2] kabi iqtiboslar bo'lishi mumkin (references ro'yxatidagi tartib bo'yicha).
`.trim();

export const LECTURE_REFERENCES_AI_RULES = `
Oxirida alohida bo'lim: ## Foydalanilgan adabiyotlar
Har bir punkt Markdown havola: - [To'liq manba sarlavhasi (muallif, yil)](https://...)
Kamida 5 ta manba; PubMed/WHO/CDC/DOI ustunlik qiladi.
`.trim();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isTrustedUrl(url: string): boolean {
  const h = hostOf(url);
  if (!h) return false;
  return TRUSTED_HOSTS.some((t) => h === t || h.endsWith(`.${t}`));
}

function pubmedSearchUrl(title: string): string {
  const q = encodeURIComponent(title.slice(0, 120));
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`;
}

function normalizeOne(raw: Partial<MedicalReference> | null | undefined): MedicalReference | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim();
  if (title.length < 4) return null;
  let url = String(raw.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!url || !isTrustedUrl(url)) {
    url = pubmedSearchUrl(title);
  }
  const authors = String(raw.authors || '').trim();
  const year = String(raw.year || '').trim();
  const publisher = String(raw.publisher || '').trim() || hostOf(url) || 'PubMed';
  const note = String(raw.note || '').trim();
  return {
    title: title.slice(0, 500),
    ...(authors ? { authors: authors.slice(0, 200) } : {}),
    ...(year ? { year: year.slice(0, 12) } : {}),
    publisher: publisher.slice(0, 120),
    url,
    ...(note ? { note: note.slice(0, 300) } : {}),
  };
}

export function normalizeMedicalReferences(
  input: unknown,
  fallbackTopic?: string,
): MedicalReference[] {
  const list = Array.isArray(input) ? input : [];
  const out: MedicalReference[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const ref = normalizeOne(item as Partial<MedicalReference>);
    if (!ref || seen.has(ref.url)) continue;
    seen.add(ref.url);
    out.push(ref);
  }
  if (out.length === 0 && fallbackTopic?.trim()) {
    out.push({
      title: `${fallbackTopic} — PubMed qidiruv`,
      publisher: 'PubMed',
      url: pubmedSearchUrl(fallbackTopic),
      note: 'Mavzu bo‘yicha ilmiy maqolalar qidiruvi',
    });
  }
  return out.slice(0, 12);
}

export function mergeReferences(...groups: MedicalReference[][]): MedicalReference[] {
  const out: MedicalReference[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const ref of group) {
      if (!ref?.url || seen.has(ref.url)) continue;
      seen.add(ref.url);
      out.push(ref);
    }
  }
  return out.slice(0, 16);
}
