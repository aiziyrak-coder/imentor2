import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import html2canvas from 'html2canvas';
import type { AppLanguage } from '../i18n/language';
import type { SyllabusTopic, SyllabusTopicType } from '../services/aiService';
import HandoutInfographicPoster from '../components/handouts/HandoutInfographicPoster';
import {
  HANDOUT_POSTER_H,
  HANDOUT_POSTER_W,
  generateHandoutInfographicPack,
  pickHandoutText,
  type HandoutInfographicPack,
} from './handoutInfographic';
import { uploadAdminHandout, uploadHandout, type TopicHandoutItem } from './handoutApi';
import type { SyllabusTopicContext } from './syllabusTopicContext';

const LANGS: AppLanguage[] = ['uz', 'ru', 'en'];

export type HandoutGenerateProgress = 'ai' | 'render' | 'upload';

function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function rasterizePack(params: {
  pack: HandoutInfographicPack;
  lang: AppLanguage;
  subjectName?: string;
  topicId?: string;
}): Promise<Blob> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(
      createElement(HandoutInfographicPoster, {
        pack: params.pack,
        lang: params.lang,
        subjectName: params.subjectName,
        topicId: params.topicId,
      }),
    );
    await waitFrame();
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => window.setTimeout(r, 220));
    const el = host.querySelector('[data-handout-poster]') as HTMLElement | null;
    if (!el) throw new Error('handout-poster-missing');
    const runCanvas = (scale: number) =>
      html2canvas(el, {
        scale,
        useCORS: true,
        backgroundColor: '#edf2f7',
        logging: false,
        width: HANDOUT_POSTER_W,
        height: HANDOUT_POSTER_H,
        windowWidth: HANDOUT_POSTER_W,
        windowHeight: HANDOUT_POSTER_H,
      });
    let canvas: HTMLCanvasElement;
    try {
      canvas = await runCanvas(1.2);
    } catch {
      canvas = await runCanvas(1);
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('handout-png-empty'))), 'image/png');
    });
    return blob;
  } finally {
    root.unmount();
    host.remove();
  }
}

async function blobToPngFile(blob: Blob, name: string): Promise<File> {
  return new File([blob], name, { type: 'image/png' });
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
    const title = pickHandoutText(pack.title, lang) || params.topicTitle;
    const file = await blobToPngFile(blob, `tarqatma-${params.topicId}-${lang}.png`);
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
          topic: params.topicTitle,
          title,
          language: lang,
          file,
        }),
      );
    } else {
      saved.push(
        await uploadHandout({
          topic: params.topic,
          file,
          title,
          language: lang,
        }),
      );
    }
  }
  return saved;
}
