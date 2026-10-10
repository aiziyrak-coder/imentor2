const LECTURE_BY_TOPIC_KEY = 'imentor-lecture-by-topic-v2';

export function readLectureForTopic(topicNorm: string): string {
  if (!topicNorm) return '';
  try {
    const raw = localStorage.getItem(LECTURE_BY_TOPIC_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return map[topicNorm] ?? '';
  } catch {
    return '';
  }
}

export function writeLectureForTopic(topicNorm: string, content: string): void {
  if (!topicNorm) return;
  try {
    const raw = localStorage.getItem(LECTURE_BY_TOPIC_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[topicNorm] = content;
    localStorage.setItem(LECTURE_BY_TOPIC_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

/**
 * O'qituvchi "Ma'ruza matni"da hozir ochib turgan versiya (shu sessiya
 * davomida, xotirada). Taqdimot shu versiyadan quriladi — ilgari doim eng
 * oxirgisi olinardi, o'qituvchi eski versiyani tanlagan bo'lsa ham.
 */
const activeLectureVersionByNorm = new Map<string, string>();

export function rememberActiveLectureVersion(topicNorm: string, versionId: string | null): void {
  if (!topicNorm) return;
  if (versionId) activeLectureVersionByNorm.set(topicNorm, versionId);
  else activeLectureVersionByNorm.delete(topicNorm);
}

export function activeLectureVersion(topicNorm: string): string | null {
  return topicNorm ? activeLectureVersionByNorm.get(topicNorm) ?? null : null;
}
