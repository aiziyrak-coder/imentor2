import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  BriefcaseMedical,
  Check,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  HeartPulse,
  Languages,
  Menu,
  Play,
  Presentation,
  QrCode,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import type { AppLanguage } from '../../i18n/language';
import { languageLabel } from '../../i18n/language';
import { translate, type UiTextKey } from '../../i18n/translations';
import LoginPage from '../auth/LoginPage';
import RegisterPage from '../auth/RegisterPage';
import DesktopHodimQrLogin from '../auth/DesktopHodimQrLogin';
import MobileMinimalLogin from '../auth/MobileMinimalLogin';
import { isDesktopBrowser } from '../../utils/deviceDetection';
import { fetchPublicCatalogTotals, type CatalogStatsTotals } from '../../utils/contentCatalogApi';

type AuthScreen = 'login' | 'register';

type DesktopAuthView = 'face' | 'qr' | 'password';

type Props = {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  isMobileDevice: boolean;
  desktopAuthView: DesktopAuthView;
  setDesktopAuthView: (v: DesktopAuthView) => void;
};

/** Barcha bo'limlarning umumiy kengligi va chetki bo'shlig'i. */
const SHELL = 'mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8';

const LANGS: AppLanguage[] = ['uz', 'ru', 'en'];

/**
 * Logodagi belgi (kaduser + lampochka). Rasm keng (1024x558, ostida yozuv bor),
 * kvadratga `object-cover` qilinsa belgi mayda chiqardi — shu sabab faqat
 * belgining o'zi kesib ko'rsatiladi.
 */
function BrandMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-xl bg-white bg-no-repeat ring-1 ring-slate-200 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: 'url(/imentor-logo.png)',
        backgroundSize: '440% auto',
        backgroundPosition: '50% 24%',
      }}
    />
  );
}

/** Pastdan chiqib keladigan bo'lim. Harakatni kamaytirish yoqilgan bo'lsa — joyida. */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  align?: 'center' | 'left';
}) {
  const centered = align === 'center';
  return (
    <Reveal className={centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-teal-600">{eyebrow}</p>
      <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-slate-900 sm:text-[2.25rem]">
        {title}
      </h2>
      {subtitle ? <p className="mt-4 text-[15px] leading-relaxed text-slate-600 sm:text-base">{subtitle}</p> : null}
    </Reveal>
  );
}

/** Raqam ko'rinishga kirganda 0 dan sanab chiqadi. */
function CountUp({ value, locale }: { value: number; locale: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(value);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const duration = 1100;
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduce, value]);

  return (
    <span ref={ref} className="tabular-nums">
      {new Intl.NumberFormat(locale).format(shown)}
    </span>
  );
}

/** Dekorativ QR — haqiqiy kod emas, faqat ko'rinish uchun. */
function MiniQr({ size = 56 }: { size?: number }) {
  const n = 11;
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const inFinder = (x < 3 && y < 3) || (x > n - 4 && y < 3) || (x < 3 && y > n - 4);
      if (inFinder) continue;
      if (((x * 7 + y * 13 + x * y) % 5) < 2) cells.push([x, y]);
    }
  }
  const finder = (fx: number, fy: number) => (
    <g key={`${fx}-${fy}`}>
      <rect x={fx} y={fy} width={3} height={3} rx={0.5} fill="#0b3a6e" />
      <rect x={fx + 0.7} y={fy + 0.7} width={1.6} height={1.6} rx={0.3} fill="#fff" />
      <rect x={fx + 1.05} y={fy + 1.05} width={0.9} height={0.9} fill="#0b3a6e" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} aria-hidden="true">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} rx={0.15} fill="#0b3a6e" />
      ))}
      {finder(0, 0)}
      {finder(n - 3, 0)}
      {finder(0, n - 3)}
    </svg>
  );
}

