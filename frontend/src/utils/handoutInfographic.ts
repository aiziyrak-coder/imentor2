import type { SubjectDomain } from './subjectDomain';
import type { AppLanguage } from '../i18n/language';
import { parseAiJson } from './parseAiJson';
import { OPENAI_CHAT, OPENAI_FAST, openaiJson, type BookContext } from '../services/openaiClient';
import {
  HANDOUT_SECTION_IDS,
  asHandoutScene,
  inferTopicScene,
  sceneForSection,
  type HandoutScene,
  type HandoutSectionId,
} from './handoutScenes';

/** 30:21 — html2canvas katta canvasda (2100×1.5) yiqilmasin. */
export const HANDOUT_POSTER_W = 1680;
export const HANDOUT_POSTER_H = 1176;

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

/**
 * Bo'lim nomlari FANGA qarab (2026-09-26). Ilgari har qanday poster 8 ta tibbiy
 * bo'lim bilan chiqardi — "Axborot texnologiyalari" posterida ham "Patogenez"
 * va "Davolash usullari". Slot kalitlari (`etiology`, `treatment`…) faqat joy:
 * ko'rinadigan nom va AI'ga beriladigan reja domenga bog'liq.
 */
const BIOMEDICAL_HEADING: Record<HandoutSectionId, HandoutI18n> = {
  definition: { uz: "Ta'rif va asosiy tushunchalar", ru: 'Определение и ключевые понятия', en: 'Definition and key concepts' },
  etiology: { uz: 'Tuzilishi va tarkibi', ru: 'Строение и состав', en: 'Structure and composition' },
  pathogenesis: { uz: 'Funksiya va mexanizm', ru: 'Функция и механизм', en: 'Function and mechanism' },
  pathomorphology: { uz: 'Morfologik ko\'rinish', ru: 'Морфологическая картина', en: 'Morphology' },
  clinical: { uz: 'Klinik ahamiyati', ru: 'Клиническое значение', en: 'Clinical relevance' },
  differential: { uz: 'Taqqoslash va farqlash', ru: 'Сравнение и различия', en: 'Comparison and distinction' },
  treatment: { uz: "Me'yor va ko'rsatkichlar", ru: 'Нормы и показатели', en: 'Norms and values' },
  prevention: { uz: "O'z-o'zini tekshirish", ru: 'Самопроверка', en: 'Self-check' },
};

const ACADEMIC_HEADING: Record<HandoutSectionId, HandoutI18n> = {
  definition: { uz: "Ta'rif va asosiy tushunchalar", ru: 'Определение и ключевые понятия', en: 'Definition and key concepts' },
  etiology: { uz: 'Asoslari va kelib chiqishi', ru: 'Основы и происхождение', en: 'Foundations and origin' },
  pathogenesis: { uz: 'Ishlash tamoyili', ru: 'Принцип работы', en: 'How it works' },
  pathomorphology: { uz: 'Tuzilishi va tarkibiy qismlari', ru: 'Структура и составные части', en: 'Structure and components' },
  clinical: { uz: "Amaliy qo'llanilishi", ru: 'Практическое применение', en: 'Practical application' },
  differential: { uz: 'Taqqoslash', ru: 'Сравнение', en: 'Comparison' },
  treatment: { uz: 'Tipik xatolar va ularning oldini olish', ru: 'Типичные ошибки и их предупреждение', en: 'Common mistakes and how to avoid them' },
  prevention: { uz: 'Nazorat savollari', ru: 'Контрольные вопросы', en: 'Review questions' },
};

export function handoutHeadings(domain: SubjectDomain = 'clinical'): Record<HandoutSectionId, HandoutI18n> {
  if (domain === 'academic') return ACADEMIC_HEADING;
  if (domain === 'biomedical') return BIOMEDICAL_HEADING;
  return FALLBACK_HEADING;
}

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

