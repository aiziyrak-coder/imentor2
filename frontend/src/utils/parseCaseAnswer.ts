/** Keys yechimi matnini bo'limlarga va adabiyotlar ro'yxatiga ajratadi.
 *  Yangi format: sarlavha (harfsiz). Eski format: a) ... e). */

export type CaseAnswerSectionKey = 'a' | 'b' | 'c' | 'd' | 'e';

export type CaseAnswerSection = {
  key: CaseAnswerSectionKey;
  title: string;
  body: string;
};

export type ParsedCaseAnswer = {
  sections: CaseAnswerSection[];
  leftover: string;
  bibliography: string;
};

const REFS_HEADING_RE =
  /(?:^|\n)\s*(?:FOYDALANILGAN\s+ADABIYOTLAR|ИСПОЛЬЗОВАННАЯ\s+ЛИТЕРАТУРА|REFERENCES\s+USED)\s*:?\s*(?:\n|$)/i;

const LETTER_RE = /^([a-e])\)\s*(.+)$/i;

const HEADING_PATTERNS: { key: CaseAnswerSectionKey; re: RegExp }[] = [
  { key: 'a', re: /^(?:#{1,3}\s*)?(klinik\s+(?:tashxis|xulosa)|clinical\s+diagnosis|клиническ)/i },
  { key: 'b', re: /^(?:#{1,3}\s*)?(differensial|differential|дифференциал)/i },
  { key: 'c', re: /^(?:#{1,3}\s*)?(qo'?shimcha\s+tekshiruv|keyingi\s+tekshiruv|additional\s+invest|дополнительн)/i },
  { key: 'd', re: /^(?:#{1,3}\s*)?(davolash|taktika|management|лечение|тактика)/i },
  { key: 'e', re: /^(?:#{1,3}\s*)?(amaliy\s+tavsiya|kuzatuv|recommendation|практическ|прогноз)/i },
];

function matchHeading(line: string): { key: CaseAnswerSectionKey; title: string } | null {
  const trimmed = line.trim().replace(/^#{1,3}\s*/, '');
  if (!trimmed || trimmed.length > 90) return null;
  const letter = trimmed.match(LETTER_RE);
  if (letter) {
    return { key: letter[1].toLowerCase() as CaseAnswerSectionKey, title: letter[2].trim() };
  }
  for (const p of HEADING_PATTERNS) {
    if (p.re.test(trimmed) && trimmed.split(/\s+/).length <= 10) {
      return { key: p.key, title: trimmed };
    }
  }
  return null;
}

export function parseCaseAnswer(raw: string): ParsedCaseAnswer {
  const text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { sections: [], leftover: '', bibliography: '' };

  let body = text;
  let bibliography = '';
  const refsSplit = text.split(REFS_HEADING_RE);
  if (refsSplit.length >= 2) {
    body = refsSplit[0].trim();
    bibliography = refsSplit.slice(1).join('\n').trim();
  }

  const lines = body.split('\n');
  const sections: CaseAnswerSection[] = [];
  let current: CaseAnswerSection | null = null;
  const preamble: string[] = [];

  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading) {
      if (current) sections.push(current);
      current = { key: heading.key, title: heading.title, body: '' };
      continue;
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    } else if (line.trim()) {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);

  return {
    sections: sections.map((s) => ({ ...s, body: s.body.trim() })),
    leftover: preamble.join('\n').trim(),
    bibliography,
  };
}
