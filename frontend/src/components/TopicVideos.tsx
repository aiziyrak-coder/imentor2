import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, Loader2, Youtube } from 'lucide-react';
import { motion } from 'motion/react';
import { GlobalTopicContext, AppNavigationContext } from '../App';
import { useUiText } from '../i18n/useUiText';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import { fetchTopicVideos, type TopicVideo } from '../utils/topicVideoApi';
import { useYoutubeTitle } from '../utils/youtubeTitle';
import StaffPageLayout from './staff/StaffPageLayout';
import StaffTopicHeader from './staff/StaffTopicHeader';
import StaffEmptyState from './staff/StaffEmptyState';
import StaffPanel from './staff/StaffPanel';
import { staffBtnGhost } from './staff/staffUi';
import { isTopicContextComplete, topicContextKey } from '../utils/syllabusTopicContext';

function VideoCard({
  video,
  playing,
  onPlay,
}: {
  video: TopicVideo;
  playing: boolean;
  onPlay: () => void;
}) {
  const { t } = useUiText();
  // Admin sarlavha yozmagan bo'lsa — YouTube'dan asl nomi olinadi (ID emas).
  const displayTitle = useYoutubeTitle(video.youtube_id, video.title);

  return (
    <motion.div layout className="ios-glass rounded-2xl border border-white/70 overflow-hidden shadow-sm">
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
              <span className="w-14 h-14 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg">
                <Youtube size={26} />
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-[13px] font-semibold text-black/85 line-clamp-2 leading-snug">
          {displayTitle || t('video.untitled')}
        </p>
        <a
          href={video.youtube_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#083047]/70 hover:text-[#083047]"
        >
          <ExternalLink size={12} />
          {t('video.openOnYoutube')}
        </a>
      </div>
    </motion.div>
  );
}

/**
 * O'qituvchi uchun "Videolar" bo'limi.
 *
 * Videolarni admin panel biriktiradi (Admin → Videolar), o'qituvchi tanlangan
 * mavzu bo'yicha ularni shu sahifada ko'radi. Ro'yxat faqat o'qish uchun.
 */
export default function TopicVideos() {
  const { t } = useUiText();
  const globalTopic = useContext(GlobalTopicContext);
  const { openSyllabus } = useContext(AppNavigationContext);
  const localizedTopic = useLocalizedTopic(globalTopic);
  const [videos, setVideos] = useState<TopicVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
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
    try {
      const rows = await fetchTopicVideos({
        syllabusId,
        variantLabel: variantLabel || 'asosiy',
        topicCode,
      });
      if (seq !== requestSeq.current) return;
      setVideos(rows);
      setActiveId(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [topicKey, syllabusId, variantLabel, topicCode]);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  if (!globalTopic?.title || !isTopicContextComplete(globalTopic)) {
    return (
      <StaffPageLayout>
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
    <StaffPageLayout>
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

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-[#083047]/60" size={36} />
        </div>
      ) : videos.length === 0 ? (
        <StaffPanel className="py-12 text-center text-black/45 text-[14px]">
          {t('video.empty')}
        </StaffPanel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              playing={activeId === v.id}
              onPlay={() => setActiveId(v.id)}
            />
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <p className="text-center text-[12px] text-black/40">
          {t('video.totalCount', { count: videos.length })}
        </p>
      )}
    </StaffPageLayout>
  );
}
