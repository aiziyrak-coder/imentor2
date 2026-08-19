import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileText, Image as ImageIcon, Loader2, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import { backendErrorMessage } from '../../utils/apiError';
import { fetchAdminCourseSyllabuses, type CourseSyllabusRow } from '../../utils/syllabusApi';
import { resolveSyllabusVariants } from '../../utils/syllabusVariant';
import { formatTopicLessonLabel } from '../../utils/topicLessonLabel';
import SearchableSelect from './SearchableSelect';
import AdminSmartFilter from './AdminSmartFilter';
import {
  deleteAdminHandout,
  fetchAdminHandouts,
  handoutLanguage,
  uploadAdminHandout,
  HANDOUT_FILE_ACCEPT,
  isAllowedHandoutFile,
  type TopicHandoutItem,
} from '../../utils/handoutApi';
import { generateAndUploadTopicHandouts } from '../../utils/handoutGenerate';
import { useUiText } from '../../i18n/useUiText';
import { languageLabel, type AppLanguage } from '../../i18n/language';

const HANDOUT_LANGS: AppLanguage[] = ['uz', 'ru', 'en'];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function deptKey(fan: CourseSyllabusRow): string {
  if (fan.department != null) return String(fan.department);
  const name = (fan.department_name || '').trim();
  return name ? `name:${name}` : '__none__';
}

function deptName(fan: CourseSyllabusRow, unassigned: string): string {
  return (fan.department_name || '').trim() || unassigned;
}

function topicLessonKind(topicNorm: string): 'lecture' | 'practical' | 'clinical' | 'independent' | 'lab' | '' {
  const code = (topicNorm.split('::')[2] || '').toUpperCase();
  if (/^L\d/i.test(code) || /^M\d/i.test(code)) return 'lecture';
  if (/^A\d/i.test(code) || /^P\d/i.test(code)) return 'practical';
  if (/^K\d/i.test(code)) return 'clinical';
  if (/^I\d/i.test(code)) return 'independent';
  if (/^B\d/i.test(code)) return 'lab';
  return '';
}

