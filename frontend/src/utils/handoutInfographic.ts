import type { AppLanguage } from '../i18n/language';
import { parseAiJson } from './parseAiJson';
import { OPENAI_CHAT, openaiJson, type BookContext } from '../services/openaiClient';
import {
  HANDOUT_SECTION_IDS,
  asHandoutScene,
  inferTopicScene,
  sceneForSection,
  type HandoutScene,
  type HandoutSectionId,
} from './handoutScenes';

export const HANDOUT_POSTER_W = 2100;
export const HANDOUT_POSTER_H = 1470;

export type HandoutI18n = { uz: string; ru: string; en: string };

export type HandoutCard = {
  title: HandoutI18n;
  points: HandoutI18n[];
};

export type HandoutSection = {
  id: HandoutSectionId;
  n: number;
  heading: HandoutI18n;
  lead: HandoutI18n;
  points: HandoutI18n[];
  cards: HandoutCard[];
  scene: HandoutScene;
  caption: HandoutI18n;
};

export type HandoutInfographicPack = {
  kicker: HandoutI18n;
  title: HandoutI18n;
  heroScene: HandoutScene;
  heroCaption: HandoutI18n;
  sections: HandoutSection[];
};

const FALLBACK_HEADING: Record<HandoutSectionId, HandoutI18n> = {
  definition: { uz: "Ta'rif", ru: 'Определение', en: 'Definition' },
  etiology: { uz: 'Etiologiya', ru: 'Этиология', en: 'Etiology' },
  pathogenesis: { uz: 'Patogenez', ru: 'Патогенез', en: 'Pathogenesis' },
  pathomorphology: { uz: 'Patomorfologiya', ru: 'Патоморфология', en: 'Pathomorphology' },
  clinical: { uz: 'Klinik belgilar', ru: 'Клинические признаки', en: 'Clinical features' },
  differential: {
    uz: 'Differensial diagnostika',
    ru: 'Дифференциальная диагностика',
    en: 'Differential diagnosis',
  },
  treatment: { uz: 'Davolash usullari', ru: 'Методы лечения', en: 'Treatment' },
  prevention: {
    uz: 'Profilaktika va reabilitatsiya',
    ru: 'Профилактика и реабилитация',
    en: 'Prevention and rehabilitation',
  },
};

const SECTION_INDEX: Record<string, HandoutSectionId> = {
  definition: 'definition',
  tarif: 'definition',
  "ta'rif": 'definition',
  etiology: 'etiology',
  etiologiya: 'etiology',
  pathogenesis: 'pathogenesis',
  patogenez: 'pathogenesis',
  pathomorphology: 'pathomorphology',
  patomorfologiya: 'pathomorphology',
  clinical: 'clinical',
  klinika: 'clinical',
  'klinik belgilar': 'clinical',
  differential: 'differential',
  differensial: 'differential',
  treatment: 'treatment',
  davolash: 'treatment',
  prevention: 'prevention',
  profilaktika: 'prevention',
};

function pickStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

function asI18n(raw: unknown, fallback = ''): HandoutI18n {
  if (typeof raw === 'string') {
    const s = raw.trim() || fallback;
    return { uz: s, ru: s, en: s };
  }
  if (!raw || typeof raw !== 'object') {
    return { uz: fallback, ru: fallback, en: fallback };
  }
  const o = raw as Record<string, unknown>;
  const uz = pickStr(o.uz) || pickStr(o.ru) || pickStr(o.en) || fallback;
  return {
    uz: pickStr(o.uz) || uz,
    ru: pickStr(o.ru) || uz,
    en: pickStr(o.en) || uz,
  };
}

function clipI18n(t: HandoutI18n, max: number): HandoutI18n {
  return { uz: clip(t.uz, max), ru: clip(t.ru, max), en: clip(t.en, max) };
}

function asI18nList(raw: unknown, maxItems: number, maxLen: number): HandoutI18n[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => clipI18n(asI18n(item), maxLen))
    .filter((t) => t.uz.length > 1)
    .slice(0, maxItems);
}

