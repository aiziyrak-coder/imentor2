import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { CourseSyllabusRow } from '../../utils/syllabusApi';
import { resolveSyllabusVariants } from '../../utils/syllabusVariant';
import { formatTopicDisplayLabel } from '../../utils/topicLessonLabel';
import { useUiText } from '../../i18n/useUiText';
import {
  buildTopicCoverage,
  topicHasLang,
  HANDOUT_LANGS,
  type TopicCoverage,
} from '../../utils/topicCoverage';

const PAGE_SIZE = 20;

type GapRow = {
  key: string;
  deptName: string;
  fanId: number;
  fanName: string;
  topicLabel: string;
  langs: boolean[];
  missing: number;
};

/**
 * Qaysi kafedrada, qaysi fanda, qaysi mavzuda va qaysi tilda tarqatma
 * yetishmayotganini ko'rsatadigan jadval.
 *
 * Yuqoridagi ro'yxat faqat YUKLANGAN fayllarni ko'rsatadi — u bilan
 * "nima qolib ketgan"ni topib bo'lmaydi. Bu jadval teskarisidan boradi:
 * katalogdagi har bir amaliy mashg'ulotni olib, unga qaysi til yo'qligini
 * belgilaydi. Tarqatma faqat amaliy mashg'ulotlarga yuklanadi, shuning
 * uchun boshqa turdagi mavzular umuman hisobga olinmaydi.
 */
