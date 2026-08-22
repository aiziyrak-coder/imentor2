import type { SyllabusTopic } from '../services/aiService';
import type { SyllabusTopicContext } from './syllabusTopicContext';
import { listPreparedForTopicSynced, loadPreparedByIdSynced } from './preparedContentStore';

/** Mavzu bo'yicha oxirgi saqlangan ma'ruza matni (test/keys manbasi). */
export async function loadLatestLectureText(
  topic: SyllabusTopic | SyllabusTopicContext | string,
): Promise<string> {
  try {
    const list = await listPreparedForTopicSynced('lecture', topic, { shared: true });
    const first = list[0];
    if (!first?.id) return '';
    const payload = await loadPreparedByIdSynced<{ content?: string } | string>('lecture', first.id);
    if (!payload) return '';
    const text = typeof payload === 'string' ? payload : String(payload.content || '');
    return text.replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}
