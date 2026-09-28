/**
 * Material klinikmi yoki yo'q — test, keys, taqdimot va ma'ruza shu bo'yicha yoziladi.
 *
 * ── Nega qayta yozildi (2026-09-25) ──────────────────────────────────────
 * Ilgari domen ikki qiymatli edi va NOMA'LUM holat "klinik" deb olinardi.
 * Natijada klinik bo'lmagan fanlarga ham bemor kartasi, tashxis va dori bilan
 * material chiqardi: anatomiya mavzusiga "68 yoshli bemor, qorin og'rig'i",
 * tilshunoslikka HbA1c.
 *
 * Endi uch daraja bor va qaror MAVZUdan boshlanadi:
 *
 *   clinical   — bemor yonidagi qaror: tashxis, davolash taktikasi, dori.
 *                Institutning RASMIY klinik kafedralari (`departmentIsClinical`
 *                bayrog'i serverdan keladi) yoki mavzuning o'zi bemor qarorini
 *                talab qilsa.
 *   biomedical — tibbiy, lekin bemorsiz: anatomiya, fiziologiya, biokimyo,
 *                mikrobiologiya, farmakologiya, gigiyena, gistologiya.
 *                Mexanizm, tuzilma, laboratoriya, me'yor — bemor kartasi YO'Q.
 *   academic   — tibbiyotdan tashqari: til, informatika, matematika, huquq,
 *                ijtimoiy fanlar. Tibbiy misol umuman ishlatilmaydi.
 *
 * Noma'lum holat endi "klinik" emas: tibbiy ishora bo'lsa `biomedical`,
 * bo'lmasa `academic`. Ya'ni xato bo'lganda ham soxta bemor yaratilmaydi.
 */

import type { SyllabusTopicContext } from './syllabusTopicContext';

export type SubjectDomain = 'clinical' | 'biomedical' | 'academic';

/** Bemor kartasi (yosh + shikoyat + tashxis + dori) yozilmaydigan domenlar. */
export function isPatientFree(domain: SubjectDomain): boolean {
  return domain !== 'clinical';
}

/** Tibbiy mazmun (kasallik, laboratoriya, dori) umuman o'rinli domenlar. */
export function isMedicalDomain(domain: SubjectDomain): boolean {
  return domain !== 'academic';
}

export type GenerationScope = {
  domain: SubjectDomain;
  subjectName: string;
  departmentName: string;
  lectureText: string;
};

/**
 * Kirill harflarini lotinga o‘giradi.
 *
 * Ilgari faqat bir nechta kirill so‘z alohida almashtirilardi, shuning uchun
 * "Ахборот технологиялари" kabi ruscha yozilgan fan nomi hech qaysi qolipga
 * tushmay, standart qiymat — "klinik" — bo‘lib qolardi. Natijada informatika
 * fani uchun bemor kartasi bilan test yaratilardi.
 */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

function translit(value: string): string {
  return value.replace(/[Ѐ-ӿ]/g, (ch) => CYRILLIC[ch] ?? ch);
}

