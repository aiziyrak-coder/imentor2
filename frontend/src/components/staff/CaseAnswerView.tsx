import React, { useMemo } from 'react';
import { parseCaseAnswer } from '../../utils/parseCaseAnswer';
import LinkifiedText from './LinkifiedText';

type Props = {
  text: string;
  refAnchorPrefix?: string;
  citeUrls?: Record<number, string>;
  className?: string;
};

const CRITICAL_RE =
  /\b(kontrendikatsiya|kontrindikatsiya|favqulodda|shoshilinch|xavfli|ogohlantirish|hayotiy\s+ko'?rsatma|contraindication|emergency|urgent|warning|противопоказан\w*|неотложн\w*|опасн\w*)\b/i;

const DOSE_RE =
  /\b\d+(?:[.,]\d+)?\s*(?:mg|мкг|мл|ml|g\/l|mmol\/l|%|mmHg|уд\/мин|beats\/min)\b/i;

function isCriticalToken(token: string): boolean {
  return CRITICAL_RE.test(token);
}

function isDoseToken(token: string): boolean {
  return DOSE_RE.test(token);
}

function renderRichBody(
  body: string,
  refAnchorPrefix?: string,
  citeUrls?: Record<number, string>,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let key = 0;

  const tokenRe =
    /\[(\d+)\]|\b(?:kontrendikatsiya|kontrindikatsiya|favqulodda|shoshilinch|xavfli|ogohlantirish|hayotiy\s+ko'?rsatma|contraindication|emergency|urgent|warning|противопоказан\w*|неотложн\w*|опасн\w*)\b|\b\d+(?:[.,]\d+)?\s*(?:mg|мкг|мл|ml|g\/l|mmol\/l|%|mmHg|уд\/мин|beats\/min)\b/gi;

  let last = 0;
  for (const match of body.matchAll(tokenRe)) {
    const start = match.index ?? 0;
    if (start > last) {
      nodes.push(...linkifyChunk(body.slice(last, start), key));
      key += 10;
    }
    const token = match[0];
    const cite = /^\[(\d+)\]$/.exec(token);
    if (cite) {
      const n = cite[1];
      const num = Number(n);
      const externalUrl = citeUrls?.[num]?.trim();
      const anchorHref = refAnchorPrefix ? `#${refAnchorPrefix}-${n}` : undefined;
      nodes.push(
        <a
          key={`c_${key++}`}
          href={externalUrl || anchorHref || undefined}
          target={externalUrl ? '_blank' : undefined}
          rel={externalUrl ? 'noopener noreferrer' : undefined}
          onClick={(e) => {
            if (externalUrl) return;
            if (!anchorHref) return;
            e.preventDefault();
            document.getElementById(`${refAnchorPrefix}-${n}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
            });
          }}
          title={externalUrl ? `Manba [${n}]` : `Manba [${n}]`}
          className="inline-flex items-center justify-center mx-0.5 px-1 min-w-[1.15rem] h-[1.15rem] rounded-full bg-blue-600 text-white text-[10px] font-bold align-super hover:bg-blue-800 no-underline cursor-pointer"
        >
          {n}
        </a>,
      );
    } else if (isCriticalToken(token)) {
      nodes.push(
        <mark key={`k_${key++}`} className="bg-rose-100 text-rose-900 font-semibold px-0.5 rounded-sm not-italic">
          {token}
        </mark>,
      );
    } else if (isDoseToken(token)) {
      nodes.push(
        <mark key={`d_${key++}`} className="bg-blue-100 text-blue-900 font-semibold px-0.5 rounded-sm not-italic">
          {token}
        </mark>,
      );
    } else {
      nodes.push(token);
    }
    last = start + token.length;
  }
  if (last < body.length) {
    nodes.push(...linkifyChunk(body.slice(last), key));
  }
  return nodes;
}

function linkifyChunk(chunk: string, baseKey: number): React.ReactNode[] {
  if (!chunk) return [];
  const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = baseKey;
  for (const match of chunk.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(chunk.slice(last, start));
    let href = match[0];
    let trailing = '';
    const punct = /[.,;:!?]+$/.exec(href);
    if (punct) {
      trailing = punct[0];
      href = href.slice(0, punct.index);
    }
    parts.push(
      <a
        key={`u_${k++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-blue-700 underline underline-offset-2 break-all hover:text-blue-900"
      >
        {href}
      </a>,
    );
    if (trailing) parts.push(trailing);
    last = start + match[0].length;
  }
  if (last < chunk.length) parts.push(chunk.slice(last));
  return parts.length ? parts : [chunk];
}

export function extractCiteUrlsFromBibliography(bibliography: string): Record<number, string> {
  const out: Record<number, string> = {};
  if (!bibliography.trim()) return out;
  for (const line of bibliography.split('\n')) {
    const m = line.match(/\[(\d+)\]/);
    if (!m) continue;
    const urlMatch = line.match(/https?:\/\/[^\s<>"')\]]+/);
    if (!urlMatch) continue;
    let href = urlMatch[0];
    const punct = /[.,;:!?]+$/.exec(href);
    if (punct) href = href.slice(0, punct.index);
    out[Number(m[1])] = href;
  }
  return out;
}

/** Yagona klinik fikr — A–E nishonsiz, oqim matn. */
export default function CaseAnswerView({
  text,
  refAnchorPrefix = 'case-ref',
  citeUrls: citeUrlsProp,
  className = '',
}: Props) {
  const parsed = useMemo(() => parseCaseAnswer(text), [text]);
  const citeUrls = useMemo(() => {
    const fromBib = extractCiteUrlsFromBibliography(parsed.bibliography);
    return { ...fromBib, ...(citeUrlsProp || {}) };
  }, [parsed.bibliography, citeUrlsProp]);

  if (!parsed.sections.length) {
    return (
      <div className={className}>
        <LinkifiedText
          text={parsed.leftover || text}
          className="text-[14.5px] leading-[1.7] text-slate-800 whitespace-pre-wrap"
        />
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {parsed.leftover ? (
        <p className="text-[14.5px] leading-[1.7] text-slate-800 whitespace-pre-wrap">{parsed.leftover}</p>
      ) : null}
      {parsed.sections.map((section) => (
        <div key={section.key}>
          <h5 className="text-[12px] font-bold text-slate-600 mb-1.5 tracking-wide">{section.title}</h5>
          <div className="text-[14.5px] leading-[1.75] text-slate-800 whitespace-pre-wrap">
            {renderRichBody(section.body, refAnchorPrefix, citeUrls)}
          </div>
        </div>
      ))}
    </div>
  );
}
