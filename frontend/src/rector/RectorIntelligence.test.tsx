import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RectorIntelligence from './RectorIntelligence';
import * as api from './intelligenceApi';
import { reportFixture } from './intelligenceFixtures.test-helper';
vi.mock('./intelligenceApi', async () => ({
  ...(await vi.importActual('./intelligenceApi')),
  fetchIntelligence: vi.fn(),
  analyzeIntelligence: vi.fn(),
  downloadIntelligenceCsv: vi.fn(),
}));
vi.mock('./intelligencePdf', () => ({ downloadIntelligencePdf: vi.fn() }));
const props = { filters: { from: '2026-09-01', to: '2026-09-14' }, onUnauthorized: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(api.fetchIntelligence).mockResolvedValue(reportFixture);
});
afterEach(cleanup);
describe('intelligence filters and stale responses', () => {
  it('combines board availability with color filters', async () => {
    render(<RectorIntelligence {...props} />);
    await screen.findAllByText('Rahimov Ali-1');
    fireEvent.change(screen.getByLabelText('Interaktiv doska'), {
      target: { value: 'unavailable' },
    });
    await waitFor(() =>
      expect(api.fetchIntelligence).toHaveBeenLastCalledWith(
        expect.objectContaining({ board: 'unavailable' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Qizil ro‘yxat' }));
    await waitFor(() =>
      expect(api.fetchIntelligence).toHaveBeenLastCalledWith(
        expect.objectContaining({ board: 'unavailable', status: 'red' }),
      ),
    );
  });
  it('filters by color and criterion and sorts directly from table headers', async () => {
    render(<RectorIntelligence {...props} />);
    await screen.findAllByText('Rahimov Ali-1');
    fireEvent.click(screen.getByRole('button', { name: 'Qizil ro‘yxat' }));
    await waitFor(() =>
      expect(api.fetchIntelligence).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'red', criterion: 'usage' }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Baholash mezoni'), { target: { value: 'materials' } });
    await waitFor(() =>
      expect(api.fetchIntelligence).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'all', criterion: 'materials' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Familiya, ism / kafedra ↑' }));
    await waitFor(() =>
      expect(api.fetchIntelligence).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'name_desc' }),
      ),
    );
  });
  it('keeps an in-progress AI result when automatic refresh fires', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    let finish!: (value: api.IntelligenceAnalysis) => void;
    vi.mocked(api.analyzeIntelligence).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<RectorIntelligence {...props} />);
    await screen.findAllByText('Rahimov Ali-1');
    fireEvent.click(screen.getByRole('button', { name: 'AI tahlilini tayyorlash' }));
    view.rerender(<RectorIntelligence {...props} filters={{ ...props.filters, refreshKey: 1 }} />);
    expect(api.fetchIntelligence).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish({
        summary: 'Tayyor tahlil',
        analyzed_count: 2,
        matched_count: 2,
        from: reportFixture.from,
        to: reportFixture.to,
        generated_at: reportFixture.generated_at,
        owner_keys: ['1', '2'],
        priorities: [],
      }),
    );
    expect(screen.getByText('Tayyor tahlil')).toBeInTheDocument();
  });
  it('combines selected criteria and submits exact search mode', async () => {
    render(<RectorIntelligence {...props} />);
    await screen.findAllByText('Rahimov Ali-1');
    fireEvent.click(screen.getByRole('button', { name: 'Dars yo‘q' }));
    fireEvent.click(screen.getByRole('button', { name: 'Material yo‘q' }));
    await waitFor(() =>
      expect(api.fetchIntelligence).toHaveBeenLastCalledWith(
        expect.objectContaining({ focus: 'no_lessons,no_materials' }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Qidirish usuli'), { target: { value: 'exact' } });
    await waitFor(() =>
      expect(api.fetchIntelligence).toHaveBeenLastCalledWith(
        expect.objectContaining({ match_mode: 'exact' }),
      ),
    );
  });
  it('debounces surname search', async () => {
    render(<RectorIntelligence {...props} />);
    await screen.findAllByText('Rahimov Ali-1');
    fireEvent.change(screen.getByLabelText('Familiya, ism yoki login'), {
      target: { value: 'Раҳимов' },
    });
    await waitFor(() =>
      expect(api.fetchIntelligence).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'Раҳимов' }),
      ),
    );
  });
  it('does not let an old request replace the new filter result', async () => {
    let resolveOld!: (r: typeof reportFixture) => void;
    vi.mocked(api.fetchIntelligence).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOld = r;
        }),
    );
    render(<RectorIntelligence {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dars yo‘q' }));
    await screen.findAllByText('Rahimov Ali-1');
    await act(async () => resolveOld({ ...reportFixture, rows: [], count: 0 }));
    expect(screen.getAllByText('Rahimov Ali-1')[0]).toBeInTheDocument();
  });
  it('explains empty results rather than inventing zero performance', async () => {
    vi.mocked(api.fetchIntelligence).mockResolvedValue({ ...reportFixture, rows: [], count: 0 });
    render(<RectorIntelligence {...props} />);
    await screen.findByText('Bu shartlarga mos o‘qituvchi topilmadi');
    expect(screen.getByRole('button', { name: 'AI tahlilini tayyorlash' })).toBeDisabled();
  });
});
