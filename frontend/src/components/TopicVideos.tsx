import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, Loader2, Plus, Trash2, Video, Youtube } from 'lucide-react';
import { motion } from 'motion/react';
import { GlobalTopicContext, AppNavigationContext } from '../App';
import { useUiText } from '../i18n/useUiText';
import { postActivityEvents } from '../utils/analyticsApi';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import {
  createTopicVideo,
  deleteTopicVideo,
  fetchTopicVideos,
  youtubeIdFromUrl,
  type TopicVideo,
} from '../utils/topicVideoApi';
import { backendErrorMessage } from '../utils/apiError';
import { useYoutubeTitle } from '../utils/youtubeTitle';
import StaffPageLayout from './staff/StaffPageLayout';
import StaffTopicHeader from './staff/StaffTopicHeader';
import StaffEmptyState from './staff/StaffEmptyState';
import { staffBtnGhost, staffBtnPrimary, staffInput } from './staff/staffUi';
import { isTopicContextComplete, topicContextKey } from '../utils/syllabusTopicContext';

function VideoCard({
  video,
  playing,
  onPlay,
  deleting = false,
  onDelete,
}: {
  video: TopicVideo;
  playing: boolean;
  onPlay: () => void;
  deleting?: boolean;
  onDelete?: () => void;
}) {
  const { t } = useUiText();
  // Admin sarlavha yozmagan bo'lsa — YouTube'dan asl nomi olinadi (ID emas).
  const displayTitle = useYoutubeTitle(video.youtube_id, video.title);

  return (
    <motion.div layout className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.06]">
      <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
        {playing ? (
          <iframe
            src={`${video.embed_url}${video.embed_url.includes('?') ? '&' : '?'}autoplay=1`}
            title={displayTitle || video.youtube_id}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full border-0"
          />
        ) : (
          // Sekin internetda 10 ta iframe birdan yuklanmasin — avval muqova,
          // bosilganda plyer.
          <button
            type="button"
            onClick={onPlay}
            className="group absolute inset-0 w-full h-full"
            aria-label={t('video.play')}
          >
            <img
              src={`https://img.youtube.com/vi/${video.youtube_id}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/10 transition-colors">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white">
                <Youtube size={26} />
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-[13px] font-semibold text-slate-800 line-clamp-2 leading-snug">
          {displayTitle || t('video.untitled')}
        </p>
        {video.author_name && (
          <p className="text-[11px] text-slate-400">{t('video.addedBy', { name: video.author_name })}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <a
            href={video.youtube_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900"
          >
            <ExternalLink size={12} />
            {t('video.openOnYoutube')}
          </a>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {t('video.delete')}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * O'qituvchi uchun "Videolar" bo'limi.
 *
 * Ilgari videoni faqat admin biriktirardi (Admin → Videolar). Endi o'qituvchi
 * taqdimot yuklagani kabi mavzuga YouTube havolasini o'zi qo'shadi va o'zi
 * qo'shganini o'chiradi (server `can_delete` bilan belgilaydi). Server faqat
 * o'qituvchining O'Z videolarini qaytaradi (`_only_own`).
 */
export default function TopicVideos() {
  const { t, language } = useUiText();
  const globalTopic = useContext(GlobalTopicContext);
  const { openSyllabus } = useContext(AppNavigationContext);
  const localizedTopic = useLocalizedTopic(globalTopic);
  const [videos, setVideos] = useState<TopicVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const topicKey = topicContextKey(globalTopic);
  const requestSeq = useRef(0);

  const syllabusId = globalTopic?.syllabusId;
  const variantLabel = globalTopic?.variantLabel;
  const topicCode = globalTopic?.id;

  const loadVideos = useCallback(async () => {
    if (!topicKey || !syllabusId || !topicCode) {
      setVideos([]);
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await fetchTopicVideos({
        syllabusId,
        variantLabel: variantLabel || 'asosiy',
        topicCode,
      });
      if (seq !== requestSeq.current) return;
      setVideos(rows);
      setActiveId(null);
    } catch {
      if (seq !== requestSeq.current) return;
      // Boshqa mavzuning videolari ekranda qolib ketmasin.
      setVideos([]);
      setLoadError(true);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [topicKey, syllabusId, variantLabel, topicCode]);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  // Mavzu almashganda oldingi mavzuning "Video qo'shildi" xabari va
  // yarim yozilgan havola qolib ketmasin.
  useEffect(() => {
    setMessage(null);
    setUrl('');
    setTitle('');
  }, [topicKey]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalTopic || !syllabusId || !topicCode) return;
    if (!youtubeIdFromUrl(url)) {
      setMessage({ ok: false, text: t('video.invalidUrl') });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await createTopicVideo({
        syllabusId,
        variantLabel: variantLabel || 'asosiy',
        topicCode,
        topic: globalTopic.title,
        title: title.trim(),
        youtubeUrl: url.trim(),
      });
      setUrl('');
      setTitle('');
      setMessage({ ok: true, text: t('video.added') });
      await loadVideos();
    } catch (err) {
      // Server xabari faqat interfeys tilida bo'lsa ko'rsatiladi.
      setMessage({ ok: false, text: backendErrorMessage(err, language) || t('video.addFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (video: TopicVideo) => {
    if (!window.confirm(t('video.deleteConfirm'))) return;
    setDeletingId(video.id);
    setMessage(null);
    try {
      await deleteTopicVideo(video.id);
      await loadVideos();
    } catch {
      setMessage({ ok: false, text: t('video.deleteFailed') });
    } finally {
      setDeletingId(null);
    }
  };

  if (!globalTopic?.title || !isTopicContextComplete(globalTopic)) {
    return (
      <StaffPageLayout
        title={t('nav.videos')}
        icon={Video}
        accent="rose"
      >
        <StaffEmptyState
          icon={BookOpen}
          title={t('video.noTopicTitle')}
          hint={t('video.noTopicHint')}
          actionLabel={t('common.goToCourses')}
          onAction={openSyllabus}
        />
      </StaffPageLayout>
    );
  }

  return (
    <StaffPageLayout
      title={t('nav.videos')}
      icon={Video}
      accent="rose"
    >
      <StaffTopicHeader
        moduleLabel={t('video.title')}
        topic={localizedTopic}
        hint={t('video.adminManagedHint')}
        actions={
          <button
            type="button"
            onClick={() => void loadVideos()}
            disabled={loading}
            className={`${staffBtnGhost} disabled:opacity-50`}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
        }
      />

      <form
        onSubmit={(e) => void handleAdd(e)}
        className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] sm:p-4"
      >
        <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          <Youtube size={16} className="text-rose-600" />
          {t('video.addTitle')}
        </p>
        <div className="flex flex-col gap-2 lg:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('video.urlPlaceholder')}
            inputMode="url"
            className={`${staffInput} min-w-0 lg:flex-[3]`}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('video.namePlaceholder')}
            maxLength={255}
            className={`${staffInput} min-w-0 lg:flex-[2]`}
          />
          <button
            type="submit"
            disabled={saving || !url.trim()}
            className={`${staffBtnPrimary} shrink-0 justify-center disabled:opacity-50`}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {t('video.add')}
          </button>
        </div>
        {message && (
          <p className={`mt-2 text-[12.5px] font-medium ${message.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
            {message.text}
          </p>
        )}
      </form>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-slate-300" size={36} />
        </div>
      ) : loadError ? (
        <div className="mx-auto max-w-sm px-4 py-16 text-center">
          <p className="text-[13px] font-medium leading-relaxed text-rose-600">{t('video.errorLoad')}</p>
        </div>
      ) : videos.length === 0 ? (
        <div className="mx-auto max-w-sm px-4 py-16 text-center">
          <Video size={22} className="mx-auto mb-3 text-slate-300" />
          <p className="text-[13px] leading-relaxed text-slate-500">{t('video.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              playing={activeId === v.id}
              deleting={deletingId === v.id}
              onDelete={v.can_delete ? () => void handleDelete(v) : undefined}
              onPlay={() => {
                setActiveId(v.id);
                // Hisobot uchun: o'qituvchi qaysi videoni ochgani.
                void postActivityEvents(
                  [
                    {
                      event_type: 'content_view',
                      meta: { kind: 'video', youtube_id: v.youtube_id, title: v.title || '' },
                    },
                  ],
                  'videos',
                );
              }}
            />
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <p className="text-center text-[12px] text-slate-400">
          {t('video.totalCount', { count: videos.length })}
        </p>
      )}
    </StaffPageLayout>
  );
}
