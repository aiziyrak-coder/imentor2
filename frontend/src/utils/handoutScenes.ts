export const HANDOUT_SECTION_IDS = [
  'definition',
  'etiology',
  'pathogenesis',
  'pathomorphology',
  'clinical',
  'differential',
  'treatment',
  'prevention',
] as const;

export type HandoutSectionId = (typeof HANDOUT_SECTION_IDS)[number];

export const HANDOUT_SCENES = [
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
] as const;

export type HandoutScene = (typeof HANDOUT_SCENES)[number];

const SCENE_SET = new Set<string>(HANDOUT_SCENES);

export function asHandoutScene(raw: unknown, fallback: HandoutScene = 'default'): HandoutScene {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return SCENE_SET.has(s) ? (s as HandoutScene) : fallback;
}

const SECTION_SCENE: Record<HandoutSectionId, HandoutScene> = {
  definition: 'default',
  etiology: 'infection',
  pathogenesis: 'inflammation',
  pathomorphology: 'microscope',
  clinical: 'clinic',
  differential: 'clinic',
  treatment: 'treatment',
  prevention: 'prevention',
};

const TOPIC_SCENE_RULES: Array<{ re: RegExp; scene: HandoutScene }> = [
  { re: /bolalar|bolaning|pediatr|chaqaloq|infant|child|neonat/i, scene: 'child' },
  { re: /uretr|orxit|orxiti|epididim|prostat|siydik|urolog|testis|penis|cystit/i, scene: 'urinary' },
  { re: /buyrak|nefrit|pochka|renal|kidney|pyelonefr/i, scene: 'kidney' },
  { re: /jigar|gepatit|pechen|liver|cirrh|sariqlik|jaundice/i, scene: 'liver' },
  { re: /yurak|infarkt|kardi|heart|aritmi|stenokard/i, scene: 'heart' },
  { re: /o'?pka|pnevmon|bronx|astma|nafas|respir|tubercul|o'pka/i, scene: 'lungs' },
  { re: /miya|insult|nevrolog|epilep|meningit|psixiatr|brain|stroke/i, scene: 'brain' },
  { re: /oshqozon|ichak|gastrit|yazva|pankreat|appendi|dispeps|gel'mint/i, scene: 'gi' },
  { re: /teri|dermat|ekzema|psoriaz|shish|rash|skin/i, scene: 'skin' },
  { re: /qon|anemi|leykoz|gematolog|koagul|gemoglobin|sepsis/i, scene: 'blood' },
  { re: /suyak|bo'?g'?im|artrit|osteom|travm|fractur|ortoped/i, scene: 'bones' },
  { re: /ko'?z|oftalm|katarakt|glaukom|retina/i, scene: 'eye' },
  { re: /quloq|otin|lor |orl |surdit/i, scene: 'ear' },
  { re: /tish|stomat|parodont|karies|ortodont/i, scene: 'tooth' },
  { re: /qandli|diabet|tireoid|gormon|endokrin|adrenal/i, scene: 'endocrine' },
  { re: /homila|akusher|ginekolog|bachadon|tug'?ruq|pregnan/i, scene: 'pregnancy' },
  { re: /immun|allerg|astma|vaksina/i, scene: 'immune' },
];

export function inferTopicScene(topicTitle: string): HandoutScene {
  const title = topicTitle || '';
  for (const rule of TOPIC_SCENE_RULES) {
    if (rule.re.test(title)) return rule.scene;
  }
  return 'default';
}

export function sceneForSection(sectionId: HandoutSectionId, topicScene: HandoutScene): HandoutScene {
  if (sectionId === 'definition' || sectionId === 'clinical') return topicScene;
  if (sectionId === 'pathomorphology' && (topicScene === 'blood' || topicScene === 'infection')) {
    return 'microscope';
  }
  return SECTION_SCENE[sectionId];
}
