import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const httpJson = vi.fn();
vi.mock('../api/httpClient', async (orig) => ({ ...(await orig<object>()), httpJson: (...a: unknown[]) => httpJson(...a) }));
vi.mock('./backendAuth', () => ({ getBackendAccessToken: vi.fn(async () => 'tok') }));
let uid = 'u1';
vi.mock('./localStaffAuth', () => ({ getCurrentLocalUser: () => ({ uid }) }));

import { postActivityEvents } from './analyticsApi';

describe('faollik navbati', () => {
  beforeEach(() => {
    localStorage.clear();
    httpJson.mockReset();
    uid = 'u1';
  });
  afterEach(() => vi.restoreAllMocks());

  it("yuborilmagan vaqt yo'qolmaydi va keyingi muvaffaqiyatda yuboriladi", async () => {
    httpJson.mockRejectedValueOnce(new Error('offline'));
    await postActivityEvents([{ event_type: 'heartbeat', duration_sec: 60 }], 'lectures');
    expect(localStorage.getItem('imentor-activity-queue-v1:u1')).toContain('heartbeat');

    httpJson.mockResolvedValue({ ok: true });
    await postActivityEvents([{ event_type: 'heartbeat', duration_sec: 30 }], 'lectures');
    expect(httpJson).toHaveBeenCalledTimes(3);
    const resent = httpJson.mock.calls[2][1].body;
    expect(resent.events[0].duration_sec).toBe(60);
    expect(resent.events[0].meta.qid).toBeTruthy();
    expect(typeof resent.sent_at_ms).toBe('number');
    expect(localStorage.getItem('imentor-activity-queue-v1:u1')).toBeNull();
  });

  it("bir o'qituvchining navbati boshqasiga yuborilmaydi", async () => {
    httpJson.mockRejectedValueOnce(new Error('offline'));
    await postActivityEvents([{ event_type: 'heartbeat', duration_sec: 60 }], 'tests');
    uid = 'u2';
    httpJson.mockResolvedValue({ ok: true });
    await postActivityEvents([{ event_type: 'heartbeat', duration_sec: 10 }], 'tests');
    expect(httpJson).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('imentor-activity-queue-v1:u1')).toContain('heartbeat');
  });
});
