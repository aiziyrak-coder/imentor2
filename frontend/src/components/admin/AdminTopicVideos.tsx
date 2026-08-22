import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, Search, Trash2, Youtube } from 'lucide-react';
import { backendErrorMessage } from '../../utils/apiError';
import { fetchAdminCourseSyllabuses, type CourseSyllabusRow } from '../../utils/syllabusApi';
import { resolveSyllabusVariants } from '../../utils/syllabusVariant';
import { formatTopicDisplayLabel } from '../../utils/topicLessonLabel';
import SearchableSelect from './SearchableSelect';
import {
  createAdminTopicVideo,
  deleteAdminTopicVideo,
  fetchAdminTopicVideos,
  type TopicVideo,
} from '../../utils/topicVideoApi';
import { useUiText } from '../../i18n/useUiText';
import { useYoutubeTitle } from '../../utils/youtubeTitle';

function VideoRow({
  video,
  deleting,
  onDelete,
}: {
  video: TopicVideo;
  deleting: boolean;
  onDelete: () => void;
}) {
  const { t } = useUiText();
  // Sarlavha kiritilmagan bo'lsa — YouTube'dan asl nomi olinadi.
  const displayTitle = useYoutubeTitle(video.youtube_id, video.title);

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <img
        src={`https://img.youtube.com/vi/${video.youtube_id}/default.jpg`}
        alt=""
        className="w-16 h-12 rounded-lg object-cover bg-slate-100 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-800 truncate">
          {displayTitle || video.youtube_id}
        </p>
        <a
          href={video.youtube_url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-indigo-500 hover:underline truncate block"
        >
          {video.youtube_url}
        </a>
      </div>
      <button
        type="button"
        disabled={deleting}
        onClick={onDelete}
        className="p-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 shrink-0 disabled:opacity-50"
        title={t('admin.delete')}
        aria-label={t('admin.delete')}
      >
        {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      </button>
    </li>
  );
}

export default function AdminTopicVideos() {
  const { t } = useUiText();
  const [fans, setFans] = useState<CourseSyllabusRow[]>([]);
  const [videos, setVideos] = useState<TopicVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fanId, setFanId] = useState('');
  const [variantLabel, setVariantLabel] = useState('');
  const [topicCode, setTopicCode] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [adding, setAdding] = useState(false);

  // Ro'yxat: qidiruv + fan filtri
  const [search, setSearch] = useState('');
  const [fanFilter, setFanFilter] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fanRows, vids] = await Promise.all([fetchAdminCourseSyllabuses(), fetchAdminTopicVideos()]);
      setFans(fanRows);
      setVideos(vids);
    } catch {
      setError(t('admin.error.loadFailed'));
      setFans([]);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedFan = useMemo(() => fans.find((f) => String(f.id) === fanId) || null, [fans, fanId]);
  const variants = useMemo(() => (selectedFan ? resolveSyllabusVariants(selectedFan) : []), [selectedFan]);
  const selectedVariant = useMemo(
    () => variants.find((v) => v.label === variantLabel) || null,
    [variants, variantLabel],
  );
  const topics = useMemo(() => {
    const seen = new Set<string>();
    return (selectedVariant?.topics ?? []).filter((tp) => {
      if (!tp.id || seen.has(tp.id)) return false;
      seen.add(tp.id);
      return true;
    });
  }, [selectedVariant]);

  useEffect(() => {
    // Yo'nalish UI yo'q — teacher flow bilan bir xil: birinchi (yoki yagona) variant.
    setVariantLabel(variants[0]?.label ?? '');
    setTopicCode('');
  }, [variants]);

  useEffect(() => {
    setTopicCode('');
  }, [variantLabel]);

  const fanNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of fans) m.set(f.id, f.subject_name);
    return m;
  }, [fans]);

  // Filtr uchun fanlar (videolar mavjud bo'lgan)
  const fanFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of videos) {
      const sid = (v.topic_norm || '').split('::')[0];
      if (sid) m.set(sid, fanNameById.get(Number(sid)) || sid);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [videos, fanNameById]);

  const filteredVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter((v) => {
      const sid = (v.topic_norm || '').split('::')[0];
      if (fanFilter && sid !== fanFilter) return false;
      if (q) {
        const fanName = fanNameById.get(Number(sid)) || '';
        const hay = `${v.topic} ${v.title} ${v.youtube_id} ${fanName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [videos, search, fanFilter, fanNameById]);

  // Videolarni fan → mavzu bo'yicha guruhlash
  const grouped = useMemo(() => {
    const map = new Map<string, { fanName: string; topic: string; rows: TopicVideo[] }>();
    for (const v of filteredVideos) {
      const parts = (v.topic_norm || '').split('::');
      const syllabusId = Number(parts[0]);
      const code = (parts[2] || '').toUpperCase();
      const fanName = fanNameById.get(syllabusId) || t('catalog.otherTopics');
      const key = v.topic_norm || `${fanName}||${v.topic}`;
      const label = code ? `${code} · ${v.topic}` : v.topic;
      if (!map.has(key)) map.set(key, { fanName, topic: label, rows: [] });
      map.get(key)!.rows.push(v);
    }
    return [...map.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => a.fanName.localeCompare(b.fanName) || a.topic.localeCompare(b.topic));
  }, [filteredVideos, fanNameById, t]);

  const addVideo = async () => {
    if (!fanId || !variantLabel || !topicCode || !youtubeUrl.trim()) return;
    const topic = topics.find((tp) => tp.id === topicCode);
    if (!topic) return;
    setAdding(true);
    setError(null);
    try {
      await createAdminTopicVideo({
        syllabusId: Number(fanId),
        variantLabel,
        topicCode,
        topic: topic.title,
        title: videoTitle.trim(),
        youtubeUrl: youtubeUrl.trim(),
      });
      setYoutubeUrl('');
      setVideoTitle('');
      setVideos(await fetchAdminTopicVideos());
    } catch (err) {
      setError(backendErrorMessage(err) || t('admin.error.videoAddFailed'));
    } finally {
      setAdding(false);
    }
  };

  const removeVideo = async (id: number) => {
    const pk = Number(id);
    if (!pk || deletingId === pk) return;
    setDeletingId(pk);
    setError(null);
    try {
      await deleteAdminTopicVideo(pk);
      setVideos((prev) => prev.filter((v) => Number(v.id) !== pk));
    } catch (err) {
      setError(backendErrorMessage(err) || t('admin.error.deleteFailedGeneric'));
    } finally {
      setDeletingId(null);
    }
  };

  const canAdd = Boolean(fanId && variantLabel && topicCode && youtubeUrl.trim()) && !adding;

  return (
    <div className="p-3 sm:p-5 lg:p-6 h-full overflow-y-auto w-full space-y-6">
      <div className="ios-glass rounded-3xl border border-white/70 p-6 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center">
            <Youtube size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('admin.videosTitle')}</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">{t('admin.videosSubtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700"
        >
          <RefreshCw size={16} /> {t('admin.refresh')}
        </button>
      </div>

      {/* Qo'shish: fan → mavzu → YouTube (yo'nalish avtomatik) */}
      <div className="ios-glass rounded-2xl border border-white/70 p-5 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">1 · {t('admin.subjectName')}</span>
            <SearchableSelect
              value={fanId}
              onChange={setFanId}
              disabled={adding}
              placeholder={t('admin.selectSubjectPlaceholder')}
              noMatchText={t('admin.noResults')}
              options={fans.map((f) => ({ value: String(f.id), label: f.subject_name }))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">2 · {t('admin.topicLabel')}</span>
            <select
              value={topicCode}
              onChange={(e) => setTopicCode(e.target.value)}
              disabled={adding || !fanId || topics.length === 0}
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white text-[13px] disabled:bg-slate-50"
            >
              <option value="">{t('admin.selectTopicPlaceholder')}</option>
              {topics.map((tp) => (
                <option key={`${tp.type}-${tp.id}`} value={tp.id}>
                  {formatTopicDisplayLabel(tp.type, tp.id, tp.title, t)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">{t('admin.youtubeUrlLabel')}</span>
            <input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              disabled={adding}
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white text-[13px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">{t('admin.videoTitleOptional')}</span>
            <input
              value={videoTitle}
              onChange={(e) => setVideoTitle(e.target.value)}
              disabled={adding}
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white text-[13px]"
            />
          </label>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void addVideo()}
            disabled={!canAdd}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-[13px] font-semibold disabled:opacity-40"
          >
            {adding ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            {t('admin.addVideo')}
          </button>
          {error && <p className="text-[13px] text-rose-600 font-medium">{error}</p>}
        </div>
      </div>

      {/* Qidiruv + fan filtri */}
      {!loading && videos.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.videosSearchPlaceholder')}
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-[13px]"
            />
          </div>
          <select
            value={fanFilter}
            onChange={(e) => setFanFilter(e.target.value)}
            className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-[13px]"
          >
            <option value="">{t('admin.filterAllSubjects')}</option>
            {fanFilterOptions.map(([sid, name]) => (
              <option key={sid} value={sid}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700 font-medium">
          {error}
        </p>
      )}

      {/* Ro'yxat */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
        </div>
      ) : videos.length === 0 ? (
        <div className="ios-glass rounded-2xl border p-10 text-center text-slate-400 text-[14px]">
          {t('admin.videosEmpty')}
        </div>
      ) : grouped.length === 0 ? (
        <div className="ios-glass rounded-2xl border p-10 text-center text-slate-400 text-[14px]">
          {t('admin.noResults')}
        </div>
      ) : (
        <ul className="space-y-3">
          {grouped.map((g) => (
            <li key={g.key} className="ios-glass rounded-2xl border border-white/70 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                <span className="font-bold text-slate-900">{g.topic}</span>
                <span className="text-[11px] text-slate-400"> · {g.fanName}</span>
              </div>
              <ul className="divide-y divide-slate-50">
                {g.rows.map((v) => (
                  <VideoRow
                    key={Number(v.id)}
                    video={v}
                    deleting={deletingId === Number(v.id)}
                    onDelete={() => void removeVideo(Number(v.id))}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
