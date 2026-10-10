/**
 * Lokal taqdimot create: AI deck → PPTX → /v1/presentations/ upload.
 *
 *   API=http://127.0.0.1:88/api npx tsx scripts/smoke-presentation-create.mts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = (process.env.API || 'http://127.0.0.1:88/api').replace(/\/$/, '');
const HODIM_PHONE = process.env.HODIM_PHONE || '998901112233';
const HODIM_PASS = process.env.HODIM_PASS || 'TestHodim123';
const TOPIC_TITLE = process.env.TOPIC || 'Membran potentsiali';
const TOPIC_ID = process.env.TOPIC_ID || 'M-01';
const SUBJECT = process.env.SUBJECT || 'Normal fiziologiya';
const SUBJECT_CODE = process.env.SUBJECT_CODE || 'fiziologiya__normal-fiziologiya';

type Json = Record<string, unknown>;

type Slide = { title: string; bullets: string[]; notes?: string };
type Deck = { title: string; slides: Slide[] };

async function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; form?: FormData; expect?: number | number[] } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (opts.expect !== undefined) {
    const ok = Array.isArray(opts.expect) ? opts.expect.includes(res.status) : res.status === opts.expect;
    if (!ok) {
      throw new Error(
        `${method} ${path} → ${res.status} expected ${JSON.stringify(opts.expect)}: ${text.slice(0, 500)}`,
      );
    }
  }
  return { status: res.status, body };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI javobida JSON topilmadi');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

async function buildPptxBuffer(deck: Deck): Promise<Buffer> {
  const mod = await import('pptxgenjs');
  // `pptxgenjs` modul turi konstruktor emas, shuning uchun `default` ni
  // noma'lum konstruktor sifatida olamiz - quyida tuzilma bilan tavsiflanadi.
  const PptxGenJS = (mod as { default?: unknown }).default ?? mod;
  const pptx = new (PptxGenJS as new () => {
    author: string;
    title: string;
    layout: string;
    addSlide: () => {
      background: { color: string };
      addText: (...args: unknown[]) => void;
      addShape: (...args: unknown[]) => void;
    };
    write: (opts: { outputType: string }) => Promise<Buffer | Uint8Array | ArrayBuffer>;
  })();
  pptx.author = 'iMentor';
  pptx.title = deck.title.slice(0, 120);
  pptx.layout = 'LAYOUT_WIDE';
  const BG = 'F6FAFD';
  const TITLE = '083047';
  const ACCENT = '0284C7';
  const BODY = '1C2733';

  deck.slides.forEach((slide, idx) => {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText(slide.title || `Slayd ${idx + 1}`, {
      x: 0.5,
      y: 0.4,
      w: 12.3,
      h: 0.7,
      fontSize: idx === 0 ? 30 : 22,
      bold: true,
      color: TITLE,
      fontFace: 'Calibri',
    });
    const bullets = (slide.bullets || []).filter(Boolean).slice(0, 10);
    if (bullets.length) {
      s.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        {
          x: 0.7,
          y: 1.3,
          w: 11.8,
          h: 5.4,
          fontSize: 15,
          color: BODY,
          fontFace: 'Calibri',
          paraSpaceAfter: 8,
        },
      );
    }
    s.addShape('rect', {
      x: 0,
      y: 0,
      w: 0.12,
      h: 7.5,
      fill: { color: ACCENT },
      line: { type: 'none' },
    });
  });

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return Buffer.from(out);
}

async function main() {
  console.log(`API=${API}`);
  console.log(`topic=${TOPIC_ID} — ${TOPIC_TITLE}`);

  const login = await req('POST', '/v1/auth/local-login/', {
    body: { phone_digits: HODIM_PHONE, password: HODIM_PASS, role: 'hodim' },
    expect: 200,
  });
  const token = String((login.body as Json).access || '');
  assert(token, 'hodim token');
  console.log('ok login=hodim');

  const system =
    'Siz tibbiyot professori va taqdimot metodistisiz. Return ONLY valid JSON: ' +
    '{"title":"...","slides":[{"title":"...","bullets":["..."],"notes":"..."}]} . ' +
    'KAMIDA 8 slayd. Har kontent-slaydda 4-6 uzun bullet (to\'liq gaplar). Til: o\'zbek.';
  const user =
    `Mavzu: "${TOPIC_ID} — ${TOPIC_TITLE}". Fan: ${SUBJECT}. ` +
    'Universitet ma\'ruzasi uchun matnga boy PPTX taqdimot JSON yarating.';

  console.log('… AI deck generatsiya');
  const ai = await req('POST', '/v1/education-ai/completion/', {
    token,
    body: {
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 8000,
      temperature: 0.35,
      subject_code: SUBJECT_CODE,
      topic_query: TOPIC_TITLE,
    },
    expect: 200,
  });
  const content = String((ai.body as Json).content || '');
  assert(content.trim(), 'AI content bo‘sh');
  const raw = parseJsonLoose<Partial<Deck>>(content);
  const slides = Array.isArray(raw.slides) ? raw.slides : [];
  assert(slides.length >= 6, `kam slayd: ${slides.length}`);
  const deck: Deck = {
    title: String(raw.title || `${TOPIC_ID} — ${TOPIC_TITLE}`),
    slides: slides.map((s, i) => ({
      title: String(s?.title || `Slayd ${i + 1}`),
      bullets: Array.isArray(s?.bullets) ? s.bullets.map(String).filter(Boolean) : [],
      notes: s?.notes ? String(s.notes) : undefined,
    })),
  };
  console.log(`ok deck slides=${deck.slides.length} title=${deck.title.slice(0, 60)}`);

  const buf = await buildPptxBuffer(deck);
  assert(buf.length > 1000, 'pptx juda kichik');
  const outPath = join(process.cwd(), `smoke-presentation-${Date.now().toString(36)}.pptx`);
  writeFileSync(outPath, buf);
  console.log(`ok pptx bytes=${buf.length} file=${outPath}`);

  const topic = `${TOPIC_ID} — ${TOPIC_TITLE}`.slice(0, 240);
  const topicNorm = `${SUBJECT_CODE}::${TOPIC_ID}::${TOPIC_TITLE}`
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 255);
  const form = new FormData();
  form.append('topic', topic);
  form.append('topic_norm', topicNorm);
  form.append('title', deck.title.slice(0, 240));
  form.append(
    'file',
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }),
    `${TOPIC_ID}-taqdimot.pptx`,
  );

  const uploaded = await req('POST', '/v1/presentations/', {
    token,
    form,
    expect: [200, 201],
  });
  const item = uploaded.body as Json;
  assert(item && typeof item.id === 'number', 'upload id');
  console.log(`PASS presentation id=${item.id} file=${item.file_name || item.file || '?'}`);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
