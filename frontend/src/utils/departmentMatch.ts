/** Akademik katalog kafedra nomini bazadagi kafedra bilan solishtirish. */

const SYNONYMS: Array<[string, string]> = [
  ['gematologiya', 'gemotologiya'],
  ['ftizatriya', 'ftiziatriya'],
  ['kasallilar', 'kasalliklar'],
  ['otorinoloringologiya', 'otorinolaringologiya'],
  ['otoloringologiya', 'otorinolaringologiya'],
  ['gigienasi', 'gigiyenasi'],
  ['gigiyenasi', 'gigiyena'],
  ['gigiena', 'gigiyena'],
  ['ortapediya', 'ortopediya'],
  ['psixiatriya', 'psixatriya'],
  ['virusalogiya', 'virusologiya'],
  ['gistalogiya', 'gistologiya'],
  ['tilli', 'tili'],
  ['fakultet va', 'fakultativ va'],
  ['uralogiya', 'urologiya'],
];

const STOPWORDS = new Set(['va', 'bilan', 'hamda', 'yonalishidagi', 'fanlar']);

export function softDeptKey(value: string): string {
  let s = (value || '')
    .trim()
    .toLowerCase()
    .replace(/[‘’ʻʼ`'´]/g, "'")
    .replace(/\b(kafedrasi|kafedra|sillabus|syllabus)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [src, dst] of SYNONYMS) {
    s = s.replaceAll(src, dst);
  }
  return s.replace(/\s+/g, ' ').trim();
}

function trailingNum(key: string): string | null {
  const m = key.match(/ (\d+)$/);
  return m ? m[1] : null;
}

function deptTokens(key: string): string[] {
  const out: string[] = [];
  for (const t of key.split(' ')) {
    if (!t || STOPWORDS.has(t)) continue;
    if (t.length < 3 && !/^\d+$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function tokenSubsetMatch(a: string, b: string): boolean {
  const ta = deptTokens(a);
  const tb = deptTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  if (ta[0] !== tb[0]) return false;
  const sa = new Set(ta);
  const sb = new Set(tb);
  return [...sa].every((t) => sb.has(t)) || [...sb].every((t) => sa.has(t));
}

export function namesSoftMatch(a: string, b: string): boolean {
  const ka = softDeptKey(a);
  const kb = softDeptKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const na = trailingNum(ka);
  const nb = trailingNum(kb);
  if (na && nb && na !== nb) return false;
  if (na && !nb) return false;
  if (nb && !na) return false;
  if (ka.includes(kb) || kb.includes(ka)) return true;
  return tokenSubsetMatch(ka, kb);
}

export function matchDepartmentByName<
  T extends { name: string; code?: string | null; subjects_count?: number },
>(catalogName: string, catalogCode: string | null | undefined, academic: T[]): T | null {
  const kn = softDeptKey(catalogName);
  const kc = softDeptKey(catalogCode || '');
  const matches = academic.filter(
    (d) =>
      softDeptKey(d.name) === kn ||
      (kc && softDeptKey(d.code || '') === kc) ||
      namesSoftMatch(d.name, catalogName),
  );
  if (!matches.length) return null;
  return [...matches].sort((a, b) => {
    const sc = (b.subjects_count || 0) - (a.subjects_count || 0);
    if (sc) return sc;
    return b.name.length - a.name.length;
  })[0];
}