function resolveSectionId(raw: unknown, heading: HandoutI18n, index: number): HandoutSectionId {
  const id = pickStr(raw).toLowerCase();
  if (id && SECTION_INDEX[id]) return SECTION_INDEX[id];
  const h = `${heading.uz} ${heading.ru} ${heading.en}`.toLowerCase();
  for (const [key, value] of Object.entries(SECTION_INDEX)) {
    if (h.includes(key)) return value;
  }
  return HANDOUT_SECTION_IDS[Math.min(index, HANDOUT_SECTION_IDS.length - 1)];
}

export function pickHandoutText(t: HandoutI18n, lang: AppLanguage): string {
  return (t[lang] || t.uz || t.ru || t.en || '').trim();
}

export function normalizeHandoutPack(raw: unknown, topicTitle = ''): HandoutInfographicPack {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const topicScene = inferTopicScene(topicTitle || asI18n(root.title).uz);
  const heroScene = asHandoutScene(root.heroScene ?? root.hero_scene, topicScene);
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const byId = new Map<HandoutSectionId, HandoutSection>();

  sectionsRaw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const s = item as Record<string, unknown>;
    const heading = clipI18n(asI18n(s.heading, FALLBACK_HEADING.definition.uz), 90);
    const id = resolveSectionId(s.id, heading, index);
    const cardsRaw = Array.isArray(s.cards) ? s.cards : [];
    const cards: HandoutCard[] = cardsRaw
      .map((c) => {
        if (!c || typeof c !== 'object') return null;
        const card = c as Record<string, unknown>;
        const title = clipI18n(asI18n(card.title), 70);
        if (title.uz.length < 2) return null;
        return { title, points: asI18nList(card.points ?? card.bullets, 4, 180) };
      })
      .filter((c): c is HandoutCard => c != null)
      .slice(0, 4);
    byId.set(id, {
      id,
      n: HANDOUT_SECTION_IDS.indexOf(id) + 1,
      heading: heading.uz.length > 1 ? heading : FALLBACK_HEADING[id],
      lead: clipI18n(asI18n(s.lead ?? s.body ?? s.summary), 420),
      points: asI18nList(s.points ?? s.bullets, id === 'definition' ? 4 : 6, 200),
      cards,
      scene: asHandoutScene(s.scene, sceneForSection(id, topicScene)),
      caption: clipI18n(asI18n(s.caption), 90),
    });
  });

  const sections = HANDOUT_SECTION_IDS.map((id, index) => {
    const existing = byId.get(id);
    if (existing) return { ...existing, n: index + 1 };
    return {
      id,
      n: index + 1,
      heading: FALLBACK_HEADING[id],
      lead: { uz: '', ru: '', en: '' },
      points: [],
      cards: [],
      scene: sceneForSection(id, topicScene),
      caption: { uz: '', ru: '', en: '' },
    };
  });

  return {
    kicker: clipI18n(asI18n(root.kicker, "O'quv posteri"), 40),
    title: clipI18n(asI18n(root.title, topicTitle), 140),
    heroScene,
    heroCaption: clipI18n(asI18n(root.heroCaption ?? root.hero_caption), 110),
    sections,
  };
}

