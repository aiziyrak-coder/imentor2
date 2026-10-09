/**
 * Sinf monitori: jonli sessiya ochiq paytda to'g'ri javoblar ekranda ko'rinmasin (2026-10-09).
 *
 * Monitorda QR ko'rsatilib turgan, uning ostida esa savollar to'g'ri javob
 * belgisi va tahlili bilan ochiq turgan holat rasmga tushdi — talabalar
 * telefonda yechayotgan testning kaliti butun sinfga ko'rinardi.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { createContext } from 'react';

vi.mock('../App', async () => {
  const base = await import('../test/testContexts');
  return { ...base, AppNavigationContext: createContext({ openSyllabus: () => {} }) };
});

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAAA') } }));

const PAYLOAD = {
  topic: 'Sinaptik uzatish',
  primaryLanguage: 'uz',
  questions: [
    {
      question: 'Xotira asosi qaysi jarayon?',
      options: ['Retseptor kamayishi', 'Uzoq muddatli potensiallanish', 'Ferment faolligi', 'Tikan yo‘qolishi'],
      correctOptionIndex: 1,
      explanation: 'MAXFIY_TAHLIL matni',
      optionExplanations: ['izoh-a', 'MAXFIY_IZOH', 'izoh-c', 'izoh-d'],
    },
  ],
};

vi.mock('../utils/preparedContentStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/preparedContentStore')>();
  return {
    ...actual,
    listPreparedForTopicSynced: vi.fn(async () => [
      { id: 'cloud_1', topic: 'Sinaptik uzatish', createdAt: Date.now(), source: 'cloud', author: 'Sinov' },
    ]),
    loadPreparedByIdSynced: vi.fn(async () => PAYLOAD),
  };
});

const finalizeMock = vi.fn();
vi.mock('../utils/liveTestApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/liveTestApi')>();
  return {
    ...actual,
    createLiveTestSessionOnServer: vi.fn(async () => 'lts_test'),
    syncLiveTestSessionToServer: vi.fn(async () => true),
    fetchLiveTestSessionFromServer: vi.fn(async () => ({ isClosed: false, closedAtMs: null, questions: [], topic: '' })),
    fetchLiveTestSubmissionsFromServer: vi.fn(async () => []),
    finalizeLiveTestSessionOnServer: (...args: unknown[]) => finalizeMock(...args),
  };
});

vi.mock('../utils/localStaffAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/localStaffAuth')>();
  return { ...actual, getCurrentLocalUser: () => ({ uid: 't1', role: 'hodim', displayName: 'Sinov' }) };
});

import TestQuestions from './TestQuestions';
import { AppLanguageContext, GlobalTopicContext } from '../test/testContexts';

const TOPIC = {
  id: 'M2', title: 'Sinaptik uzatish', type: 'lecture' as const, syllabusId: 1, subjectName: 'Normal fiziologiya',
  subjectCode: 'FIZ-01', variantLabel: 'asosiy', instructionLanguage: 'uz' as const, departmentName: '',
};

function renderTeacher() {
  return render(
    <AppLanguageContext.Provider value={{ language: 'uz', setLanguage: () => {} }}>
      <GlobalTopicContext.Provider value={TOPIC}>
        <TestQuestions />
      </GlobalTopicContext.Provider>
    </AppLanguageContext.Provider>,
  );
}

async function openSavedVersion() {
  fireEvent.click(await screen.findByRole('button', { name: /Baza/ }));
  const items = await screen.findAllByText('Sinaptik uzatish');
  fireEvent.click(items[items.length - 1]);
  await screen.findByText(/Xotira asosi qaysi jarayon/);
}

describe('TestQuestions — o‘qituvchi ekrani, jonli sessiya', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/?view=tests');
    finalizeMock.mockResolvedValue({ isClosed: true, closedAtMs: Date.now(), submissions: [] });
  });

  it('sessiyasiz saqlangan test ochilganda bo‘sh jadval emas, savollar tahlili bilan chiqadi', async () => {
    renderTeacher();
    await openSavedVersion();
    expect(screen.getByText('MAXFIY_TAHLIL matni')).toBeInTheDocument();
    expect(screen.queryByText(/Hali hech kim yubormadi/)).not.toBeInTheDocument();
  });

  it('sessiya ochiq paytda to‘g‘ri javob, izoh va tahlil ekranda yashirin; yakunlangach ochiladi', async () => {
    renderTeacher();
    await openSavedVersion();
    fireEvent.click(screen.getByRole('button', { name: /Jonli sessiyani boshlash/ }));
    // Sessiya boshlangach natijalar jadvali — savollarga o'tamiz.
    fireEvent.click(await screen.findByRole('button', { name: /Javoblarni tahlil qilish/ }));

    expect(await screen.findByText(/ekranda to'g'ri javoblar va tahlil yashirilgan/)).toBeInTheDocument();
    expect(screen.getByText(/Xotira asosi qaysi jarayon/)).toBeInTheDocument();
    expect(screen.queryByText('MAXFIY_TAHLIL matni')).not.toBeInTheDocument();
    expect(screen.queryByText('MAXFIY_IZOH')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Testni yakunlash/ }));
    await waitFor(() => expect(screen.getByText('MAXFIY_TAHLIL matni')).toBeInTheDocument());
    expect(screen.queryByText(/ekranda to'g'ri javoblar va tahlil yashirilgan/)).not.toBeInTheDocument();
  });

  it('o‘qituvchi tasdiqlasa javoblarni sessiya paytida ham ko‘rsata oladi', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderTeacher();
    await openSavedVersion();
    fireEvent.click(screen.getByRole('button', { name: /Jonli sessiyani boshlash/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Javoblarni tahlil qilish/ }));
    fireEvent.click(await screen.findByRole('button', { name: /To'g'ri javoblarni ko'rsatish/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText('MAXFIY_TAHLIL matni')).toBeInTheDocument();
    expect(screen.getByText(/to'g'ri javoblar ekranda ko'rinib turibdi/)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
