/**
 * Talabaning javoblari va ishtirokchi kaliti qurilmada saqlanadi (2026-10-09):
 * sahifa yangilansa javoblar o'chib ketardi, yangi oyna esa serverda ikkinchi
 * bo'sh qoralama ochardi.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLocalLiveTestAnswers,
  countAnswered,
  getLiveTestParticipantKey,
  loadLocalLiveTestAnswers,
  saveLocalLiveTestAnswers,
} from './liveTestApi';

describe('jonli test: qurilmadagi javoblar', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('saqlangan javoblar qayta ochilganda tiklanadi', () => {
    saveLocalLiveTestAnswers('lts_1', [1, -1, 3], 'ot_1');
    expect(loadLocalLiveTestAnswers('lts_1', 3, 'ot_1')).toEqual([1, -1, 3]);
    expect(countAnswered([1, -1, 3])).toBe(2);
  });

  it('savollar soni mos kelmasa yoki boshqa talaba bo‘lsa tiklanmaydi', () => {
    saveLocalLiveTestAnswers('lts_1', [1, -1, 3], 'ot_1');
    expect(loadLocalLiveTestAnswers('lts_1', 4, 'ot_1')).toBeNull();
    expect(loadLocalLiveTestAnswers('lts_1', 3, 'ot_2')).toBeNull();
  });

  it('topshirilgach tozalanadi', () => {
    saveLocalLiveTestAnswers('lts_1', [1], 'ot_1');
    clearLocalLiveTestAnswers('lts_1', 'ot_1');
    expect(loadLocalLiveTestAnswers('lts_1', 1, 'ot_1')).toBeNull();
  });

  it('ishtirokchi kaliti yangi oynada ham o‘sha, talabalar orasida esa har xil', () => {
    const first = getLiveTestParticipantKey('lts_1', 'ot_1');
    sessionStorage.clear(); // yangi oyna
    expect(getLiveTestParticipantKey('lts_1', 'ot_1')).toBe(first);
    expect(getLiveTestParticipantKey('lts_1', 'ot_2')).not.toBe(first);
  });
});
