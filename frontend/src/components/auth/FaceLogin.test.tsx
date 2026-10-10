import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../App', () => import('../../test/testContexts'));

const faceLoginMock = vi.fn();
const syncMock = vi.fn();

vi.mock('../../utils/backendAuth', async () => {
  class FaceLoginError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(`face-login-${status}`);
      this.status = status;
      this.detail = detail;
    }
  }
  return {
    FaceLoginError,
    loginWithFaceFrames: (...args: unknown[]) => faceLoginMock(...args),
    syncSessionRoleFromServer: () => syncMock(),
  };
});

import FaceLogin from './FaceLogin';
import { FaceLoginError } from '../../utils/backendAuth';
import { renderWithProviders } from '../../test/renderWithProviders';

const stopTrack = vi.fn();

function mockCamera(ok: boolean) {
  const getUserMedia = ok
    ? vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] })
    : vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
}

beforeEach(() => {
  vi.clearAllMocks();
  syncMock.mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FaceLogin', () => {
  it('kameraga ruxsat bo\'lmasa tushuntiradi va parol bilan kirishga o\'tkazadi', async () => {
    mockCamera(false);
    const onUsePassword = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<FaceLogin onUsePassword={onUsePassword} />);
    expect(await screen.findByText(/Kameraga ruxsat berilmadi/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /JSHSHIR yoki pasport bilan kirish/ }));
    expect(onUsePassword).toHaveBeenCalled();
    expect(faceLoginMock).not.toHaveBeenCalled();
  });

  it('ikki kadr yuboradi va tanilsa kiradi', async () => {
    mockCamera(true);
    faceLoginMock.mockResolvedValue({ uid: 'u1' });
    renderWithProviders(<FaceLogin onUsePassword={() => {}} />);
    await waitFor(() => expect(faceLoginMock).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect((faceLoginMock.mock.calls[0][0] as Blob[]).length).toBe(2);
    await waitFor(() => expect(syncMock).toHaveBeenCalled());
    expect(stopTrack).toHaveBeenCalled();
  });

  it('yuz bog\'lanmagan bo\'lsa qayta-qayta urinmaydi va server matnini ko\'rsatadi', async () => {
    mockCamera(true);
    faceLoginMock.mockRejectedValue(
      new FaceLoginError(404, "Yuzingiz tanildi, lekin iMentor hisobingizga hali bog'lanmagan."),
    );
    renderWithProviders(<FaceLogin onUsePassword={() => {}} />);
    expect(await screen.findByText(/hali bog'lanmagan/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Qayta urinish/ })).toBeInTheDocument();
    expect(faceLoginMock).toHaveBeenCalledTimes(1);
  });
});
