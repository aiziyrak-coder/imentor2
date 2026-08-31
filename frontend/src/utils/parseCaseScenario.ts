import type { AppLanguage } from '../i18n/language';

export type CaseScenarioBlock = {
  id: string;
  title: string;
  body: string;
};

const DEFAULT_TITLES: Record<AppLanguage, string[]> = {
  uz: ['Bemor', 'Shikoyatlar', 'Anamnez', 'Hayot tarzi', "Obyektiv ko'rik", 'Laboratoriya'],
  ru: ['Пациент', 'Жалобы', 'Анамнез', 'Образ жизни', 'Объективный осмотр', 'Лаборатория'],
  en: ['Patient', 'Complaints', 'History', 'Lifestyle', 'Examination', 'Investigations'],
};

const HEADING_RE = /^(?:#{1,3}\s*)?(.{2,60})$/;

function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/[.!?:,;]$/.test(t)) return false;
  if (t.split(/\s+/).length > 6) return false;
  return HEADING_RE.test(t);
}

/** Yangi keyslar `### Sarlavha` bilan, eski keyslar bo'sh qator bilan ajratilgan. */
export function parseCaseScenario(raw: string, language: AppLanguage = 'uz'): CaseScenarioBlock[] {
  const text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const labeled: CaseScenarioBlock[] = [];
  const chunks = text.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  let hashed = 0;
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const head = (lines[0] || '').trim();
    const first = head.replace(/^#{1,3}\s*/, '');
    if (lines.length >= 2 && looksLikeHeading(first)) {
      if (/^#{1,3}\s/.test(head)) hashed += 1;
      labeled.push({
        id: first.toLowerCase(),
        title: first,
        body: lines.slice(1).join('\n').trim(),
      });
    }
  }
  // `###` aniq belgi: bunda ikkita bo'lim ham yetarli. Belgisiz matnda esa
  // sarlavha taxmin qilinadi, shuning uchun kamida uchtasi talab etiladi -
  // aks holda oddiy qisqa birinchi qator sarlavha deb o'qilib ketardi.
  const enough = hashed === labeled.length && labeled.length === chunks.length ? 2 : 3;
  if (labeled.length >= enough && labeled.every((b) => b.body)) {
    return labeled;
  }

  const defaults = DEFAULT_TITLES[language] ?? DEFAULT_TITLES.uz;
  if (chunks.length >= 4 && chunks.length <= 6) {
    return chunks.map((body, i) => ({
      id: `p${i}`,
      title: defaults[i] || defaults[defaults.length - 1],
      body,
    }));
  }

  return [{ id: 'scenario', title: '', body: text }];
}

export function joinCaseScenarioParts(
  parts: Array<{ title: string; body: string }>,
): string {
  return parts
    .map((p) => {
      const body = (p.body || '').trim();
      if (!body) return '';
      return p.title ? `### ${p.title}\n${body}` : body;
    })
    .filter(Boolean)
    .join('\n\n');
}
