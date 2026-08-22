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