export function normalizeHandoutPack(
  raw: unknown,
  topicTitle = '',
  domain: SubjectDomain = 'clinical',
): HandoutInfographicPack {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const headings = handoutHeadings(domain);
  // Tibbiyotdan tashqari fanda a'zo rasmi yo'q: "Qonunchilik" ham "qon" deb
  // qon rasmini olardi. Hamma bo'lim neytral sahnada.
  const neutral = domain === 'academic';
  const topicScene = neutral ? 'default' : inferTopicScene(topicTitle || asI18n(root.title).uz);
  const heroScene = neutral ? 'default' : asHandoutScene(root.heroScene ?? root.hero_scene, topicScene);
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
      heading: heading.uz.length > 1 ? heading : headings[id],
      lead: clipI18n(asI18n(s.lead ?? s.body ?? s.summary), 420),
      points: asI18nList(s.points ?? s.bullets, id === 'definition' ? 4 : 6, 200),
      cards,
      scene: neutral ? 'default' : asHandoutScene(s.scene, sceneForSection(id, topicScene)),
      caption: clipI18n(asI18n(s.caption), 90),
    });
  });

  const sections = HANDOUT_SECTION_IDS.map((id, index) => {
    const existing = byId.get(id);
    if (existing) return { ...existing, n: index + 1 };
    return {
      id,
      n: index + 1,
      heading: headings[id],
      lead: { uz: '', ru: '', en: '' },
      points: [],
      cards: [],
      scene: neutral ? 'default' : sceneForSection(id, topicScene),
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

function stubI18n(uz: string, ru: string, en: string): HandoutI18n {
  return { uz, ru, en };
}

/** AI qisman javob bersa ham 8 bo'lim to'ladi — poster bo'sh qolmasin. */
export function ensureHandoutPackFilled(
  pack: HandoutInfographicPack,
  topicTitle: string,
  domain: SubjectDomain = 'clinical',
): HandoutInfographicPack {
  const topic = (topicTitle || pack.title.uz || "Mavzu").replace(/\s+/g, ' ').trim();
  if (domain !== 'clinical') return fillNeutral(pack, topic, domain);
  const stubs: Record<HandoutSectionId, { lead: HandoutI18n; points: HandoutI18n[] }> = {
    definition: {
      lead: stubI18n(
        `${topic}: asosiy tushuncha, o'quv maqsadi va klinik ahamiyati.`,
        `${topic}: основное понятие, учебная цель и клиническое значение.`,
        `${topic}: core concept, learning goal and clinical relevance.`,
      ),
      points: [
        stubI18n('Ta\'rif mavzu doirasida aniq va qisqa.', 'Определение даётся в рамках темы.', 'Define the topic clearly and briefly.'),
        stubI18n('Asosiy atamalar va ularning o\'rni.', 'Ключевые термины и их место.', 'Key terms and how they fit together.'),
      ],
    },
    etiology: {
      lead: stubI18n(
        `${topic} rivojlanishiga olib keladigan asosiy omillar.`,
        `Основные факторы, ведущие к развитию: ${topic}.`,
        `Main factors that lead to ${topic}.`,
      ),
      points: [
        stubI18n('Chaqiruvchi va xavf omillari.', 'Пусковые и факторы риска.', 'Triggers and risk factors.'),
        stubI18n('Oldini olish mumkin bo\'lgan sabablar.', 'Предотвратимые причины.', 'Preventable causes.'),
      ],
    },
    pathogenesis: {
      lead: stubI18n(
        `${topic} da ketma-ket mexanizm: nima buziladi va qanday tarqaladi.`,
        `Последовательный механизм при ${topic}.`,
        `Stepwise mechanism in ${topic}.`,
      ),
      points: [
        stubI18n('Boshlanish nuqtasi va zanjir.', 'Стартовая точка и цепочка.', 'Starting point and cascade.'),
        stubI18n('Asosiy hujayra/tizim o\'zgarishi.', 'Ключевое клеточное/системное изменение.', 'Key cellular or system change.'),
      ],
    },
    pathomorphology: {
      lead: stubI18n(
        `${topic} ga xos morfologik va struktura o\'zgarishlari.`,
        `Характерные морфологические изменения при ${topic}.`,
        `Typical structural changes in ${topic}.`,
      ),
      points: [
        stubI18n('Makroskopik belgilar.', 'Макроскопические признаки.', 'Gross findings.'),
        stubI18n('Mikroskopik/funksional o\'zgarish.', 'Микроскопические/функциональные изменения.', 'Microscopic or functional change.'),
      ],
    },
    clinical: {
      lead: stubI18n(
        `${topic}: yetakchi shikoyatlar, belgi va ogohlantiruvchi topilmalar.`,
        `${topic}: ведущие жалобы, признаки и тревожные находки.`,
        `${topic}: leading symptoms, signs and red flags.`,
      ),
      points: [
        stubI18n('Tipik klinik ko\'rinish.', 'Типичная клиническая картина.', 'Typical clinical picture.'),
        stubI18n('Qizil bayroqlar va shoshilinch holat.', 'Красные флаги и неотложность.', 'Red flags and urgency.'),
      ],
    },
    differential: {
      lead: stubI18n(
        `${topic} ni o\'xshash holatlardan ajratish mezonlari.`,
        `Критерии отличия ${topic} от сходных состояний.`,
        `How to separate ${topic} from look-alike conditions.`,
      ),
      points: [
        stubI18n('Yaqin differensial tashxislar.', 'Близкие дифференциальные диагнозы.', 'Close differential diagnoses.'),
        stubI18n('Hal qiluvchi belgi yoki tekshiruv.', 'Решающий признак или исследование.', 'Deciding sign or test.'),
      ],
    },
    treatment: {
      lead: stubI18n(
        `${topic} da birinchi qator yondashuv va nima tanlanmasligi.`,
        `Подход первой линии при ${topic} и чего избегать.`,
        `First-line approach in ${topic} and what to avoid.`,
      ),
      points: [
        stubI18n('Asosiy davolash qadamlari.', 'Основные шаги лечения.', 'Main treatment steps.'),
        stubI18n('Monitoring va asoratlarni nazorat.', 'Мониторинг и контроль осложнений.', 'Monitoring and complications.'),
      ],
    },
    prevention: {
      lead: stubI18n(
        `${topic}: profilaktika, ta\'lim va kuzatuv.`,
        `${topic}: профилактика, обучение и наблюдение.`,
        `${topic}: prevention, education and follow-up.`,
      ),
      points: [
        stubI18n('Birlamchi va ikkilamchi profilaktika.', 'Первичная и вторичная профилактика.', 'Primary and secondary prevention.'),
        stubI18n('Bemorni o\'qitish va nazorat muddati.', 'Обучение пациента и сроки контроля.', 'Patient education and review interval.'),
      ],
    },
  };

  const title = pack.title.uz.trim()
    ? pack.title
    : stubI18n(topic, topic, topic);
  const sections = pack.sections.map((s) => {
    const stub = stubs[s.id];
    const hasBody = s.lead.uz.trim().length > 12 || s.points.length >= 1 || s.cards.length > 0;
    if (hasBody) return s;
    return {
      ...s,
      heading: s.heading.uz.trim().length > 1 ? s.heading : FALLBACK_HEADING[s.id],
      lead: stub.lead,
      points: stub.points,
    };
  });
  return {
    ...pack,
    kicker: pack.kicker.uz.trim() ? pack.kicker : stubI18n("O'quv posteri", 'Учебный постер', 'Teaching poster'),
    title,
    heroCaption: pack.heroCaption.uz.trim()
      ? pack.heroCaption
      : stubI18n('Mavzu bo\'yicha o\'quv sxemasi', 'Учебная схема по теме', 'Teaching diagram for the topic'),
    sections,
  };
}

/**
 * Klinik bo'lmagan fan uchun zaxira matn: bo'lim nomining o'zidan, bemor,
 * davolash va "qizil bayroq"siz. Ilgari bu yerda ham klinik stub turardi.
 */
function fillNeutral(pack: HandoutInfographicPack, topic: string, domain: SubjectDomain): HandoutInfographicPack {
  const headings = handoutHeadings(domain);
  const sections = pack.sections.map((s) => {
    const hasBody = s.lead.uz.trim().length > 12 || s.points.length >= 1 || s.cards.length > 0;
    if (hasBody) return s;
    const h = s.heading.uz.trim().length > 1 ? s.heading : headings[s.id];
    return {
      ...s,
      heading: h,
      lead: stubI18n(`${topic}: ${h.uz.toLowerCase()}.`, `${topic}: ${h.ru.toLowerCase()}.`, `${topic}: ${h.en.toLowerCase()}.`),
      points: [
        stubI18n("Ma'ruza matnidagi asosiy fikrlar.", 'Ключевые мысли лекции.', 'Key points from the lecture.'),
        stubI18n("Mavzuga oid misol.", 'Пример по теме.', 'An example from the topic.'),
      ],
    };
  });
  return {
    ...pack,
    kicker: pack.kicker.uz.trim() ? pack.kicker : stubI18n("O'quv posteri", 'Учебный постер', 'Teaching poster'),
    title: pack.title.uz.trim() ? pack.title : stubI18n(topic, topic, topic),
    heroCaption: pack.heroCaption.uz.trim()
      ? pack.heroCaption
      : stubI18n("Mavzu bo'yicha o'quv sxemasi", 'Учебная схема по теме', 'Teaching diagram for the topic'),
    sections,
  };
}

/** AI'ga beriladigan bo'lim rejasi — fanga qarab. */
function sectionPlan(domain: SubjectDomain): string {
  const h = handoutHeadings(domain);
  const plan = HANDOUT_SECTION_IDS.map((id) => `${id} = "${h[id].uz}"`).join('; ');
  if (domain === 'clinical') return `8 sections (id = mazmuni): ${plan}.`;
  if (domain === 'biomedical') {
    return (
      `8 sections (id faqat joy kaliti, heading — quyidagicha): ${plan}. ` +
      "Agar mavzu kasallik/patologiya haqida bo'lsa — etiologiya, patogenez va morfologiya bo'limlari " +
      "o'rinli, heading'ni shunga moslang. Individual bemor, davolash rejimi va dori dozasi YOZILMASIN."
    );
  }
  return (
    `8 sections (id faqat joy kaliti, heading — quyidagicha): ${plan}. ` +
    "Bu TIBBIYOTDAN TASHQARI fan: kasallik, bemor, davolash, etiologiya, patogenez YOZILMASIN. " +
    'Barcha scene = "default".'
  );
}

const SCENE_LIST = [
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

function handoutKindLabel(topicType: string): string {
  if (topicType === 'practical') return "amaliy mashg'ulot";
  if (topicType === 'clinical') return "klinik mashg'ulot";
  return "ma'ruza";
}

async function requestHandoutJson(params: {
  topicTitle: string;
  topicId: string;
  topicType: string;
  subjectName: string;
  subjectCode?: string;
  domain?: SubjectDomain;
  model: string;
  maxTokens: number;
}): Promise<unknown> {
  const bookContext: BookContext | undefined = params.subjectCode
    ? { subjectCode: params.subjectCode, topicQuery: params.topicTitle }
    : undefined;
  const kind = handoutKindLabel(params.topicType);
  return openaiJson<unknown>({
    model: params.model,
    temperature: 0.25,
    maxTokens: params.maxTokens,
    bookContext,
    responseFormat: { type: 'json_object' },
    purpose: 'handout_infographic',
    parse: (text) => parseAiJson<unknown>(text),
    system:
      "Siz FJSTI o'quv POSTER muallifisiz. Javob FAQAT qisqa JSON. " +
      "Har matn O'ZBEK (lotin), RUS va INGLIZ. Kirill o'zbekcha YO'Q. " +
      "JSON qisqa bo'lsin — token limitida kesilmasin. " +
      "Har lead: 1 jumla (max 16 so'z). Har bo'limda 3 bullet (max 12 so'z). " +
      "Kartochka FAQAT definition da, ko'pi bilan 2 ta. " +
      "Mavzuga mos yozing (klinik bo'lmasa — bemor vignette YO'Q). " +
      'Bo\'lim nomlari FANGA mos bo\'lsin — foydalanuvchi xabaridagi rejaga amal qiling. ' +
      "scene faqat ruxsat etilgan kalit.",
    user:
      `Fan: "${params.subjectName}". Kod: ${params.topicId} (${kind}).\n` +
      `Mavzu: "${params.topicTitle}".\n` +
      `${sectionPlan(params.domain ?? 'clinical')}\n` +
      `scene: ${SCENE_LIST}\n` +
      'JSON: {"kicker":{"uz":"O\'quv posteri","ru":"Учебный постер","en":"Teaching poster"},' +
      '"title":{"uz":"...","ru":"...","en":"..."},"heroScene":"default","heroCaption":{"uz":"...","ru":"...","en":"..."},' +
      '"sections":[{"id":"definition","heading":{"uz":"...","ru":"...","en":"..."},' +
      '"lead":{"uz":"...","ru":"...","en":"..."},"points":[{"uz":"...","ru":"...","en":"..."}],' +
      '"cards":[],"scene":"default","caption":{"uz":"...","ru":"...","en":"..."}}]}',
  });
}

export async function generateHandoutInfographicPack(params: {
  topicTitle: string;
  topicId: string;
  topicType: string;
  subjectName: string;
  subjectCode?: string;
  domain?: SubjectDomain;
}): Promise<HandoutInfographicPack> {
  const domain = params.domain ?? 'clinical';
  const fallback = () =>
    ensureHandoutPackFilled(normalizeHandoutPack({}, params.topicTitle, domain), params.topicTitle, domain);
  const attempts: Array<{ model: string; maxTokens: number }> = [
    { model: OPENAI_CHAT, maxTokens: 4200 },
    { model: OPENAI_FAST, maxTokens: 3200 },
  ];
  for (const attempt of attempts) {
    try {
      // Taymer so'rovni BEKOR QILMAYDI. 40 s da zaxira so'rov yuborilardi,
      // birinchisi esa serverda davom etib, uning uchun ham to'lanardi —
      // bitta poster ikki marta. gpt-4o bu hajmni odatda 40–80 s da beradi,
      // shuning uchun chegara undan yuqori.
      const raw = await Promise.race([
        requestHandoutJson({ ...params, ...attempt }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('handout-ai-timeout')), 90000);
        }),
      ]);
      return ensureHandoutPackFilled(normalizeHandoutPack(raw, params.topicTitle, domain), params.topicTitle, domain);
    } catch {
      /* keyingi urinish yoki lokal poster */
    }
  }
  return fallback();
}
