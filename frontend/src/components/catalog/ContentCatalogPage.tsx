import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  BriefcaseMedical,
  ClipboardList,
  Loader2,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react';
import { AppLanguageContext } from '../../App';
import { useUiText } from '../../i18n/useUiText';
import {
  fetchCatalogItemDetail,
  fetchCatalogItems,
  fetchCatalogSubjects,
  groupCatalogBySubject,
  type CatalogItemDetail,
  type CatalogItemSummary,
  type CatalogKind,
} from '../../utils/contentCatalogApi';
import type { CaseStudySession, TestQuestion, TestSession } from '../../services/aiService';
import { caseFocusBadgeClass, caseFocusLabel } from '../../utils/caseFocusLabels';
import MedicalReferencesList from '../staff/MedicalReferencesList';
import CaseAnswerView from '../staff/CaseAnswerView';
import CaseScenarioView from '../staff/CaseScenarioView';
import { stripOptionLetterPrefix } from '../../utils/testOptionText';

type KindFilter = '' | CatalogKind;

function CatalogDetailPanel({
  detail,
  onClose,
}: {
  detail: CatalogItemDetail;
  onClose: () => void;
}) {
  const { language } = useContext(AppLanguageContext);
  const { t } = useUiText();

  if (detail.kind === 'case') {
    const session = detail.payload as CaseStudySession;
    return (
      <div className="ios-glass rounded-2xl border p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
              {t('catalog.kindCase')}
            </p>
            <h2 className="text-xl font-bold text-black/90 mt-1">{detail.topic}</h2>
            <p className="text-[12px] text-black/45 mt-1">
              {detail.subject_name || t('catalog.otherTopics')} · {detail.author_display_name} ·{' '}
              {new Date(detail.created_at).toLocaleString('uz-UZ')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[13px] font-semibold text-black/50 hover:text-black/80">
            {t('catalog.close')}
          </button>
        </div>
        <div className="space-y-8">
          {session.questions.map((q, i) => (
            <div key={i} className="space-y-3 border-b border-black/5 pb-6 last:border-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-emerald-700">{i + 1}.</span>
                {q.focus && (
                  <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold uppercase ${caseFocusBadgeClass(q.focus)}`}>
                    {caseFocusLabel(q.focus, language)}
                  </span>
                )}
              </div>
              <CaseScenarioView
                text={q.scenario}
                language={language}
                focus={q.focus}
                domain={session.domain}
              />
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-2">{session.domain === 'academic' ? t('case.academicOpinion') : t('case.clinicalOpinion')}</p>
                <CaseAnswerView text={q.answer} />
              </div>
              {q.references && q.references.length > 0 && (
                <MedicalReferencesList references={q.references} title={t('catalog.references')} compact />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const session = detail.payload as TestSession;
  return (
    <div className="ios-glass rounded-2xl border p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">{t('catalog.kindTest')}</p>
          <h2 className="text-xl font-bold text-black/90 mt-1">{detail.topic}</h2>
          <p className="text-[12px] text-black/45 mt-1">
            {detail.subject_name || t('catalog.otherTopics')} · {detail.author_display_name} ·{' '}
            {new Date(detail.created_at).toLocaleString('uz-UZ')}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-[13px] font-semibold text-black/50 hover:text-black/80">
          {t('catalog.close')}
        </button>
      </div>
      {session.references && session.references.length > 0 && (
        <MedicalReferencesList references={session.references} />
      )}
      <div className="space-y-8">
        {session.questions.map((q: TestQuestion, i: number) => (
          <div key={i} className="space-y-3 border-b border-black/5 pb-6 last:border-0">
            <p className="font-bold text-black/90 text-[15px] leading-relaxed">
              {i + 1}. {q.question}
            </p>
            <div className="space-y-1.5">
              {q.options.map((opt, optIdx) => (
                <p
                  key={optIdx}
                  className={`text-[14px] px-3 py-2 rounded-lg border ${
                    optIdx === q.correctOptionIndex
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold'
                      : 'bg-white border-black/10 text-black/75'
                  }`}
                >
                  {String.fromCharCode(65 + optIdx)}) {stripOptionLetterPrefix(opt, optIdx)}
                </p>
              ))}
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-[11px] font-bold uppercase text-blue-800 mb-2">{t('catalog.explanation')}</p>
              <p className="text-[14px] text-blue-900/90 whitespace-pre-wrap">{q.explanation}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContentCatalogPage() {
  const { t, language } = useUiText();
  const [kindFilter, setKindFilter] = useState<KindFilter>('');
  const [subjectCode, setSubjectCode] = useState('');
  const [search, setSearch] = useState('');
  const [author, setAuthor] = useState('');
  const [sort, setSort] = useState<'subject' | 'topic' | 'newest'>('subject');
  const [items, setItems] = useState<CatalogItemSummary[]>([]);
  const [subjects, setSubjects] = useState<Awaited<ReturnType<typeof fetchCatalogSubjects>>>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CatalogItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, subj] = await Promise.all([
        fetchCatalogItems({
          kind: kindFilter,
          subjectCode,
          q: search,
          author,
          sort,
        }),
        fetchCatalogSubjects(),
      ]);
      setItems(rows);
      setSubjects(subj);
    } finally {
      setLoading(false);
    }
  }, [kindFilter, subjectCode, search, author, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => groupCatalogBySubject(items, language), [items, language]);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const row = await fetchCatalogItemDetail(id);
      setDetail(row);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="w-full px-3 sm:px-5 lg:px-6 py-4 pb-20 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-indigo-600 text-white flex items-center justify-center shrink-0">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-black/90">{t('catalog.title')}</h1>
            <p className="text-[13px] text-black/50 mt-1 max-w-2xl">{t('catalog.subtitle')}</p>
            <p className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
              <Clock size={12} /> {t('catalog.delayNotice')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-semibold shrink-0"
        >
          <RefreshCw size={16} /> {t('catalog.refresh')}
        </button>
      </div>

      <div className="ios-glass rounded-2xl border p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['', 'case', 'test'] as KindFilter[]).map((k) => (
            <button
              key={k || 'all'}
              type="button"
              onClick={() => setKindFilter(k)}
              className={`px-4 py-2 rounded-xl text-[13px] font-semibold border ${
                kindFilter === k
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-black/70 border-black/10'
              }`}
            >
              {k === '' ? t('catalog.filterAll') : k === 'case' ? t('catalog.kindCase') : t('catalog.kindTest')}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="space-y-1">
            <span className="text-[11px] font-semibold text-black/45 flex items-center gap-1">
              <Filter size={12} /> {t('catalog.filterSubject')}
            </span>
            <select
              value={subjectCode}
              onChange={(e) => setSubjectCode(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-black/10 bg-white text-[13px]"
            >
              <option value="">{t('catalog.allSubjects')}</option>
              {subjects.map((s) => (
                <option key={s.subject_code || s.subject_name} value={s.subject_code}>
                  {s.subject_name} ({s.total_count})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-semibold text-black/45 flex items-center gap-1">
              <Search size={12} /> {t('catalog.filterSearch')}
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('catalog.searchPlaceholder')}
              className="w-full px-3 py-2.5 rounded-xl border border-black/10 bg-white text-[13px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-semibold text-black/45">{t('catalog.filterAuthor')}</span>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t('catalog.authorPlaceholder')}
              className="w-full px-3 py-2.5 rounded-xl border border-black/10 bg-white text-[13px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-semibold text-black/45">{t('catalog.filterSort')}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="w-full px-3 py-2.5 rounded-xl border border-black/10 bg-white text-[13px]"
            >
              <option value="subject">{t('catalog.sortSubject')}</option>
              <option value="topic">{t('catalog.sortTopic')}</option>
              <option value="newest">{t('catalog.sortNewest')}</option>
            </select>
          </label>
        </div>
      </div>

      {detailLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-indigo-600" size={32} />
        </div>
      )}

      {detail && !detailLoading && <CatalogDetailPanel detail={detail} onClose={() => setDetail(null)} />}

      {!detail && loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-600" size={36} />
        </div>
      )}

      {!detail && !loading && items.length === 0 && (
        <div className="ios-glass rounded-2xl border p-12 text-center text-black/45 text-[14px]">
          {t('catalog.empty')}
        </div>
      )}

      {!detail && !loading && items.length > 0 && (
        <div className="space-y-4">
          {[...grouped.entries()].map(([subjectName, rows]) => {
            const isOpen = expandedSubject === null || expandedSubject === subjectName;
            return (
              <div key={subjectName} className="ios-glass rounded-2xl border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedSubject((s) => (s === subjectName ? null : subjectName))}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/[0.02] hover:bg-black/[0.04]"
                >
                  <div className="flex items-center gap-2 text-left">
                    <BookOpen size={18} className="text-indigo-600 shrink-0" />
                    <span className="font-bold text-black/85">{subjectName}</span>
                    <span className="text-[12px] text-black/40">({rows.length})</span>
                  </div>
                  {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {isOpen && (
                  <div className="divide-y divide-black/5">
                    {rows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => void openDetail(row.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
                      >
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            row.kind === 'case' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-indigo-500/10 text-indigo-700'
                          }`}
                        >
                          {row.kind === 'case' ? <BriefcaseMedical size={18} /> : <ClipboardList size={18} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-black/90 truncate">{row.topic}</p>
                          <p className="text-[12px] text-black/45 mt-0.5">
                            {row.kind === 'case' ? t('catalog.kindCase') : t('catalog.kindTest')} ·{' '}
                            {row.question_count} ta · {row.author_display_name} ·{' '}
                            {new Date(row.created_at).toLocaleDateString('uz-UZ')}
                          </p>
                        </div>
                        <span className="text-[12px] font-semibold text-indigo-600 shrink-0">{t('catalog.view')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