export default function AdminTopicHandouts() {
  const { t } = useUiText();
  const [fans, setFans] = useState<CourseSyllabusRow[]>([]);
  const [handouts, setHandouts] = useState<TopicHandoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deptId, setDeptId] = useState('');
  const [fanId, setFanId] = useState('');
  const [variantLabel, setVariantLabel] = useState('');
  const [topicCode, setTopicCode] = useState('');
  const [filesByLang, setFilesByLang] = useState<Record<AppLanguage, File[]>>({
    uz: [],
    ru: [],
    en: [],
  });
  const [savingAll, setSavingAll] = useState(false);
  const [saveProgress, setSaveProgress] = useState('');
  const [saveOk, setSaveOk] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState('');

  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [fanFilter, setFanFilter] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [lessonFilter, setLessonFilter] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fanRows, rows] = await Promise.all([fetchAdminCourseSyllabuses(), fetchAdminHandouts()]);
      setFans(fanRows);
      setHandouts(rows);
    } catch {
      setError(t('admin.error.loadFailed'));
      setFans([]);
      setHandouts([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const departments = useMemo(() => {
    const unassigned = t('admin.departmentUnassigned');
    const map = new Map<string, string>();
    for (const f of fans) {
      const key = deptKey(f);
      if (!map.has(key)) map.set(key, deptName(f, unassigned));
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [fans, t]);

  const fansForDept = useMemo(() => {
    if (!deptId) return [];
    return fans.filter((f) => deptKey(f) === deptId);
  }, [fans, deptId]);

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
    setFanId('');
    setTopicCode('');
  }, [deptId]);

  useEffect(() => {
    setVariantLabel(variants[0]?.label ?? '');
    setTopicCode('');
  }, [variants]);

  useEffect(() => {
    setTopicCode('');
  }, [variantLabel]);

  const fanById = useMemo(() => {
    const m = new Map<number, CourseSyllabusRow>();
    for (const f of fans) m.set(f.id, f);
    return m;
  }, [fans]);

  const fanNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of fans) m.set(f.id, f.subject_name);
    return m;
  }, [fans]);

  const unassignedDept = t('admin.departmentUnassigned');

  const deptFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of handouts) {
      const sid = Number((h.topic_norm || '').split('::')[0]);
      const fan = fanById.get(sid);
      const key = fan ? deptKey(fan) : '__none__';
      const name = fan ? deptName(fan, unassignedDept) : unassignedDept;
      map.set(key, name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }, [handouts, fanById, unassignedDept]);

  const fanFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of handouts) {
      const sid = (h.topic_norm || '').split('::')[0];
      if (!sid) continue;
      const fan = fanById.get(Number(sid));
      if (deptFilter && fan && deptKey(fan) !== deptFilter) continue;
      if (deptFilter && !fan && deptFilter !== '__none__') continue;
      m.set(sid, fanNameById.get(Number(sid)) || sid);
    }
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [handouts, fanNameById, fanById, deptFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return handouts.filter((h) => {
      const sid = (h.topic_norm || '').split('::')[0];
      const fan = fanById.get(Number(sid));
      if (deptFilter) {
        const key = fan ? deptKey(fan) : '__none__';
        if (key !== deptFilter) return false;
      }
      if (fanFilter && sid !== fanFilter) return false;
      if (langFilter && handoutLanguage(h) !== langFilter) return false;
      if (kindFilter && h.kind !== kindFilter) return false;
      if (lessonFilter && topicLessonKind(h.topic_norm || '') !== lessonFilter) return false;
      if (q) {
        const fanName = fanNameById.get(Number(sid)) || '';
        const hay = `${h.topic} ${h.title} ${h.file_name} ${fanName} ${handoutLanguage(h)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [handouts, search, deptFilter, fanFilter, langFilter, kindFilter, lessonFilter, fanNameById, fanById]);

  const grouped = useMemo(() => {
    const map = new Map<string, { fanName: string; topic: string; rows: TopicHandoutItem[] }>();
    for (const h of filtered) {
      const parts = (h.topic_norm || '').split('::');
      const syllabusId = Number(parts[0]);
      const code = (parts[2] || '').toUpperCase();
      const fanName = fanNameById.get(syllabusId) || t('catalog.otherTopics');
      const key = h.topic_norm || `${fanName}||${h.topic}`;
      const label = code ? `${code} · ${h.topic}` : h.topic;
      if (!map.has(key)) map.set(key, { fanName, topic: label, rows: [] });
      map.get(key)!.rows.push(h);
    }
    return [...map.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => a.fanName.localeCompare(b.fanName) || a.topic.localeCompare(b.topic));
  }, [filtered, fanNameById, t]);

  const pendingCount = HANDOUT_LANGS.reduce((n, lang) => n + filesByLang[lang].length, 0);

  const saveAllHandouts = async () => {
    if (!topicReady) {
      setError(t('admin.handoutNeedTopic'));
      return;
    }
    if (pendingCount === 0) {
      setError(t('admin.handoutNeedFiles'));
      return;
    }
    const topic = topics.find((tp) => tp.id === topicCode);
    if (!topic || !fanId || !variantLabel) return;
    setSavingAll(true);
    setError(null);
    setSaveOk('');
    try {
      let uploaded = 0;
      for (const lang of HANDOUT_LANGS) {
        const files = filesByLang[lang];
        for (let i = 0; i < files.length; i++) {
          setSaveProgress(
            t('admin.handoutSavingProgress', {
              lang: languageLabel(lang),
              current: String(uploaded + 1),
              total: String(pendingCount),
            }),
          );
          await uploadAdminHandout({
            syllabusId: Number(fanId),
            variantLabel,
            topicCode,
            topic: topic.title,
            language: lang,
            file: files[i],
          });
          uploaded += 1;
        }
      }
      setFilesByLang({ uz: [], ru: [], en: [] });
      setHandouts(await fetchAdminHandouts());
      setSaveOk(
        t('admin.handoutSavedToTopic', {
          count: String(uploaded),
          topic: `${formatTopicLessonLabel(topic.type, topic.id, t)} · ${topic.title}`,
          subject: selectedFan?.subject_name || '',
        }),
      );
    } catch (err) {
      setError(backendErrorMessage(err) || t('admin.error.handoutAddFailed'));
    } finally {
      setSavingAll(false);
      setSaveProgress('');
    }
  };

  const removeHandout = async (id: number) => {
    const pk = Number(id);
    if (!pk || deletingId === pk) return;
    setDeletingId(pk);
    setError(null);
    try {
      await deleteAdminHandout(pk);
      setHandouts((prev) => prev.filter((h) => Number(h.id) !== pk));
    } catch (err) {
      setError(backendErrorMessage(err) || t('admin.error.deleteFailedGeneric'));
    } finally {
      setDeletingId(null);
    }
  };

  const topicReady = Boolean(fanId && variantLabel && topicCode);
  const busy = savingAll || generating;
  const selectedTopic = topics.find((tp) => tp.id === topicCode) || null;

  const generateHandouts = async () => {
    const topic = topics.find((tp) => tp.id === topicCode);
    if (!selectedFan || !topic || !variantLabel) return;
    setGenerating(true);
    setError(null);
    setGenProgress(t('handout.progressAi'));
    try {
      await generateAndUploadTopicHandouts({
        topicTitle: topic.title,
        topicId: topic.id,
        topicType: topic.type,
        subjectName: selectedFan.subject_name,
        subjectCode: selectedFan.subject_code,
        topic: topic.title,
        mode: 'admin',
        syllabusId: selectedFan.id,
        variantLabel,
        onProgress: (stage, lang) => {
          if (stage === 'ai') setGenProgress(t('handout.progressAi'));
          else if (stage === 'render') setGenProgress(t('handout.progressRender', { lang: (lang || '').toUpperCase() }));
          else setGenProgress(t('handout.progressUpload', { lang: (lang || '').toUpperCase() }));
        },
      });
      setHandouts(await fetchAdminHandouts());
    } catch (err) {
      setError(backendErrorMessage(err) || t('handout.errorGenerate'));
    } finally {
      setGenerating(false);
      setGenProgress('');
    }
  };

  return (
    <div className="p-3 sm:p-5 lg:p-6 h-full overflow-y-auto w-full space-y-6">
      <div className="ios-glass rounded-3xl border border-white/70 p-6 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-600 text-white flex items-center justify-center">
            <FileText size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('admin.handoutsTitle')}</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">{t('admin.handoutsSubtitle')}</p>
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

      <div className="ios-glass rounded-2xl border border-white/70 p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">1 · {t('admin.department')}</span>
            <SearchableSelect
              value={deptId}
              onChange={setDeptId}
              disabled={busy}
              placeholder={t('admin.selectDepartmentPlaceholder')}
              noMatchText={t('admin.noResults')}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">2 · {t('admin.subjectName')}</span>
            <SearchableSelect
              value={fanId}
              onChange={setFanId}
              disabled={busy || !deptId}
              placeholder={t('admin.selectSubjectPlaceholder')}
              noMatchText={t('admin.noResults')}
              options={fansForDept.map((f) => ({ value: String(f.id), label: f.subject_name }))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">3 · {t('admin.topicLabel')}</span>
            <select
              value={topicCode}
              onChange={(e) => setTopicCode(e.target.value)}
              disabled={busy || !fanId || topics.length === 0}
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white text-[13px] disabled:bg-slate-50"
            >
              <option value="">{t('admin.selectTopicPlaceholder')}</option>
              {topics.map((tp) => (
                <option key={`${tp.type}-${tp.id}`} value={tp.id}>
                  {formatTopicLessonLabel(tp.type, tp.id, t)} · {tp.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-[12px] text-slate-500">{t('admin.handoutLangHint')}</p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void generateHandouts()}
            disabled={!topicReady || busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#083047] text-white text-[13px] font-semibold disabled:opacity-40"
          >
            {generating ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
            {generating ? t('handout.generating') : t('admin.generateHandout')}
          </button>
          {genProgress ? <span className="text-[12px] text-slate-600 font-medium">{genProgress}</span> : (
            <span className="text-[12px] text-slate-400">{t('admin.generateHandoutHint')}</span>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {HANDOUT_LANGS.map((lang) => {
            const files = filesByLang[lang];
            return (
              <div key={lang} className="rounded-2xl border border-slate-200 bg-white/80 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-bold text-slate-800">{languageLabel(lang)}</p>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{lang}</span>
                </div>
                {files.length > 0 ? (
                  <ul className="space-y-1">
                    {files.map((f, i) => (
                      <li key={`${lang}-${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5">
                        <FileText size={13} className="text-slate-500 shrink-0" />
                        <span className="text-[12px] text-slate-700 truncate flex-1">{f.name}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">{formatSize(f.size)}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setFilesByLang((prev) => ({
                              ...prev,
                              [lang]: prev[lang].filter((_, idx) => idx !== i),
                            }))
                          }
                          disabled={busy}
                          className="p-1 text-rose-400 hover:text-rose-600 disabled:opacity-40"
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-slate-400">{t('admin.handoutLangEmpty')}</p>
                )}
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-700 cursor-pointer">
                  <Upload size={14} />
                  {t('admin.chooseFiles')}
                  <input
                    type="file"
                    accept={HANDOUT_FILE_ACCEPT}
                    multiple
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []).filter(isAllowedHandoutFile);
                      if (picked.length) {
                        setFilesByLang((prev) => ({ ...prev, [lang]: [...prev[lang], ...picked] }));
                        setError(null);
                        setSaveOk('');
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 space-y-2">
          <p className="text-[12px] text-slate-600">
            {selectedTopic && selectedFan
              ? t('admin.handoutAttachTarget', {
                  subject: selectedFan.subject_name,
                  topic: `${formatTopicLessonLabel(selectedTopic.type, selectedTopic.id, t)} · ${selectedTopic.title}`,
                })
              : t('admin.handoutNeedTopic')}
            {pendingCount > 0
              ? ` · ${t('admin.handoutPendingCount', { count: String(pendingCount) })}`
              : ''}
          </p>
          <button
            type="button"
            onClick={() => void saveAllHandouts()}
            disabled={busy || pendingCount === 0 || !topicReady}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 text-white text-[14px] font-bold disabled:opacity-40"
          >
            {savingAll ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
            {savingAll ? t('admin.handoutSaving') : t('admin.handoutSaveApply')}
          </button>
          {saveProgress ? <p className="text-[12px] text-slate-600 font-medium">{saveProgress}</p> : null}
        </div>
        {saveOk ? (
          <p className="text-[13px] text-emerald-700 font-semibold">{saveOk}</p>
        ) : null}
        {error && <p className="text-[13px] text-rose-600 font-medium">{error}</p>}
      </div>

      {!loading && handouts.length > 0 && (
        <AdminSmartFilter
          search={search}
          onSearch={setSearch}
          searchPlaceholder={t('admin.handoutsSearchPlaceholder')}
          selects={[
            {
              id: 'dept',
              label: t('admin.filterByKafedra'),
              value: deptFilter,
              onChange: (v) => {
                setDeptFilter(v);
                setFanFilter('');
              },
              options: deptFilterOptions,
              placeholder: t('admin.filterAllDepartments'),
            },
            {
              id: 'fan',
              label: t('admin.filterSubject'),
              value: fanFilter,
              onChange: setFanFilter,
              options: fanFilterOptions,
              placeholder: t('admin.filterAllSubjects'),
            },
          ]}
          chips={[
            {
              id: 'lang',
              label: t('admin.filterLanguage'),
              value: langFilter,
              onChange: setLangFilter,
              options: [
                { value: '', label: t('admin.filterAllLanguages') },
                { value: 'uz', label: languageLabel('uz') },
                { value: 'ru', label: languageLabel('ru') },
                { value: 'en', label: languageLabel('en') },
              ],
            },
            {
              id: 'kind',
              label: t('admin.filterFileType'),
              value: kindFilter,
              onChange: setKindFilter,
              options: [
                { value: '', label: t('admin.filterAllTypes') },
                { value: 'image', label: t('admin.filterImage') },
                { value: 'pdf', label: t('admin.filterPdf') },
              ],
            },
            {
              id: 'lesson',
              label: t('admin.filterLessonType'),
              value: lessonFilter,
              onChange: setLessonFilter,
              options: [
                { value: '', label: t('admin.filterAllLessons') },
                { value: 'lecture', label: t('admin.filterLecture') },
                { value: 'practical', label: t('admin.filterPractical') },
                { value: 'clinical', label: t('admin.filterClinical') },
                { value: 'independent', label: t('admin.filterIndependent') },
                { value: 'lab', label: t('admin.filterLab') },
              ],
            },
          ]}
          resultText={t('admin.filterResultFiles', {
            files: String(filtered.length),
            topics: String(grouped.length),
          })}
          resetLabel={t('admin.clearFilters')}
          noMatchText={t('admin.noResults')}
          canReset={Boolean(search || deptFilter || fanFilter || langFilter || kindFilter || lessonFilter)}
          onReset={() => {
            setSearch('');
            setDeptFilter('');
            setFanFilter('');
            setLangFilter('');
            setKindFilter('');
            setLessonFilter('');
          }}
        />
      )}

      {/* Ro'yxat */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
        </div>
      ) : handouts.length === 0 ? (
        <div className="ios-glass rounded-2xl border p-10 text-center text-slate-400 text-[14px]">
          {t('admin.handoutsEmpty')}
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
                {g.rows.map((h) => {
                  const hid = Number(h.id);
                  const isDeleting = deletingId === hid;
                  return (
                  <li key={hid} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        h.kind === 'pdf' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'
                      }`}
                    >
                      {h.kind === 'pdf' ? <FileText size={18} /> : <ImageIcon size={18} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{h.title || h.file_name}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {languageLabel(handoutLanguage(h))} · {h.file_name} · {formatSize(h.file_size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => void removeHandout(hid)}
                      className="p-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 shrink-0 disabled:opacity-50"
                      title={t('admin.delete')}
                      aria-label={t('admin.delete')}
                    >
                      {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                  </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
