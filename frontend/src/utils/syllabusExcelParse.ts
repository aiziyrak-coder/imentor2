import type { SyllabusTopic } from '../services/aiService';

export type ParsedSyllabusExcel = {
  topics: SyllabusTopic[];
  skippedLabCount: number;
  skippedIndependentCount: number;
  asText: string;
};

const TYPE_PREFIX: Record<
  'lecture' | 'practical' | 'clinical' | 'independent' | 'lab',
  string
> = {
  lecture: 'L',
  practical: 'A',
  clinical: 'K',
  independent: 'I',
  lab: 'B',
};

const TYPE_LABEL: Record<keyof typeof TYPE_PREFIX, string> = {
  lecture: "Ma'ruza",
  practical: 'Amaliy mashg\'ulot',
  clinical: "Klinik mashg'ulot",
  independent: "Mustaqil ta'lim",
  lab: 'Laboratoriya',
};

function norm(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyActivity(
  value: string,
): 'lecture' | 'practical' | 'clinical' | 'lab' | 'independent' | 'unknown' {
  const s = norm(value);
  if (!s) return 'unknown';
  if (/mustaqil|самостоят|\bsrc\b|\bсрс\b|independent/.test(s)) return 'independent';
  if (/laborator|лаборатор|\blab\b/.test(s)) return 'lab';
  // Excel'da Seminar = amaliy mashg'ulot, ma'ruza/leksiya EMAS (avval tekshiriladi).
  if (/\bseminar|\bсеминар/.test(s)) return 'practical';
  if (/klinik\s*mashg|клиническ|\bclinical\b/.test(s)) return 'clinical';
  if (/amaliy|practical|практик/.test(s)) return 'practical';
  if (/ma'?ruza|maruza|lecture|leksiya|lektsiya|лекци|теорет/.test(s)) return 'lecture';
  return 'unknown';
}

function isTitleHeader(cell: string): boolean {
  const s = norm(cell).replace(/[º°]/g, '').trim();
  if (!s || s.length > 24) return false;
  if (/^nomi\b/.test(s)) return true;
  if (/^(mavzu|title|topic|тема|название)$/.test(s)) return true;
  if (/mavzu\s*nomi|topic\s*name|название\s*тем/.test(s)) return true;
  return s === 'fan nomi' || s === 'subject';
}

function isTypeHeader(cell: string): boolean {
  const s = norm(cell);
  if (!s || s.length > 20) return false;
  if (classifyActivity(s) !== 'unknown') return false;
  if (/mashg'?ul/.test(s)) return true;
  if (/^(turi|type|вид)$/.test(s)) return true;
  return s === 'занятие';
}

function looksLikeHeaderRow(row: string[]): boolean {
  return row.some(isTitleHeader) || row.some(isTypeHeader);
}

function detectTypeColumn(rows: string[][], titleCol: number): number {
  const sample = rows.slice(0, 40);
  let best = -1;
  let bestHits = 0;
  const width = Math.max(0, ...sample.map((r) => r.length));
  for (let col = 0; col < width; col++) {
    if (col === titleCol) continue;
    const hits = sample.reduce((n, row) => {
      const kind = classifyActivity(row[col] || '');
      return kind === 'unknown' ? n : n + 1;
    }, 0);
    if (hits > bestHits) {
      bestHits = hits;
      best = col;
    }
  }
  return bestHits >= 2 ? best : -1;
}

function detectTitleColumn(rows: string[][], typeCol: number): number {
  const sample = rows.filter((r) => r.some((c) => c.trim())).slice(0, 40);
  const width = Math.max(0, ...sample.map((r) => r.length));
  let best = typeCol === 1 ? 0 : 1;
  let bestScore = -1;
  for (let col = 0; col < width; col++) {
    if (col === typeCol) continue;
    let score = 0;
    for (const row of sample) {
      const cell = (row[col] || '').trim();
      if (cell.length >= 8 && classifyActivity(cell) === 'unknown') score += cell.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = col;
    }
  }
  return best;
}

/**
 * Excel (Nomi + Mashg'ulot) qatorlaridan barcha dars turlari:
 * ma'ruza, amaliy, klinik, mustaqil ta'lim, laboratoriya.
 * Bir xil nom turli mashg'ulotda alohida saqlanadi.
 */
export function parseSyllabusExcel(rows: string[][], sourceName = ''): ParsedSyllabusExcel {
  let headerIdx = rows.findIndex(looksLikeHeaderRow);
  const header = headerIdx >= 0 ? rows[headerIdx] : [];
  let titleCol = header.findIndex(isTitleHeader);
  let typeCol = header.findIndex(isTypeHeader);
  const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;

  if (typeCol < 0) typeCol = detectTypeColumn(dataRows, titleCol);
  if (titleCol < 0) titleCol = detectTitleColumn(dataRows, typeCol);

  const sample = dataRows.slice(0, 20);
  const digitish = sample.filter((r) => /^\d{1,3}$/.test((r[titleCol] || '').trim())).length;
  const typeHits = sample.filter((r) => {
    const raw = typeCol >= 0 ? r[typeCol] || '' : '';
    const kind = classifyActivity(raw);
    return kind !== 'unknown' && raw.trim().length <= 32;
  }).length;
  if (digitish >= 3 && typeHits < 2) {
    titleCol += 1;
    if (typeCol >= 0) typeCol += 1;
  }

  const buckets: Record<keyof typeof TYPE_PREFIX, string[]> = {
    lecture: [],
    practical: [],
    clinical: [],
    independent: [],
    lab: [],
  };
  const seen = new Set<string>();

  for (const row of dataRows) {
    const title = (row[titleCol] || '').replace(/\s+/g, ' ').trim();
    if (title.length < 4) continue;
    if (looksLikeHeaderRow(row)) continue;
    if (/^\d{1,3}$/.test(title)) continue;

    const typeRaw = typeCol >= 0 ? row[typeCol] || '' : '';
    let kind = classifyActivity(typeRaw);
    if (kind === 'unknown' && /\bseminar|\bсеминар/i.test(sourceName)) {
      kind = 'practical';
    }
    if (kind === 'unknown') continue;

    const key = `${kind}::${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    buckets[kind].push(title);
  }

  const order = ['lecture', 'practical', 'clinical', 'independent', 'lab'] as const;
  const topics: SyllabusTopic[] = order.flatMap((kind) =>
    buckets[kind].map((title, i) => ({
      id: `${TYPE_PREFIX[kind]}${i + 1}`,
      title,
      type: kind,
    })),
  );

  const asText = order
    .flatMap((kind) =>
      buckets[kind].map((title, i) => `${TYPE_PREFIX[kind]}${i + 1}\t${TYPE_LABEL[kind]}\t${title}`),
    )
    .join('\n');

  return { topics, skippedLabCount: 0, skippedIndependentCount: 0, asText };
}
