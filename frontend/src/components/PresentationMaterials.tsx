import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { buildPreparedContentMeta } from '../utils/preparedContentMeta';
import { pushAppNotification } from '../utils/notifications';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Presentation,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GlobalTopicContext, AppNavigationContext, AppLanguageContext } from '../App';
import { useUiText } from '../i18n/useUiText';
import { aiService, type LectureNote } from '../services/aiService';
import { buildPresentationPptxFile } from '../utils/buildPresentationPptx';
import { extractPdfTextFromBlob } from '../utils/presentationTopicNorm';
import PdfSlideViewer from './PdfSlideViewer';
import { apiErrorMessage } from '../utils/apiErrorMessage';
import { outputLanguageLooksWrong } from '../utils/outputLanguage';
import { isTopicContextComplete, topicContextKey } from '../utils/syllabusTopicContext';
import {
  loadLatestPreparedContent,
  savePreparedContent,
  preparedContentNumericId,
} from '../utils/preparedContentStore';
import {
  deletePresentation,
  fetchPresentationsForTopic,
  getPresentationFileBlobUrl,
  getPresentationPreviewBlobUrl,
  isAllowedPresentationFile,
  uploadPresentation,
  type TopicPresentationItem,
} from '../utils/presentationUploadApi';
import StaffPageLayout from './staff/StaffPageLayout';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import StaffTopicHeader from './staff/StaffTopicHeader';
import StaffEmptyState from './staff/StaffEmptyState';
import StaffErrorAlert from './staff/StaffErrorAlert';
import StaffPanel from './staff/StaffPanel';
import { staffBtnGhost, staffBtnPrimary, staffBtnSecondary } from './staff/staffUi';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Prepared_content yozuvi bilan serverdagi PPTX faylni bog'lovchi belgi.
 */
function deckFileMarker(preparedId: string): string | null {
  const numeric = preparedContentNumericId(preparedId);
  return numeric ? `--pc${numeric}` : null;
}

/** Fayl nomiga bog'lanish belgisini qo'shadi (kengaytmasi saqlanadi). */
function withDeckMarker(file: File, marker: string): File {
  const dot = file.name.lastIndexOf('.');
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot > 0 ? file.name.slice(dot) : '';
  return new File([file], `${base.slice(0, 120)}${marker}${ext}`, { type: file.type });
}

function kindLabel(kind: TopicPresentationItem['kind']): string {
  if (kind === 'pdf') return 'PDF';
  if (kind === 'pptx') return 'PPTX';
  return 'PPT';
}

