// Prod'dagi saqlangan taqdimotlarni yangi normalizatordan o'tkazib, nuqsonlarni sanaydi.
import { readFileSync } from 'node:fs';
import { normalizePresentationContent, isRealStat } from '../src/utils/presentationContentSchema';
const decks = JSON.parse(readFileSync(new URL('./harness-out/prod_decks.json', import.meta.url), 'utf8'));
const c = { decks: 0, before: 0, after: 0, statFake0: 0, statFake1: 0, midTitle0: 0, midTitle1: 0, filler0: 0, filler1: 0 };
const fake = (s: any) => s.slide_type === 'statistics' && (s.body.stats || []).filter((x: any) => isRealStat(x)).length < 2;
const filler = (s: any) => s.slide_type !== 'title' && (s.body.bullets || []).length === 1 && s.body.bullets[0].trim() === s.title.trim();
for (const d of decks) {
  c.decks++; c.before += d.slides.length;
  c.statFake0 += d.slides.filter(fake).length;
  c.midTitle0 += d.slides.filter((s: any, i: number) => i > 0 && s.slide_type === 'title').length;
  c.filler0 += d.slides.filter(filler).length + d.slides.filter((s: any, i: number) => i > 0 && s.slide_type === 'title' && (s.body.bullets || []).length <= 1).length;
  const out = normalizePresentationContent({ presentation_title: d.ptitle, slides: d.slides } as any, { title: d.ptitle, subject: '' });
  c.after += out.slides.length;
  c.statFake1 += out.slides.filter(fake).length;
  c.midTitle1 += out.slides.filter((s, i) => i > 0 && s.slide_type === 'title').length;
  c.filler1 += out.slides.filter(filler).length;
}
console.log(c);
