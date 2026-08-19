import {
  isTopicContextComplete,
  topicNormForStorage,
  topicNormLookupKeys,
  type SyllabusTopicContext,
} from './syllabusTopicContext';
import { normTopicKey } from './preparedContentStore';

export function resolvePresentationTopicNorms(
  topic: string | SyllabusTopicContext,
): string[] {
  if (typeof topic === 'string') {
    const k = normTopicKey(topic);
    return k.includes('::') ? [k] : [];
  }
  if (isTopicContextComplete(topic)) {
    return topicNormLookupKeys(topic);
  }
  return [];
}

export function primaryPresentationTopicNorm(
  topic: string | SyllabusTopicContext,
): string {
  if (typeof topic !== 'string' && isTopicContextComplete(topic)) {
    try {
      return topicNormForStorage(topic);
    } catch {
      /* fall through */
    }
  }
  const norms = resolvePresentationTopicNorms(topic);
  return norms[0] || '';
}

export async function extractPdfTextFromBlob(blob: Blob): Promise<string> {
  const { pdfjsLib } = await import('./pdfjsSetup');
  const buffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    parts.push(
      content.items.map((it) => ('str' in it ? String(it.str) : '')).join(' '),
    );
  }
  return parts.join('\n').trim();
}
