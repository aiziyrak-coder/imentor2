import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GlobalTopicContext, AppNavigationContext } from '../App';
import { useUiText } from '../i18n/useUiText';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import { backendErrorMessage } from '../utils/apiError';
import {
  fetchHandoutsForTopic,
  getHandoutFileBlobUrl,
  resolveHandoutFileUrl,
  uploadHandout,
  HANDOUT_FILE_ACCEPT,
  isAllowedHandoutFile,
  type TopicHandoutItem,
} from '../utils/handoutApi';
import { generateAndUploadTopicHandouts } from '../utils/handoutGenerate';
import StaffPageLayout from './staff/StaffPageLayout';
import StaffTopicHeader from './staff/StaffTopicHeader';
import StaffEmptyState from './staff/StaffEmptyState';
import StaffErrorAlert from './staff/StaffErrorAlert';
import StaffPanel from './staff/StaffPanel';
import { staffBtnGhost, staffBtnPrimary, staffBtnSecondary } from './staff/staffUi';
import { isTopicContextComplete, topicContextKey } from '../utils/syllabusTopicContext';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Faylni ko'rsatish uchun manba. PDF token bilan olinadi (blob), rasm ham —
 * `/media/` to'g'ridan-to'g'ri ochilmasligi mumkin, shuning uchun fallback bor.
 */