export default function HandoutGapsTable({
  fans,
  rows,
  onPick,
}: {
  fans: CourseSyllabusRow[];
  rows: Array<{ topic_norm: string; language?: string }>;
  onPick?: (fanId: number, topicCode: string) => void;
}) {
  const { t } = useUiText();
  const [deptFilter, setDeptFilter] = useState('');
  const [fanFilter, setFanFilter] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const coverage: TopicCoverage = useMemo(() => buildTopicCoverage(rows), [rows]);

  /** Katalogdagi har bir amaliy mashg'ulot uchun bitta qator. */
  const allRows = useMemo(() => {
    const out: GapRow[] = [];
    for (const fan of fans) {
      const topics = (resolveSyllabusVariants(fan)[0]?.topics ?? []).filter(
        (tp) => tp.type === 'practical',
      );
      if (topics.length === 0) continue;
      const deptName = (fan.department_name || '').trim() || t('admin.liveTestUnassignedSubject');
      for (const tp of topics) {
        const langs = HANDOUT_LANGS.map((l) => topicHasLang(coverage, fan.id, tp.id, l));
        out.push({
          key: `${fan.id}::${tp.id}`,
          deptName,
          fanId: fan.id,
          fanName: fan.subject_name,
          topicLabel: formatTopicDisplayLabel(tp.type, tp.id, tp.title, t),
          langs,
          missing: langs.filter((v) => !v).length,
        });
      }
    }
    return out;
  }, [fans, coverage, t]);

  const deptOptions = useMemo(
    () => [...new Set(allRows.map((r) => r.deptName))].sort((a, b) => a.localeCompare(b)),
    [allRows],
  );

  const fanOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of allRows) {
      if (deptFilter && r.deptName !== deptFilter) continue;
      seen.set(r.fanId, r.fanName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allRows, deptFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const langIdx = langFilter ? HANDOUT_LANGS.indexOf(langFilter as (typeof HANDOUT_LANGS)[number]) : -1;
    return allRows.filter((r) => {
      if (onlyGaps && r.missing === 0) return false;
      if (deptFilter && r.deptName !== deptFilter) return false;
      if (fanFilter && String(r.fanId) !== fanFilter) return false;
      // Til filtri: "shu tilda YO'Q bo'lganlarni ko'rsat".
      if (langIdx >= 0 && r.langs[langIdx]) return false;
      if (q && !`${r.deptName} ${r.fanName} ${r.topicLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, onlyGaps, deptFilter, fanFilter, langFilter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [deptFilter, fanFilter, langFilter, onlyGaps, query]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selectCls =
    'h-10 px-3 rounded-xl border border-slate-200 bg-white text-[13px] text-black/80 min-w-0';

  return (
    <div className="ios-glass rounded-2xl border border-white/60 p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-black/90">{t('admin.gapsTitle')}</p>
          <p className="text-[12px] text-black/50">{t('admin.gapsSubtitle')}</p>
        </div>
        <span className="shrink-0 text-[13px] font-bold px-3 py-1 rounded-full tabular-nums bg-rose-50 text-rose-700">
          {t('admin.gapsCount', { count: filtered.length })}
        </span>
      </div>

      {/* Filtrlar */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setFanFilter(''); }} className={selectCls}>
          <option value="">{t('admin.allKafedraOption')}</option>
          {deptOptions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <select value={fanFilter} onChange={(e) => setFanFilter(e.target.value)} className={selectCls}>
          <option value="">{t('admin.filterAllSubjects')}</option>
          {fanOptions.map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </select>

        <select value={langFilter} onChange={(e) => setLangFilter(e.target.value)} className={selectCls}>
          <option value="">{t('admin.gapsAnyLang')}</option>
          {HANDOUT_LANGS.map((l) => (
            <option key={l} value={l}>{t('admin.gapsMissingLang', { lang: l.toUpperCase() })}</option>
          ))}
        </select>

        <div className="relative min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.gapsSearch')}
            className="w-full h-10 pl-8 pr-3 rounded-xl border border-slate-200 bg-white text-[13px]"
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-[12.5px] text-black/65 cursor-pointer">
        <input
          type="checkbox"
          checked={onlyGaps}
          onChange={(e) => setOnlyGaps(e.target.checked)}
          className="w-4 h-4 rounded border-slate-300"
        />
        {t('admin.gapsOnlyMissing')}
      </label>

      {/* Jadval — ustunlar qat'iy kenglikda, matn kesiladi, qator tushib ketmaydi */}
      <div className="overflow-x-auto rounded-xl border border-black/5">
        <table className="w-full text-left text-[13px] min-w-[720px] table-fixed">
          <thead className="bg-black/[0.03] text-black/55">
            <tr>
              <th className="px-3 py-2 font-semibold w-[22%]">{t('admin.gapsColDept')}</th>
              <th className="px-3 py-2 font-semibold w-[28%]">{t('admin.gapsColSubject')}</th>
              <th className="px-3 py-2 font-semibold w-[34%]">{t('admin.gapsColTopic')}</th>
              <th className="px-3 py-2 font-semibold w-[16%] text-center">{t('admin.gapsColLangs')}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr
                key={r.key}
                className={`border-t border-black/5 ${onPick ? 'cursor-pointer hover:bg-black/[0.025]' : ''}`}
                onClick={onPick ? () => onPick(r.fanId, r.key.split('::')[1]) : undefined}
              >
                <td className="px-3 py-2.5 text-black/60 truncate" title={r.deptName}>{r.deptName}</td>
                <td className="px-3 py-2.5 text-black/80 truncate" title={r.fanName}>{r.fanName}</td>
                <td className="px-3 py-2.5 text-black/80 truncate" title={r.topicLabel}>{r.topicLabel}</td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center justify-center gap-1.5">
                    {HANDOUT_LANGS.map((l, i) => (
                      <span
                        key={l}
                        title={l.toUpperCase()}
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          r.langs[i] ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {l}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-black/40">
                  {t('admin.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sahifalash */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[12px] text-black/50 tabular-nums">
            {t('admin.gapsPageInfo', {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, filtered.length),
              total: filtered.length,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 px-3 h-9 rounded-xl border border-black/10 bg-white text-[13px] font-semibold disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[13px] font-semibold text-black/70 tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 px-3 h-9 rounded-xl border border-black/10 bg-white text-[13px] font-semibold disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
