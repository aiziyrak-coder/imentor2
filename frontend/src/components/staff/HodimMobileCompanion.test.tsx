import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../App', () => import('../../test/testContexts'));

const confirmMock = vi.fn();
let onDecoded: ((text: string) => void) | null = null;

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    isScanning = false;
    async start(_camera: unknown, _cfg: unknown, success: (text: string) => void) {
      this.isScanning = true;
      onDecoded = success;
    }
    async stop() {
      this.isScanning = false;
    }
    async clear() {}
  },
}));
vi.mock('../../utils/devicePairingApi', async () => {
  const actual = await vi.importActual<typeof import('../../utils/devicePairingApi')>(
    '../../utils/devicePairingApi',
  );
  return { ...actual, confirmDevicePairing: (...args: unknown[]) => confirmMock(...args) };
});
vi.mock('../../utils/localStaffAuth', () => ({
  getCurrentLocalUser: () => ({ uid: 'u1', phoneDigits: '998901112233', displayName: 'Test' }),
  logoutLocalStaff: vi.fn(),
}));
vi.mock('../../hooks/useStaffLocationTracking', () => ({ useStaffLocationTracking: vi.fn() }));
vi.mock('./HodimGpsStatusBar', () => ({ default: () => null }));

import { HttpError } from '../../api/httpClient';
import HodimMobileCompanion from './HodimMobileCompanion';
import { renderWithProviders } from '../../test/renderWithProviders';

async function scan(text: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'QR kodni skanerlash' }));
  await waitFor(() => expect(onDecoded).not.toBeNull());
  onDecoded?.(text);
}

describe('HodimMobileCompanion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onDecoded = null;
  });

  it('eskirgan QR uchun "kamera" emas, "yangi QR kodni skanerlang" deydi', async () => {
    confirmMock.mockRejectedValue(new HttpError('QR kod muddati tugagan', 400, {}));
    renderWithProviders(<HodimMobileCompanion />);
    await scan('imentor-pair:abcdefghijklmnop');

    expect(await screen.findByText(/Kompyuter ekranidagi yangi QR kodni skanerlang/)).toBeInTheDocument();
    expect(screen.queryByText(/Kamera ochilmadi/)).toBeNull();
  });

  it('bir kod bir necha marta o\'qilsa ham bitta so\'rov yuboradi', async () => {
    let resolve: () => void = () => {};
    confirmMock.mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
    renderWithProviders(<HodimMobileCompanion />);
    await scan('imentor-pair:abcdefghijklmnop');
    onDecoded?.('imentor-pair:abcdefghijklmnop');
    onDecoded?.('imentor-pair:abcdefghijklmnop');
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    resolve();

    expect(await screen.findByText('Kompyuter ulandi')).toBeInTheDocument();
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
