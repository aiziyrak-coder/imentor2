/**
 * Taqdimot generatsiya sifatini lokal o'lchash.
 *
 *   OPENAI_API_KEY=... HARNESS_MODEL=gpt-4.1-mini \
 *     npx vite-node --config scripts/deck.vite.config.ts scripts/deck-harness.ts <label>
 *
 * Kirish: harness-out/deck_cases.json — [{topic, subject_name, subject_code, lang, lecture}]
 * (prod'dagi haqiqiy ma'ruza matni bilan, xuddi o'qituvchi tugmani bosgandek).
 * Rasm qidiruvi stub — faqat mazmun baholanadi.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { aiService } from '../src/services/aiService';

const MODEL = process.env.HARNESS_MODEL || 'gpt-4.1-mini';
const TOKENS = { in: 0, out: 0, calls: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url).includes('api.openai.com') && init?.body) {
    const body = JSON.parse(init.body);
    body.model = MODEL;
    if (/^(gpt-5|o\d)/.test(MODEL)) {
      body.max_completion_tokens = (body.max_tokens || 4000) + 8000;
      delete body.max_tokens;
      delete body.temperature;
      body.reasoning_effort = process.env.HARNESS_EFFORT || 'low';
    }
    init = { ...init, body: JSON.stringify(body) };
  }
  const res = await realFetch(url, init);
  if (String(url).includes('api.openai.com')) {
    try {
      const j = await res.clone().json();
      TOKENS.in += j.usage?.prompt_tokens || 0;
      TOKENS.out += j.usage?.completion_tokens || 0;
      TOKENS.calls += 1;
    } catch { /* xato javob */ }
  }
  return res;
}) as typeof fetch;

type Case = { topic: string; subject_name: string; subject_code: string; lang: 'uz' | 'ru' | 'en'; lecture: string; department?: string };

async function one(c: Case, i: number) {
  const t0 = Date.now();
  try {
    const deck = await aiService.generatePresentationDeck({
      topicTitle: c.topic,
      topicId: String(i + 1),
      topicType: 'lecture' as any,
      subjectName: c.subject_name,
      departmentName: c.department,
      variantLabel: 'Asosiy',
      language: c.lang || 'uz',
      mode: 'generate',
      lectureText: c.lecture,
      subjectCode: c.subject_code,
    });
    console.log(`[${i}] ${c.topic.slice(0, 60)} — ${deck.slides.length} slayd, ${Math.round((Date.now() - t0) / 1000)}s`);
    return { topic: c.topic, subject: c.subject_name, lang: c.lang, seconds: Math.round((Date.now() - t0) / 1000), deck };
  } catch (e) {
    console.log(`[${i}] ${c.topic.slice(0, 60)} — XATO: ${(e as Error).message}`);
    return { topic: c.topic, error: String(e) };
  }
}

async function main() {
  const label = process.argv[2] || 'deck';
  const cases: Case[] = JSON.parse(readFileSync(new URL('./harness-out/deck_cases.json', import.meta.url), 'utf8'));
  const only = process.env.HARNESS_ONLY;
  const picked = cases.map((c, i) => [c, i] as const).filter(([, i]) => !only || only.split(',').map(Number).includes(i));
  const report = await Promise.all(picked.map(([c, i]) => one(c, i)));
  console.log(`model ${MODEL}: ${TOKENS.calls} so'rov, tokenlar in ${TOKENS.in} / out ${TOKENS.out}`);
  writeFileSync(new URL(`./harness-out/${label}.json`, import.meta.url), JSON.stringify({ model: MODEL, tokens: TOKENS, report }, null, 2));
}

main();
