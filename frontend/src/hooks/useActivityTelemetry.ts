import { useEffect, useRef } from 'react';
import { postActivityEvents } from '../utils/analyticsApi';

const HEARTBEAT_MS = 60_000;

/** Logged-in foydalanuvchi faolligini serverga yuboradi (heartbeat + sahifa). */
export function useActivityTelemetry(enabled: boolean, page: string): void {
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    if (!enabled) return;

    const sendHeartbeat = () => {
      void postActivityEvents([{ event_type: 'heartbeat', duration_sec: 60 }], pageRef.current);
    };

    void postActivityEvents([{ event_type: 'page_view', duration_sec: 0 }], pageRef.current);
    sendHeartbeat();
    const id = window.setInterval(sendHeartbeat, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [enabled, page]);
}
