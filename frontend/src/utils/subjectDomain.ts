/** Fan klinikmi yoki fundamental/texnik — test va keys shu domen bo‘yicha yoziladi. */

import type { SyllabusTopicContext } from './syllabusTopicContext';

export type SubjectDomain = 'clinical' | 'academic';

export type GenerationScope = {
  domain: SubjectDomain;
  subjectName: string;
  departmentName: string;
  lectureText: string;
};

/** Imlo, kirill va odatiy xatolar — taqqoslash uchun. */
export function foldDomainText(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[''`ʻ’ʼ]/g, '')
    .replace(/texnalog/g, 'texnolog')
    .replace(/elektorin/g, 'elektron')
    .replace(/ahborot/g, 'axborot')
    .replace(/ахбор/g, 'axbor')
    .replace(/информационн?\s*технолог/g, 'axborot texnolog')
    .replace(/\s+/g, ' ')
    .trim();
}

const ACADEMIC_RE =
  /informatika|информатик|axborot|ахборот|tibbiyotda\s+axborot|texnologiyalar(i|и)|elektronika|электроник|elektrotexnika|elektron\s*(pochta|xat|imzo|hujjat|tijorat|hisob)|pochta\s*xizmat|\bemail\b|\bsmtp\b|\bimap\b|kiberxavfsizlik|dasturlash|dasturiy\s*taminot|kompyuter|компьютер|algoritm|matemat|математ|oliy\s*matemat|\bfizika\b|\bфизика\b|biofizika|lotin|латин|xorijiy\s*til|ingliz\s*til|rus\s*til|ozbek\s*til|pedagog|falsafa|huquq|iqtisod|statistika|muhandis|jismoniy\s*tarbiya|\bsport\b|malumotlar\s*bazasi|tarmoq|office|\bexcel\b|\bpython\b|sanoq\s*tizim|ikkilik|onlik|on\s*oltilik|protokol|parol|brauzer|\bhtml\b|\bcss\b|\bhttp\b|ip\s*adres|domen\s*nomi|\bkimyo\b|химия|integral\s*hisob|matritsa|vektor\s*algebra/i;

const ACADEMIC_CODE_RE =
  /(^|[^a-z0-9])(inf|ict|math|phys|lat|cs|comp)(\d|[-_]|$)|(^|[-_\/])it([-_\/]|$)/i;

const CLINICAL_RE =
  /anatom|fiziolog|patofiziolog|patologik\s*anatom|farmakolog|terapi|terapevt|ichki\s*kasall|jarroh|xirurg|pediatr|akusher|ginekolog|urolog|nevrolog|psixiatr|narkolog|dermat|infeksion|gigiyen|epidemiolog|stomat|otorino|oftalmolog|travmat|ortoped|onkolog|endokrin|kardiolog|pulmonolog|gastroenter|nefrolog|gematolog|anestezi|reanimat|propedevt|klinik\s+allerg|ftiziatr|immunolog|sud\s*tibbiy|radiatsion\s*gigiyen|mehnat\s*gigiyen|kommunal\s*gigiyen|umumiy\s*amaliyot|hamshiralik|gistolog|embriolog|mikrobiolog|virusolog|parazitolog|biokimyo|bioxim|davolash\s*ish/i;

export function resolveSubjectDomain(input: {
  departmentName?: string;
  subjectName?: string;
  subjectCode?: string;
  topic?: string;
  lectureText?: string;
}): SubjectDomain {
  const meta = foldDomainText(
    `${input.departmentName || ''} ${input.subjectName || ''} ${input.subjectCode || ''}`,
  );
  const rest = foldDomainText(`${input.topic || ''} ${(input.lectureText || '').slice(0, 2500)}`);

  if (meta && (ACADEMIC_RE.test(meta) || ACADEMIC_CODE_RE.test(meta))) return 'academic';
  if (meta && CLINICAL_RE.test(meta)) return 'clinical';
  if (rest && ACADEMIC_RE.test(rest)) return 'academic';
  if (rest && CLINICAL_RE.test(rest)) return 'clinical';
  return 'clinical';
}

export function academicTextHasClinicalLeak(text: string): boolean {
  const t = foldDomainText(text);
  if (!t) return false;
  if (
    /hba1c|metformin|insulin\b|qandli\s*diabet|appenditsit|pnevmoni|leykotsit|qon\s*bosimi|sistol|diastol|shifokor(i|iga|iga)|bemorga\b|qon\s*shakar/.test(
      t,
    )
  ) {
    return true;
  }
  return (
    /\d{1,3}\s*yoshli/.test(t) &&
    /(ayol|erkak|bemor)/.test(t) &&
    /(kasall|dori|shikoyat|tashxis|diabet|lab\b|mm\s*sim|mg\/dl|mmol)/.test(t)
  );
}

export function academicBundleHasClinicalLeak(parts: Array<string | undefined | null>): boolean {
  return parts.some((p) => academicTextHasClinicalLeak(p || ''));
}

export function buildScopePrompt(scope: GenerationScope): string {
  const domainLine =
    scope.domain === 'clinical'
      ? 'DOMEN: klinik tibbiyot. Bemor kartasi, sindrom, tashxis, dori — FAQAT MAVZU DOIRASIDA.'
      : 'DOMEN: klinik BO\'LMAGAN fan (informatika, matematika, elektronika, tillar, ijtimoiy fan). ' +
        'BEMOR, kasallik, HbA1c, metformin, qon bosimi, qorin og\'rig\'i, KROK/USMLE vignette TAQIQLANADI. ' +
        'Savol va keys kafedra + fan + mavzu + ma\'ruza (bo\'lsa) doirasida.';
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
  subjectCode?: string;
  lectureText?: string;
}): GenerationScope {
  return {
    domain: resolveSubjectDomain(input),
    subjectName: input.subjectName || '',
    departmentName: input.departmentName || '',
    lectureText: (input.lectureText || '').trim(),
  };
}

/** Eski localStorage da departmentName yo'q bo'lsa — katalogdan to'ldiradi. */
export async function hydrateGenerationScope(input: {
  topic: string;
  context?: SyllabusTopicContext | null;
  lectureText?: string;
}): Promise<GenerationScope> {
  let subjectName = input.context?.subjectName || '';
  let departmentName = input.context?.departmentName || '';
  let subjectCode = input.context?.subjectCode || '';
  let i18nNames = '';
  const syllabusId = input.context?.syllabusId;

  if (syllabusId && (!departmentName.trim() || !subjectName.trim())) {
    try {
      const { fetchMyCourseSelections } = await import('./syllabusApi');
      const mine = await fetchMyCourseSelections();
      const hit = mine.find((row) => row.syllabus.id === syllabusId)?.syllabus;
      if (hit) {
        subjectName = subjectName || hit.subject_name || '';
        departmentName = departmentName || hit.department_name || '';
        subjectCode = subjectCode || hit.subject_code || '';
        i18nNames = [hit.name_i18n?.uz, hit.name_i18n?.ru, hit.name_i18n?.en].filter(Boolean).join(' ');
      }
    } catch {
      /* katalogsiz ham mavzu+fan bilan davom etamiz */
    }
  }

  if (input.context && departmentName && departmentName !== (input.context.departmentName || '')) {
    try {
      const { persistSelectedTopic } = await import('./syllabusTopicContext');
      persistSelectedTopic({
        ...input.context,
        subjectName: input.context.subjectName || subjectName,
        departmentName,
        subjectCode: input.context.subjectCode || subjectCode,
      });
    } catch {
      /* ignore */
    }
  }

  return makeGenerationScope({
    topic: input.topic,
    subjectName: [subjectName, i18nNames].filter(Boolean).join(' '),
    departmentName,
    subjectCode,
    lectureText: input.lectureText || '',
  });
}
