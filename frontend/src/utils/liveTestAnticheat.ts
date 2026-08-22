import { postLiveTestAnticheatEvents } from './analyticsApi';

export type AnticheatEvent = {
  event_type: string;
  question_index?: number;
  option_index?: number;
  client_ts_ms?: number;
};

const buffers = new Map<string, AnticheatEvent[]>();

function key(sessionKey: string) {
  return sessionKey.trim();
}

export function pushLiveTestEvent(sessionKey: string, ev: AnticheatEvent): void {
  const k = key(sessionKey);
  if (!k) return;
  const list = buffers.get(k) || [];
  list.push({ ...ev, client_ts_ms: ev.client_ts_ms ?? Date.now() });
  if (list.length > 300) list.splice(0, list.length - 300);
  buffers.set(k, list);
}

export async function flushLiveTestEvents(sessionKey: string, participantKey: string): Promise<void> {
  const k = key(sessionKey);
  const list = buffers.get(k) || [];
  if (!list.length) return;
  buffers.set(k, []);
  await postLiveTestAnticheatEvents(k, participantKey, list);
}

export function bindLiveTestVisibilityTracking(sessionKey: string): () => void {
  const onVis = () => {
    pushLiveTestEvent(sessionKey, {
      event_type: document.hidden ? 'visibility_hidden' : 'visibility_visible',
    });
  };
  const onBlur = () => pushLiveTestEvent(sessionKey, { event_type: 'tab_blur' });
  const onFocus = () => pushLiveTestEvent(sessionKey, { event_type: 'tab_focus' });
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };
}