function HeroMockup({ language }: { language: AppLanguage }) {
  const tr = (key: UiTextKey) => translate(language, key);
  const tabs: Array<{ icon: React.ElementType; label: string; active?: boolean }> = [
    { icon: FileText, label: tr('landing.mockLecture'), active: true },
    { icon: BriefcaseMedical, label: tr('landing.mockCases') },
    { icon: ClipboardList, label: tr('landing.mockTests') },
    { icon: Presentation, label: tr('landing.mockSlides') },
    { icon: Video, label: tr('landing.mockVideo') },
  ];
  const lines = [
    ['100%', '0s'],
    ['92%', '0.35s'],
    ['97%', '0.7s'],
    ['64%', '1.05s'],
  ];
  const lines2 = [
    ['95%', '1.6s'],
    ['88%', '1.95s'],
    ['72%', '2.3s'],
  ];

  return (
    <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none" aria-hidden="true">
      <div className="lp-window overflow-hidden rounded-2xl">
        {/* Oyna sarlavhasi */}
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          </div>
          <div className="mx-auto flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
            <BrandMark size={16} className="!rounded-[4px] !ring-0" />
            imentor.uz
          </div>
          <div className="w-10" />
        </div>

        <div className="flex">
          {/* Chap panel: bo'limlar */}
          <div className="hidden w-[132px] shrink-0 border-r border-slate-100 bg-slate-50/40 p-2.5 sm:block">
            {tabs.map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className={`mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium ${
                  active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'
                }`}
              >
                <Icon size={14} className={active ? 'text-teal-600' : 'text-slate-400'} />
                {label}
              </div>
            ))}
          </div>

          {/* Asosiy qism */}
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <p className="text-[11px] font-medium text-slate-400">{tr('landing.mockSubject')}</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="truncate text-[17px] font-semibold tracking-tight text-slate-900">{tr('landing.mockTopic')}</p>
              <div className="flex shrink-0 gap-1">
                {(['UZ', 'RU', 'EN'] as const).map((code, i) => (
                  <span
                    key={code}
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                      i === 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {code}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-[11.5px] font-medium text-teal-700">
              <Sparkles size={13} />
              {tr('landing.mockWriting')}
              <span className="lp-caret ml-[-2px] inline-block h-3.5 w-[2px] bg-teal-600" />
            </div>

            <p className="mt-3 text-[12.5px] font-semibold text-slate-800">{tr('landing.mockSection1')}</p>
            <div className="mt-2 space-y-2">
              {lines.map(([w, d]) => (
                <div key={d} className="lp-line" style={{ width: w, animationDelay: d }} />
              ))}
            </div>
            <p className="mt-4 text-[12.5px] font-semibold text-slate-800">{tr('landing.mockSection2')}</p>
            <div className="mt-2 space-y-2">
              {lines2.map(([w, d]) => (
                <div key={d} className="lp-line" style={{ width: w, animationDelay: d }} />
              ))}
            </div>

            <div className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800 ring-1 ring-sky-100">
              <BookOpen size={12} />
              {tr('landing.mockSource')}
            </div>
          </div>
        </div>
      </div>

      {/* Suzuvchi kartalar */}
      <div className="lp-float absolute -bottom-6 -left-3 hidden rounded-xl bg-white px-3.5 py-2.5 shadow-xl ring-1 ring-slate-900/5 sm:flex sm:items-center sm:gap-2.5 lg:-left-8">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
          <Check size={17} strokeWidth={2.5} />
        </span>
        <span className="text-[12.5px] font-semibold text-slate-800">{tr('landing.mockTestReady')}</span>
      </div>
      <div
        className="lp-float absolute -right-3 -top-6 hidden items-center gap-3 rounded-xl bg-white p-2.5 pr-4 shadow-xl ring-1 ring-slate-900/5 sm:flex lg:-right-6"
        style={{ animationDelay: '-3.5s' }}
      >
        <div className="rounded-lg bg-white p-1 ring-1 ring-slate-200">
          <MiniQr size={44} />
        </div>
        <div>
          <p className="text-[12.5px] font-semibold text-slate-800">{tr('landing.mockLiveQr')}</p>
          <p className="text-[11px] text-slate-500">{tr('landing.mockLiveQrHint')}</p>
        </div>
      </div>
    </div>
  );
}

function BentoCard({
  icon: Icon,
  title,
  desc,
  className = '',
  children,
  delay = 0,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  className?: string;
  children?: React.ReactNode;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className={`lp-card group flex flex-col overflow-hidden rounded-2xl ${className}`}>
      <div className="p-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Icon size={19} />
        </span>
        <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-slate-900">{title}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{desc}</p>
      </div>
      {children ? <div className="mt-auto px-6 pb-6">{children}</div> : null}
    </Reveal>
  );
}

export default function PublicLandingPage({
  language,
  setLanguage,
  isMobileDevice,
  desktopAuthView,
  setDesktopAuthView,
}: Props) {
  const tr = useCallback((key: UiTextKey) => translate(language, key), [language]);
  const reduce = useReducedMotion();
  const [authOpen, setAuthOpen] = useState(false);
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [totals, setTotals] = useState<CatalogStatsTotals | null>(null);

  const openAuth = useCallback(
    (screen: AuthScreen = 'login') => {
      setAuthScreen(screen);
      // Kompyuterda kirish har safar QR'dan boshlanadi. Yuz skaneri faqat telefonda:
      // telefon yuzni tekshiradi va joylashuvni ham o'sha yerdan oladi (2026-09-18).
      if (screen === 'login') setDesktopAuthView('qr');
      setMenuOpen(false);
      setAuthOpen(true);
    },
    [setDesktopAuthView],
  );

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchPublicCatalogTotals()
      .then((t) => {
        if (alive && t && t.total_count > 0) setTotals(t);
      })
      .catch(() => {
        // Raqamlar kelmasa — bo'lim shunchaki ko'rsatilmaydi.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!authOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAuthOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authOpen]);

  const numberLocale = language === 'en' ? 'en-US' : 'ru-RU';

  const nav: Array<{ id: string; label: string }> = [
    { id: 'features', label: tr('publicLanding.navFeatures') },
    { id: 'how-it-works', label: tr('publicLanding.navHowItWorks') },
  ];

  const stats = totals
    ? [
        { value: totals.total_count, label: tr('landing.statMaterials') },
        { value: totals.questions_total, label: tr('landing.statQuestions') },
        { value: totals.subjects_distinct, label: tr('landing.statSubjects') },
        { value: totals.authors_distinct, label: tr('landing.statAuthors') },
      ]
    : null;

  const steps = [
    { icon: QrCode, title: tr('landing.step1Title'), desc: tr('landing.step1Desc') },
    { icon: BookOpen, title: tr('landing.step2Title'), desc: tr('landing.step2Desc') },
    { icon: Sparkles, title: tr('landing.step3Title'), desc: tr('landing.step3Desc') },
  ];

  return (
    <div className="min-h-[100dvh] w-full overflow-x-clip bg-[#f7fafc] text-slate-900 antialiased selection:bg-teal-200/60">
      {/* ─────────────── Header ─────────────── */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,border-color] duration-300 ${
          scrolled || menuOpen
            ? 'border-b border-slate-200/70 bg-white/85 shadow-[0_1px_12px_-6px_rgba(15,23,42,0.15)] backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent'
        }`}
      >
        <div className={`${SHELL} flex h-16 items-center justify-between gap-3`}>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })}
            className="flex items-center gap-2.5"
          >
            <BrandMark />
            <span className="text-[17px] font-semibold tracking-tight text-slate-900">iMentor</span>
            <span className="hidden rounded-md bg-slate-900/[0.06] px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600 sm:inline">
              FJSTI
            </span>
          </button>

          <nav className="hidden items-center gap-1 md:flex" aria-label={tr('shell.mainMenu')}>
            {nav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollTo(item.id)}
                className="rounded-lg px-3 py-2 text-[14px] font-medium text-slate-600 transition-colors hover:bg-slate-900/[0.04] hover:text-slate-900"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label={tr('shell.languageAria')}
              className="flex rounded-lg bg-slate-900/[0.05] p-0.5"
            >
              {LANGS.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLanguage(code)}
                  aria-pressed={language === code}
                  aria-label={languageLabel(code)}
                  className={`h-8 rounded-md px-2 text-[11.5px] font-semibold uppercase transition ${
                    language === code ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="lp-primary hidden h-9 items-center rounded-lg px-4 text-[14px] font-semibold text-white sm:inline-flex"
            >
              {tr('publicLanding.login')}
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={tr('shell.mainMenu')}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-900/[0.05] md:hidden"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Telefon menyusi */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden border-t border-slate-200/70 md:hidden"
            >
              <div className={`${SHELL} flex flex-col gap-1 py-3`}>
                {nav.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollTo(item.id)}
                    className="rounded-lg px-3 py-3 text-left text-[15px] font-medium text-slate-700 hover:bg-slate-900/[0.04]"
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => openAuth('login')}
                  className="lp-primary mt-2 flex h-12 items-center justify-center rounded-xl text-[15px] font-semibold text-white"
                >
                  {tr('landing.ctaLogin')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main>
        {/* ─────────────── Hero ─────────────── */}
        <section className="lp-hero-bg relative">
          <div className="lp-grid pointer-events-none absolute inset-0" />
          <div className={`${SHELL} relative grid items-center gap-14 pb-20 pt-28 sm:pt-32 lg:grid-cols-[1.02fr_1fr] lg:gap-12 lg:pb-28 lg:pt-40`}>
            <div className="text-center lg:text-left">
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-[12.5px] font-medium text-slate-700 ring-1 ring-slate-900/[0.08] backdrop-blur"
              >
                <span className="lp-pulse-dot h-2 w-2 rounded-full bg-teal-500" />
                {tr('landing.eyebrow')}
              </motion.div>

              <motion.h1
                initial={reduce ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
                className="mt-6 text-[2.35rem] font-semibold leading-[1.06] tracking-[-0.035em] text-slate-900 sm:text-[3.25rem] lg:text-[3.15rem] xl:text-[3.7rem]"
              >
                {tr('landing.heroTitle').replace(/ (\S+)$/, '\u00A0$1')} <span className="lp-accent">{tr('landing.heroAccent')}</span>
              </motion.h1>

              <motion.p
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.14 }}
                className="mx-auto mt-6 max-w-[560px] text-[16px] leading-relaxed text-slate-600 sm:text-[17.5px] lg:mx-0"
              >
                {tr('landing.heroSubtitle')}
              </motion.p>

              <motion.div
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.22 }}
                className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center lg:justify-start"
              >
                <button
                  type="button"
                  onClick={() => openAuth('login')}
                  className="lp-primary inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-white"
                >
                  {tr('landing.ctaLogin')}
                  <ArrowRight size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => scrollTo('how-it-works')}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-slate-800 ring-1 ring-slate-900/10 transition hover:bg-slate-50 hover:ring-slate-900/20"
                >
                  <BookOpen size={17} className="text-teal-600" />
                  {tr('publicLanding.navHowItWorks')}
                </button>
              </motion.div>

              <motion.ul
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.32 }}
                className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13.5px] text-slate-600 lg:justify-start"
              >
                {[tr('landing.trustQr'), tr('landing.trustLangs'), tr('landing.trustOwn')].map((label) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <Check size={15} strokeWidth={2.5} className="text-teal-600" />
                    {label}
                  </li>
                ))}
              </motion.ul>
            </div>

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="px-2 sm:px-6 lg:px-0"
            >
              <HeroMockup language={language} />
            </motion.div>
          </div>
        </section>

        {/* ─────────────── Jonli raqamlar ─────────────── */}
        {stats && (
          <section className="border-y border-slate-200/70 bg-white">
            <div className={`${SHELL} py-10 sm:py-12`}>
              <p className="text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {tr('landing.statsTitle')}
              </p>
              <dl className="mt-7 grid grid-cols-2 gap-y-8 sm:grid-cols-4 sm:divide-x sm:divide-slate-200/80">
                {stats.map((s) => (
                  <div key={s.label} className="flex flex-col-reverse px-2 text-center">
                    <dt className="mt-1.5 text-[13.5px] text-slate-500">{s.label}</dt>
                    <dd className="text-[2rem] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[2.5rem]">
                      <CountUp value={s.value} locale={numberLocale} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        )}

        {/* ─────────────── Imkoniyatlar (bento) ─────────────── */}
        <section id="features" className="scroll-mt-20 py-20 sm:py-28">
          <div className={SHELL}>
            <SectionHeading
              eyebrow={tr('landing.featuresEyebrow')}
              title={tr('landing.featuresTitle')}
              subtitle={tr('landing.featuresSubtitle')}
            />

            <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
              {/* Ma'ruza — katta karta */}
              <BentoCard
                icon={FileText}
                title={tr('landing.fLectureTitle')}
                desc={tr('landing.fLectureDesc')}
                className="md:col-span-4"
              >
                <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-slate-800">{tr('landing.mockSection1')}</p>
                    <span className="rounded-md bg-white px-2 py-0.5 text-[10.5px] font-semibold text-slate-500 ring-1 ring-slate-200">
                      PDF
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="h-[7px] w-full rounded-full bg-slate-200" />
                    <div className="h-[7px] w-[93%] rounded-full bg-slate-200" />
                    <div className="h-[7px] w-[70%] rounded-full bg-slate-200" />
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800 ring-1 ring-sky-100">
                    <BookOpen size={12} />
                    {tr('landing.mockSource')}
                  </div>
                </div>
              </BentoCard>

              {/* Test + jonli QR */}
              <BentoCard
                icon={ClipboardList}
                title={tr('landing.fTestsTitle')}
                desc={tr('landing.fTestsDesc')}
                className="md:col-span-2"
                delay={0.05}
              >
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <div className="rounded-lg bg-white p-1.5 ring-1 ring-slate-200">
                    <MiniQr size={52} />
                  </div>
                  <div className="space-y-1.5">
                    {['A', 'B', 'C'].map((opt, i) => (
                      <div key={opt} className="flex items-center gap-1.5">
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold ${
                            i === 1 ? 'bg-teal-500 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'
                          }`}
                        >
                          {opt}
                        </span>
                        <span className={`h-[6px] rounded-full ${i === 1 ? 'w-16 bg-teal-200' : 'w-12 bg-slate-200'}`} />
                      </div>
                    ))}
                  </div>
                </div>
              </BentoCard>

              <BentoCard
                icon={BriefcaseMedical}
                title={tr('landing.fCasesTitle')}
                desc={tr('landing.fCasesDesc')}
                className="md:col-span-2"
              >
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
                      <HeartPulse size={14} />
                    </span>
                    <div className="flex-1 space-y-1.5">
                      <div className="h-[6px] w-4/5 rounded-full bg-slate-300" />
                      <div className="h-[6px] w-3/5 rounded-full bg-slate-200" />
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`h-6 rounded-md ring-1 ${
                          i === 0 ? 'bg-teal-50 ring-teal-200' : 'bg-white ring-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </BentoCard>

              {/* Taqdimot */}
              <BentoCard
                icon={Presentation}
                title={tr('landing.fSlidesTitle')}
                desc={tr('landing.fSlidesDesc')}
                className="md:col-span-2"
                delay={0.05}
              >
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`aspect-[4/3] flex-1 rounded-lg p-2 ring-1 ${
                        i === 0 ? 'bg-[#0b3a6e] ring-[#0b3a6e]' : 'bg-white ring-slate-200'
                      }`}
                    >
                      <div className={`h-1.5 w-3/4 rounded-full ${i === 0 ? 'bg-white/80' : 'bg-slate-300'}`} />
                      <div className={`mt-1.5 h-1 w-1/2 rounded-full ${i === 0 ? 'bg-teal-300/80' : 'bg-slate-200'}`} />
                      {i > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="h-1 w-full rounded-full bg-slate-200" />
                          <div className="h-1 w-4/5 rounded-full bg-slate-200" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </BentoCard>

              <BentoCard
                icon={Video}
                title={tr('landing.fMediaTitle')}
                desc={tr('landing.fMediaDesc')}
                className="md:col-span-2"
                delay={0.1}
              >
                <div className="flex gap-2">
                  <div className="relative flex aspect-video w-[46%] items-center justify-center rounded-lg bg-[#0b3a6e]">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-[#0b3a6e]">
                      <Play size={13} className="ml-0.5" fill="currentColor" />
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col justify-center gap-1.5">
                    {[0, 1].map((i) => (
                      <div key={i} className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1.5 ring-1 ring-slate-200/70">
                        <FileText size={12} className="shrink-0 text-slate-400" />
                        <div className={`h-[5px] rounded-full bg-slate-300 ${i === 0 ? 'w-4/5' : 'w-3/5'}`} />
                      </div>
                    ))}
                  </div>
                </div>
              </BentoCard>

              {/* Uch til */}
              <BentoCard
                icon={Languages}
                title={tr('landing.fLangsTitle')}
                desc={tr('landing.fLangsDesc')}
                className="md:col-span-3"
              >
                <div className="space-y-2">
                  {[
                    ['UZ', 'Arterial gipertenziya'],
                    ['RU', 'Артериальная гипертензия'],
                    ['EN', 'Arterial hypertension'],
                  ].map(([code, text]) => (
                    <div
                      key={code}
                      className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70"
                    >
                      <span className="w-7 rounded bg-white py-0.5 text-center text-[10.5px] font-bold text-slate-600 ring-1 ring-slate-200">
                        {code}
                      </span>
                      <span className="truncate text-[13px] font-medium text-slate-700">{text}</span>
                    </div>
                  ))}
                </div>
              </BentoCard>

              {/* O'z fani (Excel) */}
              <BentoCard
                icon={FileSpreadsheet}
                title={tr('landing.fOwnTitle')}
                desc={tr('landing.fOwnDesc')}
                className="md:col-span-3"
                delay={0.05}
              >
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <FileSpreadsheet size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-slate-800">namuna-fan-mavzulari.xlsx</p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full w-full rounded-full bg-emerald-500" />
                    </div>
                  </div>
                  <Check size={18} strokeWidth={2.5} className="shrink-0 text-emerald-600" />
                </div>
              </BentoCard>
            </div>
          </div>
        </section>

        {/* ─────────────── Qanday ishlaydi ─────────────── */}
        <section id="how-it-works" className="scroll-mt-20 border-y border-slate-200/70 bg-white py-20 sm:py-28">
          <div className={SHELL}>
            <SectionHeading eyebrow={tr('landing.howEyebrow')} title={tr('landing.howTitle')} />
            <div className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
              <div
                className="absolute left-[16.66%] right-[16.66%] top-6 hidden h-px bg-gradient-to-r from-slate-200 via-teal-300 to-slate-200 md:block"
                aria-hidden="true"
              />
              {steps.map(({ icon: Icon, title, desc }, i) => (
                <Reveal key={title} delay={i * 0.08}>
                  <div className="relative flex flex-col items-center text-center">
                    <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm ring-1 ring-slate-200">
                      <Icon size={20} className="text-teal-600" />
                      <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                        {i + 1}
                      </span>
                    </span>
                    <h3 className="mt-5 text-[17px] font-semibold tracking-tight text-slate-900">{title}</h3>
                    <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-slate-600">{desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────────── CTA ─────────────── */}
        <section className="pb-20 sm:pb-28">
          <div className={SHELL}>
            <Reveal className="lp-cta-band relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12 sm:py-20">
              <h2 className="mx-auto max-w-2xl text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[2.5rem]">
                {tr('landing.ctaTitle')}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-slate-300 sm:text-base">
                {tr('landing.ctaSubtitle')}
              </p>
              <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => openAuth('login')}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-slate-900 transition hover:bg-slate-100"
                >
                  {tr('landing.ctaLogin')}
                  <ArrowRight size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => openAuth('register')}
                  className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px] font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/10"
                >
                  {tr('auth.registerLink')}
                </button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ─────────────── Footer ─────────────── */}
      <footer className="border-t border-slate-200/70 bg-white">
        <div className={`${SHELL} grid gap-10 py-12 sm:grid-cols-[1.4fr_1fr_1fr]`}>
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <span className="text-[17px] font-semibold tracking-tight">iMentor</span>
            </div>
            <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-slate-500">{tr('welcome.footerInstitute')}</p>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">{tr('landing.footerProduct')}</p>
            <ul className="mt-4 space-y-2.5 text-[14px] text-slate-500">
              {nav.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => scrollTo(item.id)} className="hover:text-slate-900">
                    {item.label}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={() => openAuth('login')} className="hover:text-slate-900">
                  {tr('publicLanding.login')}
                </button>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">{tr('landing.footerInstitute')}</p>
            <ul className="mt-4 space-y-2.5 text-[14px] text-slate-500">
              <li>
                <a href="https://fjsti.uz" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900">
                  fjsti.uz
                </a>
              </li>
              <li>{tr('publicLanding.brandSubtitle')}</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100">
          <div className={`${SHELL} flex flex-col gap-2 py-6 text-[12.5px] text-slate-400 sm:flex-row sm:items-center sm:justify-between`}>
            <span>{tr('footer.copyright')}</span>
            <span>{tr('footer.developer')}</span>
          </div>
        </div>
      </footer>

      {/* ─────────────── Kirish oynasi ─────────────── */}
      <AnimatePresence>
        {authOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setAuthOpen(false);
            }}
            className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={tr('publicLanding.authPanelTitle')}
              initial={reduce ? { opacity: 0 } : { y: 32, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { y: 32, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl ring-1 ring-slate-200/80 sm:max-w-[520px] sm:rounded-3xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
                <p className="font-semibold text-slate-900">{tr('publicLanding.authPanelTitle')}</p>
                <button
                  type="button"
                  onClick={() => setAuthOpen(false)}
                  aria-label="Close"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-5 sm:p-6">
                {isMobileDevice ? (
                  authScreen === 'login' ? (
                    <MobileMinimalLogin onSwitchToRegister={() => setAuthScreen('register')} />
                  ) : (
                    <RegisterPage onSwitchToLogin={() => setAuthScreen('login')} />
                  )
                ) : isDesktopBrowser() && authScreen === 'login' && desktopAuthView !== 'password' ? (
                  <DesktopHodimQrLogin onOtherRoles={() => setDesktopAuthView('password')} />
                ) : authScreen === 'login' ? (
                  <LoginPage
                    onSwitchToRegister={() => setAuthScreen('register')}
                    onWantsHodimQr={isDesktopBrowser() ? () => setDesktopAuthView('qr') : undefined}
                  />
                ) : (
                  <RegisterPage
                    onSwitchToLogin={() => setAuthScreen('login')}
                    onBackToQr={
                      isDesktopBrowser()
                        ? () => {
                            setAuthScreen('login');
                            setDesktopAuthView('qr');
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
