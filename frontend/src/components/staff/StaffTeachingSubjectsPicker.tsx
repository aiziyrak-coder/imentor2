import React, { useCallback, useEffect, useState } from 'react';
import { Check, GraduationCap, Loader2, Save, Search } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import {
  fetchCourseSyllabusCatalog,
  fetchDepartmentCourseSyllabuses,
  fetchMyCourseSelections,
  isSyncUnavailable,
  setMyTeachingSubjects,
  type CourseSyllabusRow,
} from '../../utils/syllabusApi';
import { syllabusTopicCount } from '../../utils/syllabusVariant';
import {
  instructionLanguageBadge,
  isInternationalSyllabus,
  resolveSyllabusInstructionLanguage,
} from '../../utils/syllabusInstructionLanguage';
import { HttpError } from '../../api/httpClient';
import { staffBtnPrimary } from './staffUi';

export type StaffTeachingSubjectsPickerProps = {
  /** Onboarding: to‘liq ekran sarlavhasi; profile: ixchamroq. */
  variant?: 'onboarding' | 'profile';
  initialSelectedIds?: number[];
  onSaved?: (ids: number[]) => void;
  showHeader?: boolean;
};

function errMessage(err: unknown, t: (k: string) => string): string {
  if (err instanceof HttpError) {
    const detail = (err.body as { detail?: string } | null)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  if (err instanceof Error) {
    if (err.message === 'no-backend-token') return t('teachingSubjects.errorLogin');
    return err.message;
  }
  return t('teachingSubjects.errorSave');
}

export default function StaffTeachingSubjectsPicker({
  variant = 'profile',
  initialSelectedIds,
  onSaved,
  showHeader = true,
}: StaffTeachingSubjectsPickerProps) {
  const { t } = useUiText();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseSyllabusRow[]>([]);
  /**
   * Butun institut katalogi.
   *
   * Ilgari faqat o'z kafedrasidagi fanlar ko'rsatilardi va kafedra bo'sh
   * bo'lsa o'qituvchi oldida boshi berk ko'cha turardi: "Administrator
   * yuklagach paydo bo'ladi". Sillabuslar yuklanganda kafedra yozuvi ikki
   * nusxa bo'lib ketgani uchun 349 xodim aynan shu holatda edi.
   */
  const [catalog, setCatalog] = useState<CourseSyllabusRow[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialSelectedIds ?? []));
  /**
   * O'zbek guruhlari yoki xalqaro (xorijiy talabalar) fanlari.
   *
   * Bir kafedrada ikkalasi aralash turardi: "Marketing, menejment" (o'zbek)
   * va "Marketing management (Xalqaro)" yonma-yon, o'qituvchi noto'g'risini
   * tanlab, ingliz guruhiga o'zbekcha material tayyorlab qo'yardi.
   */
  const [scope, setScope] = useState<'uz' | 'intl'>('uz');
  const [scopeTouched, setScopeTouched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dept, mine, all] = await Promise.all([
        fetchDepartmentCourseSyllabuses(),
        initialSelectedIds == null ? fetchMyCourseSelections() : Promise.resolve(null),
        // Katalog yiqilsa ham kafedra ro'yxati ishlashda davom etsin.
        fetchCourseSyllabusCatalog().catch(() => [] as CourseSyllabusRow[]),
      ]);
      setCourses(dept);
      setCatalog(all);
      if (initialSelectedIds != null) {
        setSelected(new Set(initialSelectedIds));
      } else if (mine) {
        setSelected(new Set(mine.map((s) => s.syllabus.id)));
      }
    } catch (err) {
      if (isSyncUnavailable(err)) {
        setError(t('teachingSubjects.errorRole'));
      } else {
        setError(errMessage(err, t));
      }
      setCourses([]);
    } finally {
      setLoading(false);
    }
  }, [initialSelectedIds, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const ids = Array.from(selected);
      await setMyTeachingSubjects(ids);
      window.dispatchEvent(new CustomEvent('imentor:teaching-subjects-changed'));
      onSaved?.(ids);
    } catch (err) {
      setError(errMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  // Faqat xalqaro fanlari tanlangan o'qituvchi darhol o'z yorlig'ini ko'rsin.
  useEffect(() => {
    if (scopeTouched || selected.size === 0) return;
    const byId = new Map([...catalog, ...courses].map((c) => [c.id, c]));
    const mine = [...selected].map((id) => byId.get(id)).filter(Boolean) as CourseSyllabusRow[];
    if (mine.length > 0 && mine.every(isInternationalSyllabus)) setScope('intl');
  }, [catalog, courses, selected, scopeTouched]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
        <Loader2 size={36} className="animate-spin text-blue-500" />
        <p className="text-sm font-medium">{t('teachingSubjects.loading')}</p>
      </div>
    );
  }

  const isOnboarding = variant === 'onboarding';
  const inScope = (c: CourseSyllabusRow) => isInternationalSyllabus(c) === (scope === 'intl');
  const scopedCourses = courses.filter(inScope);
  const intlTotal = courses.filter(isInternationalSyllabus).length;
  const pickedIn = (intl: boolean) => {
    const byId = new Map([...catalog, ...courses].map((c) => [c.id, c]));
    return [...selected].filter((id) => {
      const c = byId.get(id);
      return c ? isInternationalSyllabus(c) === intl : false;
    }).length;
  };

  return (
    <div className={isOnboarding ? 'w-full max-w-3xl mx-auto space-y-6' : 'space-y-4'}>
      {showHeader && (
        <div className="space-y-1">
          <h2
            id={isOnboarding ? 'teaching-subjects-modal-title' : undefined}
            className={`font-bold tracking-tight text-slate-900 flex items-center gap-2 ${
              isOnboarding ? 'text-xl sm:text-2xl' : 'text-xl'
            }`}
          >
            <GraduationCap className="text-[#083047] shrink-0" size={isOnboarding ? 28 : 22} />
            {isOnboarding ? t('teachingSubjects.onboardingTitle') : t('teachingSubjects.profileTitle')}
          </h2>
          <p className={`text-slate-500 ${isOnboarding ? 'text-sm sm:text-base' : 'text-sm'}`}>
            {isOnboarding ? t('teachingSubjects.onboardingHint') : t('teachingSubjects.profileHint')}
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
        {([
          ['uz', 'O‘zbek guruhlari', courses.length - intlTotal, pickedIn(false)],
          ['intl', 'Xalqaro (xorijiy)', intlTotal, pickedIn(true)],
        ] as const).map(([key, label, total, picked]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={scope === key}
            onClick={() => {
              setScope(key);
              setScopeTouched(true);
            }}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-semibold transition ${
              scope === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span className="truncate">{label}</span>
            <span className="shrink-0 rounded-full bg-slate-200/80 px-1.5 text-[10.5px] tabular-nums text-slate-600">
              {total}
            </span>
            {picked > 0 && (
              <span className="shrink-0 rounded-full bg-blue-100 px-1.5 text-[10.5px] tabular-nums text-blue-700">
                ✓ {picked}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Qidiruv butun katalog bo'yicha: fan boshqa kafedra yozuviga
          biriktirilgan bo'lsa ham o'qituvchi uni topib, o'zi belgilay oladi. */}
      {catalog.length > 0 && (
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-blue-400">
          <Search size={16} className="shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('teachingSubjects.searchPlaceholder')}
            className="w-full bg-transparent py-2.5 text-sm outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-700"
            >
              {t('teachingSubjects.clear')}
            </button>
          )}
        </label>
      )}

      {(() => {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        const own = new Set(courses.map((c) => c.id));
        const hits = catalog
          .filter((c) => !own.has(c.id))
          .filter(inScope)
          .filter((c) => {
            const hay = `${c.subject_name} ${c.department_name || ''} ${c.subject_code}`;
            return hay.toLowerCase().includes(q);
          })
          .slice(0, 60);
        return (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {t('teachingSubjects.otherDepartments')} ({hits.length})
            </p>
            {hits.length === 0 ? (
              <p className="text-xs text-slate-500">{t('teachingSubjects.searchEmpty')}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {hits.map((syllabus) => {
                  const isActive = selected.has(syllabus.id);
                  const topics = syllabusTopicCount(syllabus);
                  return (
                    <button
                      key={syllabus.id}
                      type="button"
                      onClick={() => toggle(syllabus.id)}
                      title={syllabus.department_name ? `${syllabus.subject_name} — ${syllabus.department_name}` : syllabus.subject_name}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition ${
                        isActive
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      {isActive && <Check size={14} className="shrink-0 text-blue-600" />}
                      <span className="max-w-[160px] truncate font-semibold text-slate-900 sm:max-w-[220px]">
                        {syllabus.subject_name}
                      </span>
                      {syllabus.department_name && (
                        <span className="max-w-[120px] shrink-0 truncate text-[9px] text-slate-400">
                          {syllabus.department_name}
                        </span>
                      )}
                      <span className="shrink-0 text-[9px] text-slate-400">
                        {topics} {t('syllabus.topics')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Katalogdan tanlangan fanlar — qidiruv natijasi yo'qolsa ham turadi.
          Kafedrasi bo'sh o'qituvchi uchun bu yagona ro'yxat: ilgari qidiruv
          tozalangach belgilaganlari ko'zdan yo'qolib, nima tanlaganini
          ko'ra olmasdi. Bosilsa tanlovdan chiqadi. */}
      {(() => {
        const own = new Set(courses.map((c) => c.id));
        const byId = new Map(catalog.map((c) => [c.id, c]));
        const picked = [...selected]
          .filter((id) => !own.has(id))
          .map((id) => byId.get(id))
          .filter((c): c is CourseSyllabusRow => Boolean(c));
        if (picked.length === 0) return null;
        return (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {t('teachingSubjects.selectedCount', { count: String(picked.length) })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {picked.map((syllabus) => (
                <button
                  key={syllabus.id}
                  type="button"
                  onClick={() => toggle(syllabus.id)}
                  title={syllabus.subject_name}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-400 bg-blue-50 px-2.5 py-1.5 text-[12px] transition hover:border-rose-300 hover:bg-rose-50"
                >
                  <Check size={14} className="shrink-0 text-blue-600" />
                  <span className="max-w-[160px] truncate font-semibold text-slate-900 sm:max-w-[220px]">
                    {syllabus.subject_name}
                  </span>
                  <span className="shrink-0 text-[9px] text-slate-400">
                    {syllabusTopicCount(syllabus)} {t('syllabus.topics')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {courses.length > 0 && scopedCourses.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-600">
          {scope === 'intl'
            ? 'Kafedrangizda xalqaro guruhlar uchun fan yo‘q. Boshqa kafedra fanini yuqoridagi qidiruvdan toping.'
            : 'Kafedrangizda o‘zbek guruhlari uchun fan yo‘q. Boshqa kafedra fanini yuqoridagi qidiruvdan toping.'}
        </div>
      ) : courses.length === 0 ? (
        <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-4">
          <p className="text-sm font-semibold text-amber-900">{t('teachingSubjects.emptyDept')}</p>
          <p className="text-xs leading-relaxed text-amber-800">
            {catalog.length > 0
              ? t('teachingSubjects.emptyDeptSearch')
              : t('teachingSubjects.emptyDeptHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(() => {
            const groups = new Map<string, typeof courses>();
            for (const syllabus of scopedCourses) {
              const key = (syllabus.direction_code || '').trim() || '__none__';
              const bucket = groups.get(key) || [];
              bucket.push(syllabus);
              groups.set(key, bucket);
            }
            const keys = [...groups.keys()].sort((a, b) => {
              if (a === '__none__') return 1;
              if (b === '__none__') return -1;
              return a.localeCompare(b, 'uz');
            });
            return keys.map((key) => (
              <div key={key} className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {key === '__none__' ? t('admin.directionUnassigned') : key}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {(groups.get(key) || []).map((syllabus) => {
                    const isActive = selected.has(syllabus.id);
                    const topics = syllabusTopicCount(syllabus);
                    return (
                      <button
                        key={syllabus.id}
                        type="button"
                        onClick={() => toggle(syllabus.id)}
                        title={syllabus.subject_name}
                        className={`inline-flex items-center gap-1.5 pl-2.5 pr-2.5 py-1.5 rounded-lg border text-[12px] transition ${
                          isActive
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-slate-200 bg-white hover:border-blue-300'
                        }`}
                      >
                        {isActive && <Check size={14} className="text-blue-600 shrink-0" />}
                        <span className="font-semibold text-slate-900 truncate max-w-[160px] sm:max-w-[220px]">
                          {syllabus.subject_name}
                        </span>
                        <span className="text-[9px] text-slate-500 shrink-0">
                          {instructionLanguageBadge(resolveSyllabusInstructionLanguage(syllabus))}
                        </span>
                        <span className="text-[9px] text-slate-400 shrink-0">
                          {topics} {t('syllabus.topics')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      <div className={`flex ${isOnboarding ? 'justify-center' : 'justify-start'} pt-1`}>
        <button
          type="button"
          onClick={() => void handleSave()}
          // Tanlov bo'lmasa o'chiq — kafedra bo'shligiga qarab EMAS. Ilgari
          // `courses.length === 0` edi: kafedrasi bo'sh o'qituvchi qidiruvdan
          // fan topib belgilar, lekin saqlay olmasdi — qidiruv aynan o'sha
          // o'qituvchi uchun qo'shilgan bo'lsa ham.
          disabled={saving}
          className={`${staffBtnPrimary} px-6 py-3 disabled:opacity-50`}
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {t('teachingSubjects.save')}
        </button>
      </div>
    </div>
  );
}
