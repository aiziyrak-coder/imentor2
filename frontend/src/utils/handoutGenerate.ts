import type { AppLanguage } from '../i18n/language';
import type { SyllabusTopic, SyllabusTopicType } from '../services/aiService';
import {
  generateHandoutInfographicPack,
  pickHandoutText,
  type HandoutInfographicPack,
} from './handoutInfographic';
import { uploadAdminHandout, uploadHandout, type TopicHandoutItem } from './handoutApi';
import type { SyllabusTopicContext } from './syllabusTopicContext';

const LANGS: AppLanguage[] = ['uz', 'ru', 'en'];
const W = 1400;
const H = 980;
const ACCENTS = ['#1d4ed8', '#b45309', '#be185d', '#7c3aed', '#0f766e', '#0369a1', '#c2410c', '#047857'];

export type HandoutGenerateProgress = 'ai' | 'render' | 'upload';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = (text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.replace(/\s+\S*$/, '') + '…';
  }
  return lines;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('handout-png-empty'))), 'image/png');
  });
}

/** html2canvas o'rniga — off-screen DOM chizish brauzerda yiqilardi. */
function rasterizePack(params: {
  pack: HandoutInfographicPack;
  lang: AppLanguage;
  subjectName?: string;
  topicId?: string;
}): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('handout-canvas-missing'));

  const { pack, lang } = params;
  ctx.fillStyle = '#edf2f7';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#083047';
  ctx.fillRect(0, 0, W, 118);

  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 13px Segoe UI, Arial, sans-serif';
  const kicker = pickHandoutText(pack.kicker, lang) || "O'quv posteri";
  ctx.fillText(`${kicker}  ·  ${lang.toUpperCase()}`, 28, 32);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px Segoe UI, Arial, sans-serif';
  const titleLines = wrapText(ctx, pickHandoutText(pack.title, lang), W - 56, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, 28, 64 + i * 30));

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 13px Segoe UI, Arial, sans-serif';
  const meta = [params.topicId, params.subjectName, pickHandoutText(pack.heroCaption, lang)]
    .filter(Boolean)
    .join('  ·  ');
  ctx.fillText(meta.slice(0, 140), 28, 108);

  const cols = 4;
  const rows = 2;
  const pad = 16;
  const gap = 12;
  const top = 130;
  const footer = 36;
  const gridW = W - pad * 2;
  const gridH = H - top - footer;
  const cellW = (gridW - gap * (cols - 1)) / cols;
  const cellH = (gridH - gap * (rows - 1)) / rows;

  pack.sections.slice(0, 8).forEach((section, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cellW + gap);
    const y = top + row * (cellH + gap);
    const accent = ACCENTS[i % ACCENTS.length];

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d5dee8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, cellW, cellH, 10);
    } else {
      ctx.rect(x, y, cellW, cellH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.fillRect(x, y, 6, cellH);

    ctx.fillStyle = accent;
    ctx.font = 'bold 11px Segoe UI, Arial, sans-serif';
    ctx.fillText(String(section.n).padStart(2, '0'), x + 16, y + 22);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px Segoe UI, Arial, sans-serif';
    const heading = wrapText(ctx, pickHandoutText(section.heading, lang), cellW - 28, 2);
    heading.forEach((line, li) => ctx.fillText(line, x + 16, y + 44 + li * 18));

    ctx.fillStyle = '#334155';
    ctx.font = '13px Segoe UI, Arial, sans-serif';
    let ty = y + 44 + heading.length * 18 + 10;
    const lead = wrapText(ctx, pickHandoutText(section.lead, lang), cellW - 28, 3);
    lead.forEach((line) => {
      ctx.fillText(line, x + 16, ty);
      ty += 16;
    });
    ty += 6;
    const points = section.points.map((p) => pickHandoutText(p, lang)).filter(Boolean).slice(0, 4);
    ctx.fillStyle = '#1e293b';
    points.forEach((p) => {
      if (ty > y + cellH - 18) return;
      const lines = wrapText(ctx, `• ${p}`, cellW - 28, 2);
      lines.forEach((line) => {
        if (ty > y + cellH - 16) return;
        ctx.fillText(line, x + 16, ty);
        ty += 15;
      });
    });
  });

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px Segoe UI, Arial, sans-serif';
  ctx.fillText('iMentor · FJSTI · o‘quv posteri', 28, H - 14);
  ctx.fillText(lang.toUpperCase(), W - 48, H - 14);

  return canvasToPngBlob(canvas);
}

async function blobToPngFile(blob: Blob, name: string): Promise<File> {
  try {
    return new File([blob], name, { type: 'image/png' });
  } catch {
    return new File([blob], name);
  }
}

export async function generateAndUploadTopicHandouts(params: {
  topicTitle: string;
  topicId: string;
  topicType: SyllabusTopicType | string;
  subjectName: string;
  subjectCode?: string;
  topic: string | SyllabusTopic | SyllabusTopicContext;
  mode: 'staff' | 'admin';
  syllabusId?: number;
  variantLabel?: string;
  onProgress?: (stage: HandoutGenerateProgress, lang?: AppLanguage) => void;
}): Promise<TopicHandoutItem[]> {
  params.onProgress?.('ai');
  const pack = await generateHandoutInfographicPack({
    topicTitle: params.topicTitle,
    topicId: params.topicId,
    topicType: String(params.topicType || 'lecture'),
    subjectName: params.subjectName,
    subjectCode: params.subjectCode,
  });

  const saved: TopicHandoutItem[] = [];
  for (const lang of LANGS) {
    params.onProgress?.('render', lang);
    const blob = await rasterizePack({
      pack,
      lang,
      subjectName: params.subjectName,
      topicId: params.topicId,
    });
    const title = (pickHandoutText(pack.title, lang) || params.topicTitle).slice(0, 240);
    const topicLabel = params.topicTitle.slice(0, 240);
    const safeCode = (params.topicId || 'mavzu').replace(/[^\w.-]+/g, '_').slice(0, 24);
    const file = await blobToPngFile(blob, `tarqatma-${safeCode}-${lang}.png`);
    params.onProgress?.('upload', lang);
    if (params.mode === 'admin') {
      const syllabusId = params.syllabusId;
      const variantLabel = params.variantLabel || 'asosiy';
      if (!syllabusId) throw new Error('syllabus-id-required');
      saved.push(
        await uploadAdminHandout({
          syllabusId,
          variantLabel,
          topicCode: params.topicId,
          topic: topicLabel,
          title,
          language: lang,
          file,
        }),
      );
    } else {
      saved.push(
        await uploadHandout({
          topic: typeof params.topic === 'string' ? params.topic.slice(0, 240) : params.topic,
          file,
          title,
          language: lang,
        }),
      );
    }
  }
  return saved;
}
