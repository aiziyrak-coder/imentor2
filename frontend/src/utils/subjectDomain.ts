/** Fan klinikmi yoki fundamental/texnik — test va keys shu domen bo‘yicha yoziladi. */

export type SubjectDomain = 'clinical' | 'academic';

export type GenerationScope = {
  domain: SubjectDomain;
  subjectName: string;
  departmentName: string;
  lectureText: string;
};

const ACADEMIC_RE =
  /informatika|axborot\s*texnolog|ahborot|elektronika|elektrotexnika|matemat|fizika|lotin|xorijiy\s*til|o['’`]zbek\s*\(?rus\)?\s*til|pedagog|psixologiy(?!a\s*klinik)|falsafa|tarix|huquq|iqtisod|statistika|biotibbiyot\s*muhandis|muhandislik|jismoniy\s*tarbiya|\bsport\b|dasturlash|kiberxavfsizlik|ma['’`]lumotlar\s*bazasi|tarmoq\s*texnolog|office|excel|python|algoritm|kompyuter|dasturiy\s*ta['’]minot/i;

const CLINICAL_RE =
  /anatom|fiziolog|patofiziolog|patologik\s*anatom|farmakolog|terapi|jarroh|xirurg|pediatr|akusher|ginekolog|urolog|nevrolog|psixiatr|narkolog|dermat|infeksion|gigiyen|epidemiolog|stomat|otorino|oftalmolog|travmat|ortoped|onkolog|endokrin|kardiolog|pulmonolog|gastroenter|nefrolog|gematolog|anestezi|reanimat|propedevt|klinik\s+allerg|ftiziatr|immunolog|sud\s*tibbiy|radiatsion\s*gigiyen|mehnat\s*gigiyen|kommunal\s*gigiyen/i;

export function resolveSubjectDomain(input: {
  departmentName?: string;
  subjectName?: string;
  topic?: string;
}): SubjectDomain {
  const dept = input.departmentName || '';
  const subject = input.subjectName || '';
  const blob = `${dept} ${subject}`.trim();
  if (!blob && !(input.topic || '').trim()) return 'clinical';
  if (ACADEMIC_RE.test(blob)) return 'academic';
  if (CLINICAL_RE.test(blob)) return 'clinical';
  if (ACADEMIC_RE.test(input.topic || '')) return 'academic';
  return 'clinical';
}

export function buildScopePrompt(scope: GenerationScope): string {
  const domainLine =
    scope.domain === 'clinical'
      ? 'DOMEN: klinik tibbiyot. Bemor kartasi, sindrom, tashxis, dori — MAVZU DOIRASIDA.'
      : 'DOMEN: klinik BO\'LMAGAN fan (informatika, matematika, elektronika, til, ijtimoiy fan va h.k.). ' +
        'BEMOR, kasallik, HbA1c, metformin, qon bosimi, qorin og\'rig\'i, KROK/USMLE vignette TAQIQLANADI.';
  const lecture = (scope.lectureText || '').trim();
  const lectureBlock = lecture
    ? `MA'RUZA MATNI (asosiy manba — savol va keys SHU matn + mavzudan chiqmasin):\n${lecture.slice(0, 8500)}`
    : 'Ma\'ruza matni berilmagan — faqat kafedra, fan va mavzu doirasida yozing, boshqa fan aralashtirmang.';
  return [
    `Kafedra: ${scope.departmentName || '—'}.`,
    `Fan: ${scope.subjectName || '—'}.`,
    domainLine,
    lectureBlock,
  ].join('\n');
}

export function emptyScope(topic: string, subjectName = '', departmentName = ''): GenerationScope {
  return makeGenerationScope({ topic, subjectName, departmentName, lectureText: '' });
}

export function makeGenerationScope(input: {
  topic: string;
  subjectName?: string;
  departmentName?: string;
  lectureText?: string;
}): GenerationScope {
  return {
    domain: resolveSubjectDomain(input),
    subjectName: input.subjectName || '',
    departmentName: input.departmentName || '',
    lectureText: (input.lectureText || '').trim(),
  };
}
