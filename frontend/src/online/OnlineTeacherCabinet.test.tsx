/**
 * Bitta fani bor o'qituvchi o'z fanining ichiga QAMALIB qolmasligi kerak
 * (2026-09-29). Dastur uni avtomatik ochadi, shuning uchun "Fanlar" tugmasi
 * yagona chiqish yo'li — u orqali "Fanlarim" ro'yxatiga va "Fan qo'shish"
 * tugmasiga, ya'ni boshqa yo'nalishlarga yetib boradi.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OnlineTeacherCabinet from './OnlineTeacherCabinet';

const ONE_COURSE = {
  is_online_teacher: true,
  full_name: 'Tursinoy Qaxorova',
  courses: [
    {
      syllabus_id: 12,
      subject_name: 'Maxsus pedagogika (Tibbiy pedagogika)',
      subject_code: 'malaka-tibbiy-pedagogika',
      department_name: 'Malaka oshirish va qayta tayyorlash',
      variant_label: '',
      topic_count: 18,
      instruction_language: 'uz',
      program: 'malaka',
    },
  ],
};

vi.mock('./onlineTeacherApi', async (orig) => ({
  ...(await orig<typeof import('./onlineTeacherApi')>()),
  fetchTeacherMe: vi.fn(async () => ONE_COURSE),
  fetchTeacherTopics: vi.fn(async () => []),
  fetchCatalog: vi.fn(async () => [
    {
      syllabus_id: 12,
      subject_name: 'Maxsus pedagogika (Tibbiy pedagogika)',
      department_name: 'Malaka oshirish va qayta tayyorlash',
      variants: [{ label: '', topic_count: 18, mine: true }],
    },
    {
      syllabus_id: 13,
      subject_name: 'Klinik ultratovush diagnostikasi',
      department_name: 'Malaka oshirish va qayta tayyorlash',
      variants: [{ label: '', topic_count: 0, mine: false }],
    },
  ]),
}));

describe('OnlineTeacherCabinet', () => {
  it('lets a teacher with a single course reach the other directions', async () => {
    render(<OnlineTeacherCabinet onUnauthorized={vi.fn()} program="malaka" />);

    // Yagona fan avtomatik ochiladi.
    await screen.findByRole('heading', { name: 'Maxsus pedagogika (Tibbiy pedagogika)' });

    // Ortga qaytish tugmasi ishlashi SHART — ilgari u o'chirilgan edi.
    const back = screen.getByRole('button', { name: /Fanlar/ });
    expect(back).not.toBeDisabled();
    fireEvent.click(back);

    // "Fanlarim" ro'yxati va u yerdan boshqa yo'nalishlarga o'tish.
    await screen.findByRole('heading', { name: 'Fanlarim' });
    fireEvent.click(screen.getByRole('button', { name: /Fan qo/ }));

    await waitFor(() =>
      expect(screen.getByText('Klinik ultratovush diagnostikasi')).toBeInTheDocument(),
    );
  });
});
