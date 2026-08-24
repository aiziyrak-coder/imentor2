import { useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, Search } from 'lucide-react';
import type { SyllabusTopic } from '../../services/aiService';
import { buildTopicContext, handoutMatchesTopic } from '../../utils/syllabusTopicContext';
import { formatTopicDisplayLabel } from '../../utils/topicLessonLabel';
import { useUiText } from '../../i18n/useUiText';

/** Mavzuga biriktirilgan yozuv — tarqatma ham, video ham shu shaklda keladi. */
export type TopicLinkedRow = { topic_norm: string; language?: string };

type Filter = 'all' | 'done' | 'missing';

const LANG_ORDER = ['uz', 'ru', 'en'];

/**
 * Fan bo'yicha barcha mavzular va ularning yuklanganlik holati.
 *
 * Admin avval qaysi mavzu bo'sh qolganini ko'rishi kerak — aks holda 40 ta
 * mavzuni bittalab ochib tekshirishga to'g'ri keladi. Mavzuga bosilsa,
 * yuqoridagi forma o'sha mavzuga sozlanadi.
 */
export default function TopicUploadStatusList({
  topics,
  rows,
  syllabusId,
  subjectName,
  variantLabel,
  showLanguages = false,
  selectedTopicCode = '',
  onPick,
}: {
  topics: SyllabusTopic[];
  rows: TopicLinkedRow[];
  syllabusId: number;
  subjectName: string;
  variantLabel: string;
  showLanguages?: boolean;
  selectedTopicCode?: string;
  onPick?: (topicCode: string) => void;
}) {
  const { t } = useUiText();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  /** Har bir mavzu uchun: nechta fayl bor va qaysi tillarda. */
  const stats = useMemo(() => {
    return topics.map((tp) => {
      const ctx = buildTopicContext(tp, syllabusId, subjectName, '', variantLabel, 'uz');
      const matched = rows.filter((r) => handoutMatchesTopic(r, ctx));
      const langs = Array.from(
        new Set(matched.map((r) => (r.language || '').toLowerCase()).filter(Boolean)),
      ).sort((a, b) => LANG_ORDER.indexOf(a) - LANG_ORDER.indexOf(b));
      return { topic: tp, count: matched.length, langs, done: matched.length > 0 };
    });
  }, [topics, rows, syllabusId, subjectName, variantLabel]);

  const doneCount = stats.filter((s) => s.done).length;
  const total = stats.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stats.filter((s) => {
      if (filter === 'done' && !s.done) return false;
      if (filter === 'missing' && s.done) return false;
      if (!q) return true;
      return (
        s.topic.title.toLowerCase().includes(q) || s.topic.id.toLowerCase().includes(q)
      );
    });
  }, [stats, filter, query]);

  if (total === 0) return null;

  const chip = (id: Filter, label: string, n: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
        filter === id ? 'bg-blue-600 text-white' : 'bg-white/80 border border-black/10 text-black/65'
      }`}
    >
      {label} <span className="tabular-nums">{n}</span>
    </button>
  );

  return (
    <div className="ios-glass rounded-2xl border border-white/60 p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-black/90">{t('admin.topicStatusTitle')}</p>
          <p className="text-[12px] text-black/50">
            {t('admin.topicStatusSummary', { done: doneCount, total })}
          </p>
        </div>
        <span
          className={`shrink-0 text-[13px] font-bold px-3 py-1 rounded-full tabular-nums ${
            pct === 100
              ? 'bg-emerald-50 text-emerald-700'
              : pct === 0
                ? 'bg-rose-50 text-rose-700'
                : 'bg-amber-50 text-amber-700'
          }`}
        >
          {pct}%
        </span>
      </div>

      <div className="h-2 rounded-full bg-black/10 overflow-hidden" aria-hidden="true">
        <div
          className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {chip('all', t('admin.topicStatusAll'), total)}
        {chip('done', t('admin.topicStatusDone'), doneCount)}
        {chip('missing', t('admin.topicStatusMissing'), total - doneCount)}
        <div className="relative ml-auto min-w-[180px] flex-1 max-w-[260px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.topicStatusSearch')}
            className="w-full h-9 pl-8 pr-3 rounded-xl border border-slate-200 bg-white text-[12.5px]"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-black/40">{t('admin.noResults')}</p>
      ) : (
        <ul className="divide-y divide-black/5 max-h-[420px] overflow-y-auto -mx-1 px-1">
          {visible.map(({ topic, count, langs, done }) => {
            const active = selectedTopicCode === topic.id;
            const inner = (
              <>
                {done ? (
                  <CheckCircle2 size={17} className="text-emerald-600 shrink-0" aria-hidden />
                ) : (
                  <CircleDashed size={17} className="text-rose-500 shrink-0" aria-hidden />
                )}
                <span
                  className={`min-w-0 flex-1 text-[13px] truncate ${done ? 'text-black/80' : 'text-black/60'}`}
                >
                  {formatTopicDisplayLabel(topic.type, topic.id, topic.title, t)}
                </span>

                {showLanguages && langs.length > 0 && (
                  <span className="shrink-0 flex items-center gap-1">
                    {langs.map((l) => (
                      <span
                        key={l}
                        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-50 text-sky-700"
                      >
                        {l}
                      </span>
                    ))}
                  </span>
                )}

                <span
                  className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                    done ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {done ? count : t('admin.topicStatusEmpty')}
                </span>
              </>
            );
            const rowClass = `w-full text-left flex items-center gap-3 py-2.5 px-2 rounded-xl transition-colors ${
              active ? 'bg-blue-50/70' : ''
            }`;
            return (
              <li key={topic.id}>
                {onPick ? (
                  <button
                    type="button"
                    onClick={() => onPick(topic.id)}
                    className={`${rowClass} hover:bg-black/[0.035]`}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className={rowClass}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
