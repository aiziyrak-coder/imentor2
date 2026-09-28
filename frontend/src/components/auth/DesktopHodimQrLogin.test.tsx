import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

vi.mock('../../App', () => import('../../test/testContexts'));

const createMock = vi.fn();
const pollMock = vi.fn();

vi.mock('../../utils/devicePairingApi', () => ({
  createDevicePairingSession: () => createMock(),
  pollDevicePairingStatus: (...args: unknown[]) => pollMock(...args),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,QR' } }));
vi.mock('../../utils/backendAuth', () => ({
  syncStaffPhotoFromServer: vi.fn(),
  writeBackendTokensFromPair: vi.fn(),
}));
vi.mock('../../utils/deviceSession', () => ({ markDesktopPairedSession: vi.fn() }));

import DesktopHodimQrLogin from './DesktopHodimQrLogin';
import { renderWithProviders } from '../../test/renderWithProviders';

let n = 0;
function session() {
  n += 1;
  return {
    pairing_token: `token-${n}`,
    desktop_secret: `secret-${n}`,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    qr_payload: `imentor-pair:token-${n}`,
  };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('DesktopHodimQrLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    n = 0;
    createMock.mockImplementation(async () => session());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("muddati tugagan QR tugma bosilmasdan o'zi yangilanadi", async () => {
    pollMock.mockResolvedValue({ status: 'expired' });
    renderWithProviders(<DesktopHodimQrLogin onOtherRoles={() => {}} />);
    await tick(0);
    expect(createMock).toHaveBeenCalledTimes(1);

    await tick(2100);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(pollMock).toHaveBeenLastCalledWith('token-1', 'secret-1');
    expect(screen.queryByText(/muddati tugagan/)).toBeNull();
  });

  it("oyna ochiq qolib ketsa cheksiz yangilanmaydi — xabar chiqadi", async () => {
    pollMock.mockResolvedValue({ status: 'expired' });
    renderWithProviders(<DesktopHodimQrLogin onOtherRoles={() => {}} />);
    await tick(0);
    for (let i = 0; i < 10; i += 1) await tick(2100);

    // 1 ta boshlang'ich + 6 ta avtomatik yangilash.
    expect(createMock).toHaveBeenCalledTimes(7);
    expect(screen.getByText(/muddati tugagan/)).toBeInTheDocument();
  });
});
