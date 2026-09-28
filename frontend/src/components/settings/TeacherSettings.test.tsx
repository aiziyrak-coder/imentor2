import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../UserProfile', () => ({ default: () => <div data-testid="user-profile" /> }));
vi.mock('../staff/StaffTeachingSubjectsPicker', () => ({ default: () => <div data-testid="picker" /> }));
vi.mock('../staff/OwnSubjectUpload', () => ({
  default: () => <div data-testid="own-upload" />,
  OWN_SUBJECT_TEMPLATE_URL: '/namuna-fan-mavzulari.xlsx',
}));
vi.mock('../../utils/staffSelfApi', () => ({
  errorText: (_e: unknown, f: string) => f,
  fetchMyProfile: vi.fn().mockResolvedValue({
    login: '3442112018', first_name: 'Farog‘at', last_name: 'Melibayeva', job_title: 'assistent',
    faculty: '', department_id: 2, department: 'Biotibbiyot', face_linked: false, pinfl_linked: true,
  }),
  fetchDepartments: vi.fn().mockResolvedValue([{ id: 2, name: 'Biotibbiyot' }]),
  fetchLibrary: vi.fn().mockResolvedValue({ department: 'Biotibbiyot', items: [] }),
  saveMyProfile: vi.fn(),
  uploadLibraryItem: vi.fn(),
  deleteLibraryItem: vi.fn(),
}));

import TeacherSettings from './TeacherSettings';

describe('TeacherSettings', () => {
  it('shows every section with a how-to and sample files where needed', async () => {
    const user = userEvent.setup();
    render(<TeacherSettings />);
    expect(await screen.findByDisplayValue('Melibayeva')).toBeInTheDocument();
    expect(screen.getAllByText('Qanday qilinadi').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: /Fanlarim/ }));
    expect(screen.getByRole('link', { name: /Namuna fayl/ })).toHaveAttribute('href', '/namuna-fan-mavzulari.xlsx');

    // Monitor jadvalini admin yuritadi — o'qituvchi sozlamalarida yo'q.
    expect(screen.queryByRole('tab', { name: /Monitor jadvali/ })).toBeNull();

    await user.click(screen.getByRole('tab', { name: /Kafedra kutubxonasi/ }));
    expect(await screen.findByText(/Protokol darslikdan ustun turadi/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Kirish va xavfsizlik/ }));
    expect(await screen.findByRole('link', { name: /cam.fermi.uz/ })).toBeInTheDocument();
  });
});
