/**
 * Keys (vaziyatli masala) sifatini lokal o'lchash.
 *
 *   OPENAI_API_KEY=... npx vite-node --config scripts/harness.vite.config.ts scripts/case-harness.ts <label>
 *
 * Har mavzu uchun `aiService.generateCaseStudy` chaqiriladi; natija
 * `scripts/harness-out/case_<label>.json` ga yoziladi.
 *   HARNESS_MODEL   — yozish modeli (standart: so'rovdagi model);
 *   HARNESS_REVIEW_MODEL — tekshiruv modeli (`case_review` so'rovlari);
 *   HARNESS_CASES   — mavzular fayli (standart harness-out/case_cases.json);
 *   HARNESS_ONLY=i, HARNESS_SHARD=k/n — bitta mavzu yoki parallel bo'lak.
 *   HARNESS_RESUME=1 — `case_<label>.json` dagi tayyor mavzular qayta yaratilmaydi (tarmoq uzilsa davom etish).
 * Domen prod bilan bir xil bo'lsin deb `prodDomain` ishlatiladi (prodda u kafedradan aniqlanadi).
 * Backend yo'q: RAG manbalar va "oldingi keyslar" bo'sh qaytadi.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { aiService } from '../src/services/aiService';
import { makeGenerationScope, type SubjectDomain } from '../src/utils/subjectDomain';

const TOKENS: Record<string, { in: number; out: number; calls: number }> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  let purpose = 'other';
  if (String(url).includes('api.openai.com') && init?.body) {
    const body = JSON.parse(init.body);
    const isReview = JSON.stringify(body.messages || []).includes('KEYS TEKSHIRUVCHI');
    purpose = isReview ? 'review' : 'gen';
    const override = isReview ? process.env.HARNESS_REVIEW_MODEL : process.env.HARNESS_MODEL;
    if (override) body.model = override;
    if (/^(gpt-5|o\d)/.test(body.model)) {
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
      const t = (TOKENS[purpose] ||= { in: 0, out: 0, calls: 0 });
      t.in += j.usage?.prompt_tokens || 0;
      t.out += j.usage?.completion_tokens || 0;
      t.calls += 1;
      if (j.choices?.[0]?.finish_reason === 'length') console.warn('  ! javob max_tokens chegarasida kesildi');
    } catch { /* xato javob */ }
  }
  return res;
}) as typeof fetch;

type CaseInput = { topic: string; subject: string; department?: string; prodDomain?: SubjectDomain };
const CASES: CaseInput[] = JSON.parse(
  readFileSync(process.env.HARNESS_CASES || new URL('./harness-out/case_cases.json', import.meta.url), 'utf8'),
);

const words = (s: string) => (s.match(/[\p{L}\p{N}'’]+/gu) || []).length;

async function main() {
  const label = process.argv[2] || 'run';
  const only = process.env.HARNESS_ONLY ? Number(process.env.HARNESS_ONLY) : null;
  const lang = (process.env.HARNESS_LANG || 'uz') as 'uz' | 'ru' | 'en';
  mkdirSync(new URL('./harness-out/', import.meta.url), { recursive: true });
  const outUrl = new URL(`./harness-out/case_${label}.json`, import.meta.url);
  const previous: any[] = process.env.HARNESS_RESUME && existsSync(outUrl) ? JSON.parse(readFileSync(outUrl, 'utf8')) : [];
  const done = new Map(previous.filter((r) => r.questions?.length).map((r) => [r.idx, r]));
  const report: any[] = [];
  for (const [ci, c] of CASES.entries()) {
    if (only !== null && ci !== only) continue;
    if (process.env.HARNESS_SHARD) {
      const [k, n] = process.env.HARNESS_SHARD.split('/').map(Number);
      if (ci % n !== k) continue;
    }
    if (done.has(ci)) {
      report.push(done.get(ci));
      continue;
    }
    const base = makeGenerationScope({ topic: c.topic, subjectName: c.subject, departmentName: c.department || '' });
    const scope = c.prodDomain ? { ...base, domain: c.prodDomain } : base;
    const t0 = Date.now();
    try {
      const s = await aiService.generateCaseStudy(c.topic, lang, [], undefined, scope);
      const secs = Math.round((Date.now() - t0) / 1000);
      const qs = s.questions.map((q) => ({ ...q, scenarioWords: words(q.scenario), answerWords: words(q.answer) }));
      console.log(`[${ci}] ${c.topic.slice(0, 60)} (${scope.domain}) — ${qs.length} savol, ` +
        `vaziyat ${qs.map((q) => q.scenarioWords).join('/')} so'z, yechim ${qs.map((q) => q.answerWords).join('/')} so'z, ${secs}s`);
      report.push({ ...c, idx: ci, domain: scope.domain, secs, questions: qs });
    } catch (e) {
      console.log(`[${ci}] ${c.topic.slice(0, 60)} — XATO: ${(e as Error).message}`);
      report.push({ ...c, idx: ci, error: String(e) });
    }
  }
  console.log('tokenlar:', JSON.stringify(TOKENS));
  writeFileSync(outUrl, JSON.stringify(report, null, 2));
}

main();