function useHandoutSrc(item: TopicHandoutItem | null): { src: string; failed: boolean } {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const id = item?.id ?? 0;
  const fileUrl = item?.file_url ?? '';

  useEffect(() => {
    if (!id) {
      setSrc('');
      setFailed(false);
      return;
    }
    let cancelled = false;
    setSrc('');
    setFailed(false);
    (async () => {
      try {
        const blobUrl = await getHandoutFileBlobUrl(id);
        if (!cancelled) setSrc(blobUrl);
      } catch {
        const fallback = resolveHandoutFileUrl(fileUrl);
        if (cancelled) return;
        if (fallback) setSrc(fallback);
        else setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, fileUrl]);

  return { src, failed };
}

function HandoutThumb({ item }: { item: TopicHandoutItem }) {
  const { t } = useUiText();
  const isPdf = item.kind === 'pdf';
  // PDF uchun faylni yuklab o'tirmaymiz — ikonka yetarli.
  const { src, failed } = useHandoutSrc(isPdf ? null : item);

  if (isPdf) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-rose-700/80 bg-rose-50/80">
        <FileText size={40} />
        <span className="text-[11px] font-bold uppercase tracking-wide">PDF</span>
      </div>
    );
  }

  if (failed || !src) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/5 text-black/30 text-[11px]">
        {failed ? t('handout.imageFailed') : t('common.loading')}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={item.title || item.file_name}
      loading="lazy"
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}

type LightboxProps = {
  items: TopicHandoutItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
};

function HandoutLightbox({ items, index, onClose, onIndexChange }: LightboxProps) {
  const { t } = useUiText();
  const item = items[index] ?? null;
  const { src: fileSrc } = useHandoutSrc(item);
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
      if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onClose, onIndexChange]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/92"
      role="dialog"
      aria-modal="true"
      aria-label={t('handout.viewerLabel')}
    >
      <header className="flex items-center gap-2 px-4 py-3 text-white shrink-0">
        <div className="min-w-0 flex-1 pr-3">
          <p className="text-[15px] font-semibold truncate">{item.title || item.file_name}</p>
          <p className="text-[12px] text-white/60 truncate">
            {index + 1} / {items.length} · {item.author_name || item.owner_key}
          </p>
        </div>
        {fileSrc && (
          <a
            href={fileSrc}
            download={item.file_name}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white"
            aria-label={t('common.download')}
            title={t('common.download')}
          >
            <Download size={20} />
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20"
          aria-label={t('common.close')}
        >
          <X size={22} />
        </button>
      </header>

      <div className="flex-1 relative flex items-center justify-center min-h-0 px-2 pb-2">
        {hasPrev && (
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            className="absolute left-2 z-10 p-3 rounded-full bg-white/15 hover:bg-white/25 text-white"
            aria-label={t('common.prev')}
          >
            <ChevronLeft size={28} />
          </button>
        )}

        <div className="w-full h-full max-w-6xl flex items-center justify-center">
          {!fileSrc ? (
            <Loader2 className="animate-spin text-white" size={40} />
          ) : item.kind === 'pdf' ? (
            <iframe
              title={item.file_name}
              src={fileSrc}
              className="w-full h-full min-h-[50vh] rounded-lg bg-white"
            />
          ) : (
            <img
              src={fileSrc}
              alt={item.title || item.file_name}
              className="max-w-full max-h-[calc(100dvh-8rem)] object-contain rounded-lg shadow-2xl"
            />
          )}
        </div>

        {hasNext && (
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            className="absolute right-2 z-10 p-3 rounded-full bg-white/15 hover:bg-white/25 text-white"
            aria-label={t('common.next')}
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * O'qituvchi uchun "Tarqatmalar" bo'limi.
 * Mavzu bo'yicha fayl yuklash yoki AI infografika (uz/ru/en) yaratish mumkin.
 */
export default function HandoutMaterials() {
  const { t, language } = useUiText();
  const globalTopic = useContext(GlobalTopicContext);
  const { openSyllabus } = useContext(AppNavigationContext);
  const localizedTopic = useLocalizedTopic(globalTopic);
  const [items, setItems] = useState<TopicHandoutItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState<'upload' | 'generate' | null>(null);
  const [progress, setProgress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const topicKey = topicContextKey(globalTopic);
  const requestSeq = useRef(0);

  const loadHandouts = useCallback(async () => {
    if (!topicKey || !globalTopic?.title) {
      setItems([]);
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchHandoutsForTopic(globalTopic, language);
      if (seq !== requestSeq.current) return;
      setItems(list);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setItems([]);
      setError(
        e instanceof Error && e.message === 'no-backend-token'
          ? t('handout.errorLogin')
          : t('handout.errorLoad'),
      );
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [topicKey, globalTopic, language, t]);

  useEffect(() => {
    void loadHandouts();
  }, [loadHandouts]);

  const handleUploadFiles = async (list: FileList | null) => {
    if (!globalTopic || !isTopicContextComplete(globalTopic)) return;
    const picked = Array.from(list || []).filter(isAllowedHandoutFile);
    if (picked.length === 0) return;
    setBusy('upload');
    setError(null);
    try {
      for (const file of picked) {
        await uploadHandout({ topic: globalTopic, file, language });
      }
      await loadHandouts();
    } catch (err) {
      setError(backendErrorMessage(err) || t('handout.errorUpload'));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!globalTopic || !isTopicContextComplete(globalTopic)) return;
    setBusy('generate');
    setError(null);
    setProgress(t('handout.progressAi'));
    try {
      await generateAndUploadTopicHandouts({
        topicTitle: globalTopic.title,
        topicId: globalTopic.id,
        topicType: globalTopic.type,
        subjectName: globalTopic.subjectName,
        subjectCode: globalTopic.subjectCode,
        topic: globalTopic,
        mode: 'staff',
        onProgress: (stage, lang) => {
          if (stage === 'ai') setProgress(t('handout.progressAi'));
          else if (stage === 'render') setProgress(t('handout.progressRender', { lang: (lang || '').toUpperCase() }));
          else setProgress(t('handout.progressUpload', { lang: (lang || '').toUpperCase() }));
        },
      });
      await loadHandouts();
    } catch (err) {
      setError(backendErrorMessage(err) || t('handout.errorGenerate'));
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  if (!globalTopic?.title || !isTopicContextComplete(globalTopic)) {
    return (
      <StaffPageLayout>
        <StaffEmptyState
          icon={BookOpen}
          title={t('handout.noTopicTitle')}
          hint={t('handout.noTopicHint')}
          actionLabel={t('common.goToCourses')}
          onAction={openSyllabus}
        />
      </StaffPageLayout>
    );
  }

  return (
    <StaffPageLayout>
      <StaffTopicHeader
        moduleLabel={t('handout.title')}
        topic={localizedTopic}
        hint={t('handout.adminManagedHint')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={HANDOUT_FILE_ACCEPT}
              multiple
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => void handleUploadFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className={staffBtnSecondary}
            >
              {busy === 'upload' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {t('handout.upload')}
            </button>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={busy !== null}
              className={staffBtnPrimary}
            >
              {busy === 'generate' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {busy === 'generate' ? t('handout.generating') : t('handout.generate')}
            </button>
            <button
              type="button"
              onClick={() => void loadHandouts()}
              disabled={loading || busy !== null}
              className={staffBtnGhost}
            >
              {loading ? t('common.loading') : t('common.refresh')}
            </button>
          </div>
        }
      />

      {progress ? (
        <StaffPanel className="py-3 px-4 text-[13px] text-[#083047] font-medium">{progress}</StaffPanel>
      ) : null}

      {error && <StaffErrorAlert message={error} />}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-[#083047]/60" size={36} />
        </div>
      ) : items.length === 0 ? (
        <StaffPanel className="py-12 text-center text-black/45 text-[14px]">
          {t('handout.empty')}
        </StaffPanel>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
          {items.map((item, idx) => (
            <motion.div
              key={item.id}
              layout
              className="group relative ios-glass rounded-2xl border border-white/70 overflow-hidden shadow-sm"
            >
              <button
                type="button"
                onClick={() => setLightboxIndex(idx)}
                className="block w-full aspect-[4/3] bg-black/5 relative"
              >
                <HandoutThumb item={item} />
                <span className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <ZoomIn size={16} />
                </span>
              </button>
              <div className="p-2.5 space-y-1">
                <p className="text-[12px] font-semibold text-black/85 line-clamp-2 leading-snug">
                  {item.title || item.file_name}
                </p>
                <p className="text-[10px] text-black/35">
                  {item.kind === 'pdf' ? 'PDF' : t('handout.kindImage')} · {formatSize(item.file_size)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <p className="text-center text-[12px] text-black/40">
          {t('handout.totalCount', { count: items.length })}
        </p>
      )}

      <AnimatePresence>
        {lightboxIndex !== null && items[lightboxIndex] && (
          <HandoutLightbox
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
