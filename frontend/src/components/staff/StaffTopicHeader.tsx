import { useContext, type ReactNode } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { AppNavigationContext } from '../../App';
import type { SyllabusTopicType } from '../../services/aiService';
import { formatTopicLessonLabel, stripRedundantTopicNumber } from '../../utils/topicLessonLabel';
import { useUiText } from '../../i18n/useUiText';
import { staffEyebrow } from './staffUi';

export type StaffTopicInfo = {
  id: string;
  title: string;
  type: SyllabusTopicType;
  subjectName?: string;
  variantLabel?: string;
};

type Props = {
  /**
   * Bo'lim nomi ("Ma'ruza matni").
   *
   * Endi CHIZILMAYDI: sahifa sarlavhasi allaqachon shuni aytadi va bu
   * yerda takrorlanganda bir xil yozuv ustma-ust ikki marta chiqardi.
   * Prop saqlanib qoldi — sakkizta chaqiruvchini o'zgartirmaslik uchun.
   */
  moduleLabel?: string;
  topic: StaffTopicInfo | null;
  hint?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

/**
 * Ustida ishlanayotgan mavzu.
 *
 * Ilgari bu ham kartochka edi: oq quti ichida fan nomi kulrang tabletkada,
 * dars turi qora tabletkada, ustida yana bir mayda yozuv. To'rt qavat
 * bezak — aslida aytilayotgani esa bitta jumla: "shu fanning shu mavzusi".
 *
 * Endi quti ham, tabletka ham yo'q. Bitta mayda satr kontekstni aytadi
 * (fan · dars turi), ostida mavzu nomi to'q harflarda turadi.
 * Sahifaning qolganini ingichka chiziq ajratadi.
 */
export default function StaffTopicHeader({ topic, hint, actions, children }: Props) {
  const { t } = useUiText();
  const { openSyllabus } = useContext(AppNavigationContext);
  const lessonLabel = topic ? formatTopicLessonLabel(topic.type, topic.id, t) : '';

  const crumbs = [topic?.subjectName, lessonLabel].filter(Boolean) as string[];

  return (
    <div className="space-y-4 border-b border-slate-900/10 pb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${staffEyebrow}`}>
            {crumbs.map((crumb, i) => (
              <span key={crumb} className="flex items-center gap-2">
                {i > 0 && <span className="text-slate-300">·</span>}
                {crumb}
              </span>
            ))}
          </p>
          {/* Kenglik cheklangan: keng ekranda mavzu nomi bir metrga cho'zilib,
              sahifadagi eng baland ovozli narsaga aylanardi — sahifa
              sarlavhasidan ham qalinroq ko'rinardi. */}
          {topic && (
            <h2 className="mt-1.5 max-w-[78ch] text-[15px] font-semibold leading-snug text-slate-800 sm:text-[16px]">
              {stripRedundantTopicNumber(topic.title, topic.id)}
            </h2>
          )}
          {/* Mavzu tanlangach o'qituvchi yana SHU bo'limga qaytadi (App: lastModuleRef). */}
          <button
            type="button"
            onClick={openSyllabus}
            className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-sky-700 hover:text-sky-900"
          >
            <ArrowLeftRight size={13} />
            {t('syllabus.changeTopic')}
          </button>
          {hint && <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-slate-500">{hint}</p>}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