/** Imlo, kirill va odatiy xatolar — taqqoslash uchun. */
export function foldDomainText(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Tutuq belgisining HAMMA shakli: 'yo‘nalish' va 'yo’nalish' bir xil o'qilsin.
    .replace(/[''`ʻ‘’ʼ´]/g, '')
    .replace(/texnalog/g, 'texnolog')
    .replace(/elektorin/g, 'elektron')
    .replace(/ahborot/g, 'axborot')
    .replace(/информационн?\s*технолог/g, 'axborot texnolog')
    .replace(/\s+/g, ' ')
    .replace(/[Ѐ-ӿ]+/g, translit)
    .replace(/texnalog/g, 'texnolog')
    .replace(/ahborot/g, 'axborot')
    .trim();
}

const ACADEMIC_RE =
  /dinshunos|diniy|religi|религи|\btarix\b|история|sotsiolog|социолог|siyosatshunos|politolog|manaviy|madaniyat|kulturolog|\betika\b|bioetika|axloq|deontolog|menejment|marketing|filosof|философ|\bmantiq\b|\blogika\b|informatika|информатик|axborot|ахборот|tibbiyotda\s+axborot|texnologiyalar(i|и)|elektronika|электроник|elektrotexnika|elektron\s*(pochta|xat|imzo|hujjat|tijorat|hisob)|pochta\s*xizmat|\bemail\b|\bsmtp\b|\bimap\b|kiberxavfsizlik|dasturlash|dasturiy\s*taminot|kompyuter|компьютер|algoritm|matemat|математ|oliy\s*matemat|\bfizika\b|\bфизика\b|biofizika|lotin|latin|ximiya|himiya|латин|xorijiy\s*til|ingliz\s*til|rus\s*til|ozbek\s*til|pedagog|falsafa|huquq|iqtisod|statistika|muhandis|jismoniy\s*tarbiya|\bsport\b|malumotlar\s*bazasi|tarmoq|office|\bexcel\b|\bpython\b|sanoq\s*tizim|ikkilik|onlik|on\s*oltilik|protokol|parol|brauzer|\bhtml\b|\bcss\b|\bhttp\b|ip\s*adres|domen\s*nomi|\bkimyo\b|химия|integral\s*hisob|matritsa|vektor\s*algebra/i;

const ACADEMIC_CODE_RE =
  /(^|[^a-z0-9])(inf|ict|math|phys|lat|cs|comp)(\d|[-_]|$)|(^|[-_\/])it([-_\/]|$)/i;

/**
 * Institutning RASMIY klinik kafedralari (hujjat, 2026-09-25) — bemor yonida,
 * shifoxona/dispanser bazasida dars o'tadigan 15 kafedra.
 *
 * Asosiy manba — serverdan keladigan `departmentIsClinical` bayrog'i
 * (`core_academicdepartment.is_clinical`). Bu qolip faqat bayroq yetib
 * kelmagan joylar uchun (eski localStorage konteksti, tashqi API).
 */
const CLINICAL_DEPT_RE =
  /jarroh|jarrox|xirurg|gospital\s*terapi|fakultet\s*terapi|(^|\s)terapiya|terapevt|\buash\b|ichki\s*kasall|propedevt|neonatolog|reabilitolog|reabilitatsi|yuz[-\s]?jag|nevrolog|psixiatr|narkolog|pediatr|urolog|onkolog|akusher|ginekolog|stomat|otorino|otolaring|travmat|ortoped|dermat|venerolog|allergolog|endokrin|gematolog|gemotolog|ftiziatr|epidemiolog|yuqumli\s*kasall|infeksion|hamshiralik\s*ish|umumiy\s*amaliyot|oilaviy\s*shifokor|kardiolog|pulmonolog|gastroenter|nefrolog|anestezi|reanimat|oftalmolog|revmatolog/i;

/**
 * Nomida klinik so'z bo'lsa ham bemor yonida EMAS: "Normal anatomiya, operativ
 * jarrohlik va topografik anatomiya", "Patologik fiziologiya va patologik
 * anatomiya". Bunday kafedrada dars preparat va tuzilma ustida boradi.
 */
const BASIC_SCIENCE_DEPT_RE =
  /normal\s*anatom|topografik\s*anatom|operativ\s*jarroh|patologik\s*anatom|patologik\s*fiziolog/i;

/** Tibbiy, lekin bemor yonida emas — nazariy-tajriba fanlari. */
const BIOMEDICAL_RE =
  /anatom|morfolog|fiziolog|patofiziolog|patologik\s*anatom|gistolog|sitolog|embriolog|mikrobiolog|virusolog|parazitolog|immunolog|biokimyo|bioxim|tibbiy\s*kimyo|farmakolog|farmatsi|farmakognoz|gigiyen|gigien|sanitari|toksikolog|genetik|tibbiy\s*biolog|biolog|sud\s*tibbiy|tibbiy\s*statistika|normal\s*anatom|latin\s*tili\s*va\s*tibbiy|radiolog|rentgen|nurli\s*tashxis|laboratoriya\s*ish|sogliqni\s*saqlash|preventiv|davolash\s*ish|tibbiy\s*profilaktika|jamoat\s*salomatlig/i;

/**
 * Mavzu bemor yonidagi QARORNI talab qiladimi. Shunday bo'lsa — fan qanday
 * bo'lishidan qat'i nazar (tibbiy bo'lsa) klinik keys o'rinli.
 */
const PATIENT_TOPIC_RE =
  /\bbemor|\bmurojaat\s*qil|shikoyat\s*bilan|tashxis|diagnost|differensial|davolash|davolash\s*taktik|taktika|shoshilinch\s*yordam|birinchi\s*yordam|reanimat|asorat|dispanser\s*kuzatuv|retsept|dori\s*doza|klinik\s*korik|klinik\s*tekshiruv|palata|statsionar|ambulator|lecheni|diagnostik/i;

/**
 * Mavzu kasallik haqida. Klinik kafedrada — klinik; nazariy (anatomiya,
 * mikrobiologiya) kafedrada — tibbiy, lekin bemorsiz.
 */
const DISEASE_TOPIC_RE =
  /kasallik|sindrom|infeksi|infekts|yallig|patolog|nozolog|etiolog|patogenez|jarohat|shikastlan|zaharlan|osma\b|osmalar|gepatit|toksikoz|homila|preeklampsi|anemi|yetishmovchilig|\bshok\b|farmakoterap|farmakokinet|farmakodinam|dori\s*modda|bolezn|klinich/i;

/**
 * Klinik fanning ichida ham bemor ssenariysi talab qilmaydigan MAVZULAR bor:
 * "Gigienaning predmeti va vazifalari", "Hamshiralik ishidagi boshqaruv",
 * "Onkologik xizmatni tashkil etish". Ilgari ular fan nomiga qarab "klinik"
 * deb olinar va "68 yoshli bemor, qorin og'rig'i" kabi mavzuga aloqasiz keys
 * va testlar chiqardi (2026-09-17 auditida ~300 ta shunday material).
 */
const THEORY_TOPIC_RE =
  /predmeti|vazifalari|fanining|tarixi|tashkil\s+etish|tashkiliy|tashkiloti|boshqaruv|boshqarish|menejment|rahbarlik|qonunchilik|huquqiy|meyoriy|standartlar|\betika\b|deontolog|kasbiy\s+xavfsizlik|ish\s+joyi|metodologiya|tadqiqot\s+usul|statistika|gigi[ey]?enik\s+(ahamiyat|baho)|sanitariya|mikroiqlim|atrof[-\s]+muhit|ekologiya|falsafa|predmet\s+i\s+zadach|istoriya|organizats|upravlen/i;

export function resolveSubjectDomain(input: {
  departmentName?: string;
  subjectName?: string;
  subjectCode?: string;
  topic?: string;
  lectureText?: string;
  /** Serverdagi rasmiy bayroq (`core_academicdepartment.is_clinical`). */
  departmentIsClinical?: boolean;
}): SubjectDomain {
  const meta = foldDomainText(
    `${input.departmentName || ''} ${input.subjectName || ''} ${input.subjectCode || ''}`,
  );
  const topic = foldDomainText(input.topic || '');
  const rest = foldDomainText(`${input.topic || ''} ${(input.lectureText || '').slice(0, 2500)}`);

  const deptClinical =
    input.departmentIsClinical === true ||
    (!!meta && CLINICAL_DEPT_RE.test(meta) && !BASIC_SCIENCE_DEPT_RE.test(meta));
  // "Tibbiy va biologik kimyo" ikkala qolipga ham tushadi ("kimyo" akademik,
  // "biologik" tibbiy) — tibbiy qolip ustun: bu fan tibbiyotdan tashqari emas.
  const nonMedical =
    !!meta && (ACADEMIC_RE.test(meta) || ACADEMIC_CODE_RE.test(meta)) && !BIOMEDICAL_RE.test(meta);
  const medical =
    deptClinical || (!!meta && BIOMEDICAL_RE.test(meta) && !nonMedical) ||
    (!!rest && !nonMedical && (PATIENT_TOPIC_RE.test(rest) || DISEASE_TOPIC_RE.test(rest)));

  // 1. Fan tibbiyotdan tashqari bo'lsa — mavzu nima bo'lishidan qat'i nazar.
  //    "Axborot texnologiyalari" da "tashxis" so'zi uchrasa ham bemor yo'q.
  if (nonMedical && !deptClinical) return 'academic';

  // 2. MAVZU hal qiladi — foydalanuvchi aynan shuni so'radi.
  if (topic) {
    if (PATIENT_TOPIC_RE.test(topic)) return medical ? 'clinical' : 'academic';
    if (THEORY_TOPIC_RE.test(topic) && !DISEASE_TOPIC_RE.test(topic)) {
      return medical ? 'biomedical' : 'academic';
    }
    if (DISEASE_TOPIC_RE.test(topic)) return deptClinical ? 'clinical' : medical ? 'biomedical' : 'academic';
  }

  // 3. Mavzu jim bo'lsa — kafedra va fan.
  if (deptClinical) return 'clinical';
  if (meta && BIOMEDICAL_RE.test(meta)) return 'biomedical';

  // 4. Oxirgi chora — ma'ruza matni. Tibbiy ishora bo'lsa bemorsiz tibbiy,
  //    aks holda akademik. NOMA'LUM hech qachon "klinik" bo'lmaydi.
  if (rest && ACADEMIC_RE.test(rest)) return 'academic';
  if (rest && (PATIENT_TOPIC_RE.test(rest) || DISEASE_TOPIC_RE.test(rest) || BIOMEDICAL_RE.test(rest))) {
    return 'biomedical';
  }
  return 'academic';
}

export function academicTextHasClinicalLeak(text: string): boolean {
  const t = foldDomainText(text);
  if (!t) return false;
  if (
    // Faqat aniq klinik vignette belgilari: nazariy/gigiyena mavzusida "shifokor" yoki
    // "qon bosimi" so'zi uchrashi tabiiy, ular uchun qayta generatsiya bekorga pul sarflardi.
    /hba1c|metformin|insulin\b|qandli\s*diabet|appenditsit|pnevmoni|leykotsit|qon\s*shakar/.test(
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

/**
 * Bemorsiz domenda (biomedical) tibbiy atama TABIIY — faqat individual bemor
 * vignette taqiqlanadi. Shuning uchun tekshiruv "yoshli bemor + qaror" shakliga
 * qaraydi, atamaning o'ziga emas.
 */
export function patientVignetteLeak(text: string): boolean {
  const t = foldDomainText(text);
  if (!t) return false;
  return /\d{1,3}\s*yoshli/.test(t) && /(ayol|erkak|bemor|bola)/.test(t);
}

export function academicBundleHasClinicalLeak(parts: Array<string | undefined | null>): boolean {
  return parts.some((p) => academicTextHasClinicalLeak(p || ''));
}

/** Bemorsiz domen uchun: qismlarda individual bemor ssenariysi bormi. */
export function patientVignetteBundleLeak(parts: Array<string | undefined | null>): boolean {
  return parts.some((p) => patientVignetteLeak(p || ''));
}

const DOMAIN_LINE: Record<SubjectDomain, string> = {
  clinical:
    'DOMEN: klinik tibbiyot (bemor yonidagi qaror). Bemor kartasi, sindrom, tashxis, dori — FAQAT MAVZU DOIRASIDA.',
  biomedical:
    'DOMEN: tibbiy, lekin BEMORSIZ fan (anatomiya, fiziologiya, biokimyo, mikrobiologiya, farmakologiya, gigiyena). ' +
    'Tibbiy atama, mexanizm, tuzilma, laboratoriya ko\'rsatkichi, me\'yor va tajriba O\'RINLI. ' +
    'INDIVIDUAL BEMOR kartasi (yosh + shikoyat + tashxis + dori tayinlash), KROK/USMLE vignette TAQIQLANADI — ' +
    'vaziyat preparat, namuna, tajriba, o\'lchov, me\'yordan chetlanish yoki sanitariya holati misolida quriladi.',
  academic:
    'DOMEN: tibbiyotdan TASHQARI fan (til, informatika, matematika, huquq, iqtisod, ijtimoiy fan). ' +
    'BEMOR, kasallik, tashxis, dori, laboratoriya ko\'rsatkichi umuman ISHLATILMASIN. ' +
    'Vaziyat mavzuga mos mutaxassis, jamoa, muassasa, hujjat, tadqiqot yoki jamiyat misolida quriladi. ' +
    'Savol va keys kafedra + fan + mavzu + ma\'ruza (bo\'lsa) doirasida.',
};

export function buildScopePrompt(scope: GenerationScope): string {
  const lecture = (scope.lectureText || '').trim();
  const lectureBlock = lecture
    ? `MA'RUZA MATNI (asosiy manba — savol va keys SHU matn + mavzudan chiqmasin):\n${lecture.slice(0, 8500)}`
    : 'Ma\'ruza matni berilmagan — faqat kafedra, fan va mavzu doirasida yozing, boshqa fan aralashtirmang.';
  return [
    `Kafedra: ${scope.departmentName || '—'}.`,
    `Fan: ${scope.subjectName || '—'}.`,
    DOMAIN_LINE[scope.domain],
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
  departmentIsClinical?: boolean;
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
  // Rasmiy bayroq: kafedra institut hujjatidagi klinik ro'yxatdami.
  let departmentIsClinical: boolean | undefined;
  const syllabusId = input.context?.syllabusId;

  if (syllabusId) {
    try {
      const { fetchMyCourseSelections } = await import('./syllabusApi');
      // Bayroq faqat aniqlik uchun: tarmoq sekin bo'lsa generatsiya uni kutib
      // turmasin — 3 soniyadan keyin kafedra nomi bo'yicha davom etiladi.
      const mine = await Promise.race([
        fetchMyCourseSelections(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('selections-slow')), 3000)),
      ]);
      const hit = mine.find((row) => row.syllabus.id === syllabusId)?.syllabus;
      if (hit) {
        subjectName = subjectName || hit.subject_name || '';
        departmentName = departmentName || hit.department_name || '';
        subjectCode = subjectCode || hit.subject_code || '';
        i18nNames = [hit.name_i18n?.uz, hit.name_i18n?.ru, hit.name_i18n?.en].filter(Boolean).join(' ');
        if (typeof hit.department_is_clinical === 'boolean') {
          departmentIsClinical = hit.department_is_clinical;
        }
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
    departmentIsClinical,
  });
}