function PresentationPreview({ item, mode }: { item: TopicPresentationItem; mode: 'thumb' | 'full' }) {
  const iconSize = mode === 'full' ? 56 : 40;
  const colors =
    item.kind === 'pdf'
      ? 'text-rose-700/80 bg-rose-50/80'
      : item.kind === 'pptx'
        ? 'text-orange-700/80 bg-orange-50/80'
        : 'text-amber-700/80 bg-amber-50/80';

  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${colors}`}>
      {item.kind === 'pdf' ? <FileText size={iconSize} /> : <Presentation size={iconSize} />}
      <span className="text-[11px] font-bold uppercase tracking-wide">{kindLabel(item.kind)}</span>
    </div>
  );
}

type LightboxProps = {
  items: TopicPresentationItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
};

function PresentationLightbox({ items, index, onClose, onIndexChange }: LightboxProps) {
  const { t } = useUiText();
  const item = items[index];
  const [downloadUrl, setDownloadUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [fileReady, setFileReady] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setDownloadUrl('');
    setPreviewUrl('');
    setFileReady(false);
    setPreviewError(false);
    (async () => {
      try {
        const fileBlob = await getPresentationFileBlobUrl(item.id);
        if (cancelled) return;
        setDownloadUrl(fileBlob);

        if (item.kind === 'pdf') {
          setPreviewUrl(fileBlob);
        } else {
          // PPTX/PPT → server LibreOffice PDF (shu taqdimotning o‘zi)
          try {
            const pdfBlob = await getPresentationPreviewBlobUrl(item.id);
            if (!cancelled) setPreviewUrl(pdfBlob);
          } catch {
            if (!cancelled) setPreviewError(true);
          }
        }
      } catch {
        if (!cancelled) setPreviewError(true);
      } finally {
        if (!cancelled) setFileReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // ←/→ endi slaydlarni almashtiradi (PdfSlideViewer ichida) — bu yerda
      // ular boshqa TAQDIMOTGA o'tkazsa, dars paytida bir tugma ikki ishni
      // bajarib chalkashlik tug'dirardi. Taqdimotlar orasida o'tish uchun
      // chap/o'ng chetdagi katta tugmalar qoldi.
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Faqat Escape kuzatiladi — slayd almashganda listener qayta ro'yxatdan
    // o'tishi shart emas (avval `index` ham deps'da turardi).
  }, [onClose]);

  // Hooks'dan KEYIN — erta return hook tartibini buzardi (React "rendered
  // fewer hooks than expected" xatosi).
  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/92" role="dialog" aria-modal="true">
      <header className="flex items-center justify-between px-4 py-3 text-white shrink-0 gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold truncate">{item.title || item.file_name}</p>
          <p className="text-[12px] text-white/60 truncate">
            {index + 1} / {items.length}
            {' · '}
            {kindLabel(item.kind)} · {item.author_name}
          </p>
        </div>
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={item.file_name}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-[13px] font-semibold shrink-0"
          >
            <Download size={16} /> {t('common.download')}
          </a>
        )}
        <button type="button" onClick={onClose} className="p-2 rounded-xl bg-white/10 hover:bg-white/20 shrink-0">
          <X size={22} />
        </button>
      </header>

      <div className="flex-1 relative flex items-center justify-center min-h-0 px-2 pb-2">
        {hasPrev && (
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            className="absolute left-2 z-10 p-3 rounded-full bg-white/15 hover:bg-white/25 text-white"
          >
            <ChevronLeft size={28} />
          </button>
        )}

        <div className="w-full h-full max-w-6xl flex items-center justify-center">
          {!fileReady ? (
            <div className="text-center text-white space-y-3">
              <Loader2 className="animate-spin mx-auto" size={40} />
              {item.kind !== 'pdf' ? (
                <p className="text-[13px] text-white/70">{t('presentation.openingPptx')}</p>
              ) : null}
            </div>
          ) : previewUrl ? (
            // Brauzerning o'z ichki PDF paneli o'rniga — dars o'tishga moslashtirilgan
            // slayd ko'ruvchi: katta oldinga/orqaga tugmalari, zoom (+/-) va to'liq ekran.
            <PdfSlideViewer fileUrl={previewUrl} />
          ) : (
            <div className="text-center text-white px-6 space-y-5 max-w-md">
              <div className="relative w-48 h-32 mx-auto rounded-2xl overflow-hidden bg-white/10">
                <PresentationPreview item={item} mode="full" />
              </div>
              {/* Ilgari ikkala shoxda bir xil matn turardi — preview xatosi
                  yuz berganini foydalanuvchi bilmasdi. */}
              <p className="text-[14px] text-white/80 leading-relaxed">
                {previewError
                  ? t('presentation.previewFailed')
                  : t('presentation.previewDownload')}
              </p>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={item.file_name}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white text-[14px] font-semibold hover:bg-blue-500"
                >
                  <Download size={18} /> {t('common.download')}
                </a>
              )}
            </div>
          )}
        </div>

        {hasNext && (
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            className="absolute right-2 z-10 p-3 rounded-full bg-white/15 hover:bg-white/25 text-white"
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function PresentationMaterials() {
  const { t } = useUiText();
  const globalTopic = useContext(GlobalTopicContext);
  // Sarlavha interfeys tilida (kontekstda asl matn — u AI va saqlash kaliti).
  const localizedTopic = useLocalizedTopic(globalTopic);
  const { language } = useContext(AppLanguageContext);
  const { openSyllabus } = useContext(AppNavigationContext);
  const [items, setItems] = useState<TopicPresentationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Xato emas — ogohlantirish (ma'ruza tili joriy tilga mos kelmasa). */
  const [languageWarning, setLanguageWarning] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const topicTitle = globalTopic?.title?.trim() ?? '';
  const topicReady = Boolean(globalTopic && topicTitle && isTopicContextComplete(globalTopic));

  const topicKey = topicContextKey(globalTopic);
  const requestSeq = useRef(0);

  const loadItems = useCallback(async (): Promise<TopicPresentationItem[]> => {
    if (!topicReady || !globalTopic || !topicKey) {
      setItems([]);
      setLoading(false);
      return [];
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchPresentationsForTopic(globalTopic);
      if (seq !== requestSeq.current) return [];
      setItems(rows);
      return rows;
    } catch (e) {
      if (seq !== requestSeq.current) return [];
      setItems([]);
      setError(
        e instanceof Error && e.message === 'no-backend-token'
          ? t('presentation.errorLogin')
          : t('presentation.errorLoad'),
      );
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
    return [];
  }, [topicReady, topicKey, globalTopic, t]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    setLightboxIndex(null);
  }, [topicKey]);

  const hasPdfSource = items.some((i) => i.kind === 'pdf');

  const handleUpload = async (file: File) => {
    if (!topicReady || !globalTopic) return;
    if (!isAllowedPresentationFile(file)) {
      setError(t('presentation.errorFileType'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadPresentation({ topic: topicTitle, file, context: globalTopic });
      await loadItems();
    } catch (e) {
      setError(apiErrorMessage(e, t('presentation.errorUpload'), language));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleAiPresentation = async () => {
    if (!topicReady || !globalTopic) return;
    setAiLoading(true);
    setError(null);
    setAiProgress('');
    try {
      // Taqdimot MA'RUZA MATNI asosida quriladi. Matn bo'lmasa yaratmaymiz —
      // aks holda taqdimot ma'ruzaga bog'lanmagan, umumiy bo'lib qolardi.
      // MUHIM: "Ma'ruza matni" bo'limi matnni MAVZU SARLAVHASI (oddiy satr)
      // bo'yicha saqlaydi, sillabus-kontekst kaliti bilan emas. Shuning uchun
      // avval kontekst bo'yicha, topilmasa sarlavha bo'yicha qidiramiz —
      // shunda eski va yangi formatda saqlangan ma'ruzalar ham topiladi.
      const lecture =
        (await loadLatestPreparedContent<LectureNote>('lecture', globalTopic)) ??
        (await loadLatestPreparedContent<LectureNote>('lecture', globalTopic.title));
      const lectureText = (lecture?.content || '').trim();
      if (!lectureText) {
        setError(t('presentation.errorNoLecture'));
        return;
      }
      // Ma'ruza o'sha paytdagi interfeys tilida saqlanadi. Hozirgi til boshqa
      // bo'lsa, model bir tildagi manbadan boshqa tilda slayd yasashga majbur
      // bo'ladi va natija aralash chiqishi mumkin — buni oldindan aytamiz.
      setLanguageWarning(
        outputLanguageLooksWrong(lectureText, language)
          ? t('presentation.warnLectureLanguage')
          : null,
      );

      // Yuklangan PDF (bo'lsa) qo'shimcha kontekst sifatida beriladi.
      let sourceText = '';
      const pdfItem = items.find((i) => i.kind === 'pdf');
      if (pdfItem) {
        try {
          const blobUrl = await getPresentationFileBlobUrl(pdfItem.id);
          const res = await fetch(blobUrl);
          sourceText = await extractPdfTextFromBlob(await res.blob());
        } catch {
          /* PDF matn ixtiyoriy */
        }
      }
      const hasPdfContext = Boolean(pdfItem && sourceText.trim());
      const deck = await aiService.generatePresentationDeck({
        topicTitle: globalTopic.title,
        topicId: globalTopic.id,
        topicType: globalTopic.type,
        subjectName: globalTopic.subjectName,
        variantLabel: globalTopic.variantLabel,
        // Foydalanuvchi UI'da tanlagan til ustuvor (lekin bilan bir xil qoida).
        language,
        mode: hasPdfContext ? 'enhance' : 'generate',
        lectureText,
        sourceFileName: hasPdfContext ? pdfItem?.file_name : undefined,
        sourceText: hasPdfContext ? sourceText : undefined,
        subjectCode: globalTopic.subjectCode,
        onProgress: (textSoFar) => setAiProgress(textSoFar),
      });
      let savedDeckId: string | null = null;
      try {
        // MUHIM: mavzu kaliti sifatida taqdimot SARLAVHASI emas, MAVZU nomi
        // ishlatiladi — aks holda Baza mavzu bo'yicha qidirganda topa olmaydi
        // (boshqa 3 bo'lim ham aynan shunday saqlaydi).
        // topicNorm (sillabus::yo'nalish::mavzu kodi) qo'shiladi — sarlavha
        // kalit bo'lib qolmasin (tarjimadan keyin yozuv yo'qolmasligi uchun).
        savedDeckId = await savePreparedContent(
          'presentation',
          globalTopic.title,
          deck,
          buildPreparedContentMeta(globalTopic),
        );
        pushAppNotification({
          title: t('common.doneTitle'),
          body: t('presentation.readyToast'),
          titleKey: 'common.doneTitle',
          bodyKey: 'presentation.readyToast',
          level: 'success',
        });
      } catch (histErr) {
        console.warn('Presentation history save skipped:', histErr);
        pushAppNotification({
          title: t('common.doneTitle'),
          body: t('common.saveFailedKeepWork'),
          titleKey: 'common.doneTitle',
          bodyKey: 'common.saveFailedKeepWork',
          level: 'warning',
        });
      }
      // PPTX Baza yozuvi yaratilgandan KEYIN quriladi — fayl nomiga o'sha
      // yozuvning belgisi qo'yiladi va ikkalasi bir-biriga bog'lanadi.
      const built = await buildPresentationPptxFile(deck, {
        meta: {
          subjectName: globalTopic.subjectName,
          topicId: globalTopic.id,
          variantLabel: globalTopic.variantLabel,
          language,
        },
      });
      if (!built.size) {
        throw new Error('empty-pptx');
      }
      const deckMarker = savedDeckId ? deckFileMarker(savedDeckId) : null;
      const file = deckMarker ? withDeckMarker(built, deckMarker) : built;

      const shortTopic =
        [globalTopic.id, globalTopic.title].filter(Boolean).join(' — ').slice(0, 240) || topicTitle;
      const created = await uploadPresentation({
        topic: shortTopic,
        file,
        title: (deck.presentation_title || shortTopic).slice(0, 240),
        context: globalTopic,
      });
      const rows = await loadItems();
      const newIdx = created?.id != null ? rows.findIndex((r) => r.id === created.id) : 0;
      if (newIdx >= 0) setLightboxIndex(newIdx);
    } catch (e) {
      const detail = apiErrorMessage(e, t('presentation.errorAiHint'), language);
      setError(`${t('presentation.errorAi')} ${detail}`);
    } finally {
      setAiLoading(false);
      setAiProgress('');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t('presentation.confirmDelete'))) return;
    try {
      await deletePresentation(id);
      await loadItems();
      setLightboxIndex(null);
    } catch {
      setError(t('presentation.errorDelete'));
    }
  };

  if (!topicReady || !globalTopic) {
    return (
      <StaffPageLayout>
        <StaffEmptyState
          icon={BookOpen}
          title={t('presentation.noTopic')}
          hint={t('presentation.noTopicHint')}
          actionLabel={t('common.goToSyllabus')}
          onAction={openSyllabus}
        />
      </StaffPageLayout>
    );
  }

  return (
    <StaffPageLayout>
      <StaffTopicHeader
        moduleLabel={t('presentation.title')}
        topic={localizedTopic}
        hint={hasPdfSource ? t('presentation.hintWithUpload') : t('presentation.hintAiGenerate')}
      >
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
          />
          <button
            type="button"
            disabled={uploading || aiLoading}
            onClick={() => fileRef.current?.click()}
            className={`${staffBtnPrimary} disabled:opacity-50`}
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {uploading ? t('common.loading') : t('presentation.upload')}
          </button>
          <button
            type="button"
            disabled={uploading || aiLoading}
            onClick={() => void handleAiPresentation()}
            className={`${staffBtnSecondary} disabled:opacity-50`}
          >
            {aiLoading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {aiLoading
              ? t('common.loading')
              : hasPdfSource
                ? t('presentation.aiEnhance')
                : t('presentation.aiGenerate')}
          </button>
          <button
            type="button"
            onClick={() => void loadItems()}
            disabled={loading}
            className={`${staffBtnGhost} disabled:opacity-50`}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
        </div>
      </StaffTopicHeader>

      {error && <StaffErrorAlert message={error} />}

      {languageWarning && (
        <StaffPanel className="p-4 border border-amber-200 bg-amber-50/80">
          <p className="text-[13px] text-amber-900/90">{languageWarning}</p>
        </StaffPanel>
      )}

      {aiLoading && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <StaffPanel className="p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-sky-600/10 text-sky-700 flex items-center justify-center shrink-0">
                <Sparkles size={20} className="animate-pulse" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-[#083047]">{t('presentation.aiGenerating')}</p>
                {aiProgress ? (
                  <p className="text-[12px] text-sky-700 font-semibold mt-0.5 truncate">{aiProgress}</p>
                ) : null}
              </div>
              <Loader2 size={18} className="animate-spin text-sky-600 shrink-0" />
            </div>
          </StaffPanel>
        </motion.div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-[#083047]/60" size={36} />
        </div>
      ) : items.length === 0 ? (
        <StaffPanel className="py-12 text-center text-black/45 text-[14px] space-y-1.5">
          <p>{t('presentation.empty')}</p>
        </StaffPanel>
      ) : (
        <div className="space-y-2">
          <h3 className="text-[14px] font-bold text-[#083047]">{t('presentation.topicVersions')}</h3>
          <p className="text-[12.5px] text-black/45">{t('presentation.topicVersionsHint')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {items.map((item, idx) => (
            <motion.div
              key={item.id}
              layout
              className="group relative ios-glass rounded-2xl border border-white/70 overflow-hidden shadow-sm"
            >
              <button
                type="button"
                onClick={() => setLightboxIndex(idx)}
                className="block w-full aspect-video bg-black/5 relative"
              >
                <PresentationPreview item={item} mode="thumb" />
                <span className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <ZoomIn size={16} />
                </span>
              </button>
              <div className="p-3 space-y-1">
                <p className="text-[13px] font-semibold text-black/85 line-clamp-2">{item.title || item.file_name}</p>
                <p className="text-[11px] text-black/45">
                  {kindLabel(item.kind)} · {formatSize(item.file_size)} · {item.author_name}
                </p>
              </div>
              {/* O'chirish tugmasi doim ko'rinadi — hover yo'q qurilmalarda ham ishlasin. */}
              {item.can_delete && (
                <button
                  type="button"
                  onClick={() => void handleDelete(item.id)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 text-rose-600 shadow ring-1 ring-rose-200/70 hover:bg-rose-50 transition-colors"
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </motion.div>
          ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {lightboxIndex !== null && items[lightboxIndex] && (
          <PresentationLightbox
            items={items}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onIndexChange={setLightboxIndex}
          />
        )}
      </AnimatePresence>
    </StaffPageLayout>
  );
}
