/** Ma'ruza matnidagi `(Manba: kitob, sahifa)` iqtiboslarini giperhavolaga aylantiradi. */

const CITE_RE = /\((?:Manba|Источник|Source)\s*:\s*([^)]+)\)/gi;

const PLACEHOLDER_RE =
  /^(?:kitob\s*nomi|название\s*книги|book\s*name|\{[^}]*\}|sahifa-bet)/i;

const FENCED_OR_LINK_RE = /```[\s\S]*?```|`[^`]+`|\[[^\]]*\]\([^)\s]+\)/g;

function isPlaceholder(inner: string): boolean {
  return PLACEHOLDER_RE.test(inner.trim());
}

export function citationSearchHref(inner: string): string | null {
  const raw = (inner || '').trim();
  if (!raw || isPlaceholder(raw)) return null;
  const urlMatch = raw.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (urlMatch) {
    let href = urlMatch[0];
    const punct = /[.,;:]+$/.exec(href);
    if (punct) href = href.slice(0, punct.index);
    return href;
  }
  const first = raw.split(',')[0] || raw;
  const title = first.replace(/^[\s"«»„“”']+|[\s"«»„“”']+$/g, '').trim();
  if (title.length < 3) return null;
  const page = raw.match(
    /(?:sahifa|стр\.?|p(?:ages?)?\.?|bet)\s*[:.]?\s*(\d+(?:\s*[-–—]\s*\d+)?)/i,
  );
  const q = page?.[1] ? `"${title}" ${page[1]}` : `"${title}"`;
  return `https://www.google.com/search?tbm=bks&q=${encodeURIComponent(q)}`;
}

function linkifyPlain(text: string): string {
  return text.replace(CITE_RE, (full, inner: string) => {
    const href = citationSearchHref(inner);
    if (!href) return full;
    const label = full.replace(/[[\]]/g, '');
    return `[${label}](${href})`;
  });
}

/** Markdown ichidagi `(Manba: …)` ni `[Manba: …](url)` ga aylantiradi. */
export function linkifyLectureSources(markdown: string): string {
  const text = markdown || '';
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(FENCED_OR_LINK_RE)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(linkifyPlain(text.slice(last, start)));
    parts.push(match[0]);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(linkifyPlain(text.slice(last)));
  return parts.join('');
}
