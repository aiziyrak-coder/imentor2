import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/httpClient', () => ({ httpJson: vi.fn() }));
vi.mock('./backendAuth', () => ({ getBackendAccessToken: vi.fn(async () => 'test-token') }));
import { httpJson } from '../api/httpClient';
import { cacheSyllabusRows, getCachedSyllabusRow, clearSyllabusRowCache } from './syllabusRowCache';
import { requestSyllabusTranslation, localizedTopicTitle } from './syllabusI18n';
import type { CourseSyllabusRow } from './syllabusApi';
it('updates the shared topic cache even after the subject page has been left', async () => {
  clearSyllabusRowCache();
  cacheSyllabusRows([{ id: 987654, instruction_language: 'uz', subject_name: 'Fizika' } as CourseSyllabusRow]);
  vi.mocked(httpJson).mockResolvedValue({ name_i18n: { ru: 'Физика' }, topics_i18n: { ru: { 'Energiya': 'Энергия' } } });
  expect(await requestSyllabusTranslation(987654, 'ru')).toBe(true);
  expect(localizedTopicTitle(getCachedSyllabusRow(987654), 'Energiya', 'ru')).toBe('Энергия');
  await requestSyllabusTranslation(987654, 'ru');
  expect(httpJson).toHaveBeenCalledTimes(1);
});