export async function generateHandoutInfographicPack(params: {
  topicTitle: string;
  topicId: string;
  topicType: string;
  subjectName: string;
  subjectCode?: string;
}): Promise<HandoutInfographicPack> {
  const bookContext: BookContext | undefined = params.subjectCode
    ? { subjectCode: params.subjectCode, topicQuery: params.topicTitle }
    : undefined;

  const kind =
    params.topicType === 'practical'
      ? "amaliy mashg'ulot"
      : params.topicType === 'clinical'
        ? "klinik mashg'ulot"
        : "ma'ruza";

  const sceneList = [
    'child',
    'urinary',
    'kidney',
    'liver',
    'heart',
    'lungs',
    'brain',
    'gi',
    'skin',
    'blood',
    'infection',
    'inflammation',
    'microscope',
    'clinic',
    'treatment',
    'surgery',
    'prevention',
    'bones',
    'eye',
    'ear',
    'tooth',
    'endocrine',
    'pregnancy',
    'immune',
    'default',
  ].join('|');

  const raw = await openaiJson<unknown>({
    model: OPENAI_CHAT,
    temperature: 0.28,
    maxTokens: 9000,
    bookContext,
    responseFormat: { type: 'json_object' },
    parse: (text) => parseAiJson<unknown>(text),
    system:
      "Siz FJSTI tibbiyot professori va o'quv POSTER muallifisiz. Javob FAQAT JSON. " +
      "Har bir matn maydoni O'ZBEK (lotin), RUS va INGLIZ tillarida — tibbiy aniq tarjima, kalka emas. " +
      "O'zbekcha kirill ishlatilmasin. Tashqi havola, DOI, o'ylab topilgan manba YO'Q. " +
      "Bu 30:21 nisbatdagi ILMIY O'QUV POSTERI: matnli ma'lumot ZICH, lekin o'qiladigan. " +
      "Har bo'limda 2–3 gapli lead (ta'rif/mohiyat) + 4–6 ta mazmunli bullet (har biri 12–22 so'z). " +
      "Qisqa cheklist emas — klinika darajasidagi faktlar: chaqiruvchi omillar, mexanizm, morfologiya, " +
      "belgilar, qiyosiy tashxis, davo va profilaktika. " +
      "Mavzuda bir nechta nosozlik/kasallik bo'lsa (masalan uretrit, orxit, epididimit) 1-bo'limda " +
      "HAR BIRIGA alohida ta'rif kartochkasi; 2–8-bo'limlarda esa ularni solishtirib yoritish. " +
      "Mavzu diagnostika/baholash bo'lsa ham shu 8 bosqichga MOSLAB yozing " +
      "(nima baholanadi, sabablar, mexanizm, morfologik/klinik belgilar, qiyos, yondashuv, profilaktika). " +
      "scene maydoni faqat ruxsat etilgan kalitlardan.",
    user:
      `Fan: "${params.subjectName}". Mavzu kodi: ${params.topicId} (${kind}).\n` +
      `Mavzu: "${params.topicTitle}".\n` +
      'Aynan 8 ta sections, id ketma-ketligi QAT\'IY:\n' +
      '1 definition — ta\'rif(lar)\n' +
      '2 etiology — etiologiya\n' +
      '3 pathogenesis — patogenez\n' +
      '4 pathomorphology — patomorfologiya\n' +
      '5 clinical — klinik belgilar\n' +
      '6 differential — differensial diagnostika\n' +
      '7 treatment — davolash usullari\n' +
      '8 prevention — profilaktika va reabilitatsiya\n' +
      `scene ruxsat: ${sceneList}\n` +
      'JSON:\n' +
      '{"kicker":{"uz":"O\'quv posteri","ru":"Учебный постер","en":"Teaching poster"},' +
      '"title":{"uz":"...","ru":"...","en":"..."},' +
      '"heroScene":"child","heroCaption":{"uz":"...","ru":"...","en":"..."},' +
      '"sections":[{"id":"definition","heading":{"uz":"...","ru":"...","en":"..."},' +
      '"lead":{"uz":"...","ru":"...","en":"..."},' +
      '"points":[{"uz":"...","ru":"...","en":"..."}],' +
      '"cards":[{"title":{"uz":"...","ru":"...","en":"..."},"points":[{"uz":"...","ru":"...","en":"..."}]}],' +
      '"scene":"urinary","caption":{"uz":"...","ru":"...","en":"..."}}]}',
  });

  const pack = normalizeHandoutPack(raw, params.topicTitle);
  const filled = pack.sections.filter((s) => s.lead.uz.length > 20 || s.points.length >= 2 || s.cards.length > 0);
  if (!pack.title.uz || filled.length < 6) {
    throw new Error('handout-pack-weak');
  }
  return pack;
}
