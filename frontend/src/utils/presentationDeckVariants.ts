import type { AppLanguage } from '../i18n/language';
import { HttpError } from '../api/httpClient';
import { requestTranslation, translatedView, type I18nPayload } from '../i18n/useTranslatedPayload';
import { buildPresentationPptxFile, type PresentationDeck } from './buildPresentationPptx';
import { uploadPresentation, type TopicPresentationItem } from './presentationUploadApi';
import type { SyllabusTopicContext } from './syllabusTopicContext';

/**
 * AI yaratgan taqdimotning har tildagi nusxasi.
 *
 * AI taqdimot ikki qismdan iborat: Bazadagi deck (slayd matnlari, JSON) va
 * undan qurilgan PPTX fayl. Fayl nomidagi belgi ularni bog'laydi:
 *   `Mavzu--pc12-ru.pptx`  →  Baza yozuvi #12, rus tilidagi nusxa.
 * Eski fayllarda til qo'shimchasi yo'q (`--pc12.pptx`) — ular deckning asosiy
 * tilida.
 *
 * Interfeys tilidagi nusxa bo'lmasa: server deck matnini o'giradi (odatda
 * fonda allaqachon o'girib qo'ygan), brauzer undan PPTX quradi va yuklaydi.
 * O'qituvchi boshqa tildagi slaydlarni hech qachon ko'rmaydi.
 */

const DECK_MARKER_RE = /--pc(\d+)(?:-(uz|ru|en))?\.[a-z0-9]+$/i;

export type DeckMarker = { pcId: string; lang: AppLanguage | null };

export function parseDeckMarker(fileName: string): DeckMarker | null {
  const m = DECK_MARKER_RE.exec(fileName || '');
  if (!m) return null;
  return { pcId: m[1], lang: (m[2]?.toLowerCase() as AppLanguage | undefined) ?? null };
}

/** Fayl nomiga bog'lanish belgisini qo'shadi (kengaytmasi saqlanadi). */
export function withDeckMarker(file: File, marker: string): File {
  const dot = file.name.lastIndexOf('.');
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot > 0 ? file.name.slice(dot) : '';
  return new File([file], `${base.slice(0, 120)}${marker}${ext}`, { type: file.type });
}

export function deckMarker(pcId: string, lang: AppLanguage): string {
  return `--pc${pcId}-${lang}`;
}

/** Deck yozuvining asosiy tili (server aytgandan keyin ma'lum bo'ladi). */
const primaryByDeck = new Map<string, AppLanguage>();

export function knownDeckPrimary(pcId: string): AppLanguage | null {
  return primaryByDeck.get(pcId) ?? null;
}

export function rememberDeckPrimary(pcId: string, lang: AppLanguage): void {
  primaryByDeck.set(pcId, lang);
}

/** Fayl qaysi tilda: belgidagi til, bo'lmasa deckning asosiy tili. */
export function presentationItemLanguage(item: TopicPresentationItem): AppLanguage | null {
  const marker = parseDeckMarker(item.file_name);
  if (!marker) return null;
  return marker.lang ?? knownDeckPrimary(marker.pcId);
}

type DeckPayload = PresentationDeck & I18nPayload;

const jobs = new Map<string, Promise<void>>();

/**
 * `lang` tilidagi nusxani tayyorlaydi. Bir xil (deck, til) uchun bir vaqtda
 * bitta ish. Tugagach chaqiruvchi ro'yxatni qayta yuklaydi.
 *
 * `hasUnmarkedFile` — eski (tilsiz) fayl bor: deckning asosiy tili `lang`
 * bo'lsa, yangi fayl qurilmaydi — o'sha fayl shu tildagi nusxa.
 */
export function ensureDeckVariant(params: {
  pcId: string;
  lang: AppLanguage;
  context: SyllabusTopicContext;
  hasUnmarkedFile: boolean;
}): Promise<void> {
  const key = `${params.pcId}:${params.lang}`;
  let job = jobs.get(key);
  if (!job) {
    job = buildVariant(params).finally(() => jobs.delete(key));
    jobs.set(key, job);
  }
  return job;
}

async function buildVariant({
  pcId,
  lang,
  context,
  hasUnmarkedFile,
}: {
  pcId: string;
  lang: AppLanguage;
  context: SyllabusTopicContext;
  hasUnmarkedFile: boolean;
}): Promise<void> {
  let payload: DeckPayload;
  try {
    payload = await requestTranslation<DeckPayload>(pcId, lang);
  } catch (err) {
    // Bazadagi deck o'chirilgan — eski faylni tarjima qilib bo'lmaydi, lekin
    // o'qituvchining faylini yashirib ham bo'lmaydi: u o'zgarishsiz ko'rsatiladi.
    if (err instanceof HttpError && err.status === 404 && hasUnmarkedFile) {
      rememberDeckPrimary(pcId, lang);
      return;
    }
    throw err;
  }
  if (payload.primaryLanguage) rememberDeckPrimary(pcId, payload.primaryLanguage);
  if (payload.primaryLanguage === lang && hasUnmarkedFile) return;
  const view = translatedView(payload, lang);
  if (!view?.slides?.length) throw new Error('deck-translation-missing');
  const built = await buildPresentationPptxFile(view, {
    meta: {
      subjectName: context.subjectName,
      topicId: context.id,
      variantLabel: context.variantLabel,
      language: lang,
    },
  });
  if (!built.size) throw new Error('empty-pptx');
  const shortTopic =
    [context.id, context.title].filter(Boolean).join(' — ').slice(0, 240) || context.title;
  await uploadPresentation({
    topic: shortTopic,
    file: withDeckMarker(built, deckMarker(pcId, lang)),
    title: (view.presentation_title || shortTopic).slice(0, 240),
    context,
  });
}
