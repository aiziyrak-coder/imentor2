/**
 * Content+Design qatlamlari bilan Dermatovenerologiya test taqdimoti.
 *
 *   API=http://127.0.0.1:88/api npx tsx scripts/make-structured-presentation.mts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Blob as NodeBlob } from 'node:buffer';
import { buildPresentationPptxFile } from '../src/utils/buildPresentationPptx';
import {
  PRESENTATION_JSON_SCHEMA,
  normalizePresentationContent,
  type PresentationContent,
} from '../src/utils/presentationContentSchema';
import { qaPresentationContent } from '../src/utils/presentationQa';
import { resolvePresentationImages } from '../src/utils/presentationImages';

if (typeof globalThis.File === 'undefined') {
  class NodeFile extends NodeBlob {
    name: string;
    lastModified: number;
    constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
      // Node'ning `Blob` i DOM `BlobPart` ini bilmaydi - bu shim faqat
      // skript uchun, shuning uchun tur tekshiruvi chetlab o'tiladi.
      super(bits as unknown as ConstructorParameters<typeof NodeBlob>[0], options);
      this.name = name;
      this.lastModified = options?.lastModified ?? Date.now();
    }
  }
  (globalThis as { File: typeof File }).File = NodeFile as unknown as typeof File;
}

const API = (process.env.API || 'http://127.0.0.1:88/api').replace(/\/$/, '');
const HODIM_PHONE = process.env.HODIM_PHONE || '998901112233';
const HODIM_PASS = process.env.HODIM_PASS || 'TestHodim123';
const OUT =
  process.env.OUT ||
  join(process.cwd(), 'Dermatovenerologiya-L1-structured.pptx');

type Json = Record<string, unknown>;

async function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; form?: FormData; expect?: number | number[] } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (opts.expect !== undefined) {
    const ok = Array.isArray(opts.expect) ? opts.expect.includes(res.status) : res.status === opts.expect;
    if (!ok) throw new Error(`${method} ${path} → ${res.status}: ${String(text).slice(0, 500)}`);
  }
  return body;
}

function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('JSON topilmadi');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

async function main() {
  console.log(`API=${API}`);
  const login = (await req('POST', '/v1/auth/local-login/', {
    body: { phone_digits: HODIM_PHONE, password: HODIM_PASS, role: 'hodim' },
    expect: 200,
  })) as Json;
  const token = String(login.access || '');
  if (!token) throw new Error('token yo‘q');

  const subject = 'Dermatovenerologiya';
  const topicId = 'L1';
  const topicTitle =
    'Teri anatomiyasi va fiziologiyasi. Dermatovenerologiyaga kirish.';

  const system =
    'Siz FJSTI tibbiyot professori va klinik ta\'lim metodistisiz. ' +
    'Sen FAQAT kontent qaytarasan — dizayn, rang, font haqida hech narsa yozma. ' +
    'Har slaydda MAX 5 bullet. HAR bullet MINIMUM 15, MAXIMUM 36 so\'z — ' +
    'atama + tushuntirish (nima/qanday/nega muhim). Qisqa 2–4 so\'zlik tezis TAQIQLANGAN. ' +
    '8–10 slayd; slide_type: title, agenda, content_bullets, statistics, process_flow, ' +
    'comparison_table, case_study, image_focus, summary — aralashtir. ' +
    'content_bullets/image_focus/case_study uchun image_query MAJBURIY ' +
    '(inglizcha: "human skin layers epidermis dermis diagram" kabi). ' +
    'summary: "Sarlavha: tushuntirish" formatida. Til: o\'zbek.';

  const user =
    `Fan: ${subject}. Mavzu ${topicId}: ${topicTitle}. ` +
    'MAJBURIY slide_type ketma-ketligi (9 slayd): title, agenda, content_bullets, statistics, ' +
    'process_flow, comparison_table, case_study, image_focus, summary. ' +
    'Har content/case/image bulletida kamida 18 so\'z. ' +
    'image_query: "human skin layers epidermis dermis diagram", "dermatology clinical rash", ' +
    '"skin histology microscope" kabi aniq tibbiy EN so\'rovlar. ' +
    'JSON: presentation_title, subject_area, author, slides[] with slide_type, title, subtitle, ' +
    'body{bullets,key_stat,stats,columns,comparison_rows,process_steps,quote_text,quote_author}, ' +
    'image_query, speaker_notes. Ishlatilmagan body maydonlari bo\'sh array/string.';

  console.log('… Content Layer (json_schema)');
  let contentRaw: string;
  try {
    const ai = (await req('POST', '/v1/education-ai/completion/', {
      token,
      body: {
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 8000,
        temperature: 0.35,
        response_format: {
          type: 'json_schema',
          json_schema: PRESENTATION_JSON_SCHEMA,
        },
      },
      expect: 200,
    })) as Json;
    contentRaw = String(ai.content || '');
  } catch (e) {
    console.warn('json_schema failed, prompt fallback', e);
    const ai = (await req('POST', '/v1/education-ai/completion/', {
      token,
      body: {
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: system + ' Return ONLY valid JSON.' },
          { role: 'user', content: user },
        ],
        max_tokens: 8000,
        temperature: 0.3,
      },
      expect: 200,
    })) as Json;
    contentRaw = String(ai.content || '');
  }

  let content: PresentationContent = normalizePresentationContent(
    parseJsonLoose<Partial<PresentationContent>>(contentRaw),
    { title: `${topicId} — ${topicTitle}`, subject, author: 'iMentor' },
  );
  const issues = qaPresentationContent(content);
  console.log(`ok slides=${content.slides.length} qa_issues=${issues.length}`);
  console.log(
    'types:',
    content.slides.map((s) => s.slide_type).join(' → '),
  );

  console.log('… images');
  content = await resolvePresentationImages(content);
  const withImg = content.slides.filter((s) => s.imageUrl).length;
  console.log(`ok images=${withImg}`);

  console.log('… Design Layer PPTX');
  const file = await buildPresentationPptxFile(content, {
    meta: { subjectName: subject, topicId, variantLabel: 'Stom' },
  });
  const buf = Buffer.from(await file.arrayBuffer());
  writeFileSync(OUT, buf);
  console.log(`PASS pptx bytes=${buf.length} file=${OUT}`);

  const form = new FormData();
  form.append('topic', `${topicId} — ${topicTitle}`.slice(0, 240));
  form.append('topic_norm', `derm-test::stom::${topicId.toLowerCase()}`);
  form.append('title', content.presentation_title.slice(0, 240));
  form.append(
    'file',
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }),
    'Dermatovenerologiya-L1.pptx',
  );
  const uploaded = (await req('POST', '/v1/presentations/', {
    token,
    form,
    expect: [200, 201],
  })) as Json;
  console.log(`PASS upload id=${uploaded.id}`);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
