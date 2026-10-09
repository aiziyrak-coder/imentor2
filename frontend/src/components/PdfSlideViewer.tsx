import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Square,
  MousePointer2,
  Pencil,
  Eraser,
  Loader2,
} from 'lucide-react';
import { pdfjsLib } from '../utils/pdfjsSetup';
import { useUiText } from '../i18n/useUiText';

type PdfDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;

/**
 * Dars o'tish uchun slayd ko'ruvchi — bir vaqtda BITTA slayd to'liq ekranga
 * moslab ko'rsatiladi, oldinga/orqaga tugmalari bilan almashtiriladi.
 *
 * PDF pdf.js orqali canvas'ga chiziladi. MUHIM: fayl pdf.js'ga `blob:` URL
 * sifatida emas, ArrayBuffer (`{data}`) sifatida beriladi — URL bilan ba'zi
 * PDF'larda pdf.js xato berardi (loyihaning boshqa joylarida ham aynan
 * ArrayBuffer usuli ishlatiladi va u ishonchli).
 *
 * Agar pdf.js baribir ochа olmasa — brauzerning ichki PDF ko'ruvchisiga
 * (`<iframe>`) avtomatik o'tadi, shunda o'qituvchi hech qachon bo'sh ekran
 * ko'rmaydi (faqat sahifa almashtirish tugmalari o'rniga brauzer paneli
 * ishlatiladi).
 */
export default function PdfSlideViewer({ fileUrl }: { fileUrl: string }) {
  const { t } = useUiText();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const renderTokenRef = useRef(0);
  /** Ishlab turgan pdf.js render vazifasi — yangisidan oldin bekor qilinadi. */
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  /** Renderlar navbati — bir vaqtda faqat bittasi ishlaydi. */
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  const drawingRef = useRef(false);

  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  /** pdf.js ishlamasa — brauzerning o'z ko'ruvchisiga tushamiz. */
  const [useNativeViewer, setUseNativeViewer] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [tool, setTool] = useState<'none' | 'pointer' | 'draw'>('none');
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);

  // ---- PDF'ni yuklash (ArrayBuffer sifatida) ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setUseNativeViewer(false);
    setNumPages(0);
    setPageNum(1);
    (async () => {
      try {
        const res = await fetch(fileUrl);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        // pdf.js ba'zan xato bermasdan "osilib" qolishi mumkin — bunday holda
        // ham zaxira ko'ruvchiga o'tishimiz kerak, aks holda o'qituvchi
        // cheksiz yuklanish belgisini ko'rib qoladi.
        const doc = (await Promise.race([
          pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('pdf.js javob bermadi (timeout)')), 10000),
          ),
        ])) as PdfDoc;
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);
      } catch (err) {
        console.warn('pdf.js PDF ni ocholmadi, brauzer ko\'ruvchisiga o\'tilmoqda:', err);
        if (!cancelled) setUseNativeViewer(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [fileUrl]);

  const clearDrawing = useCallback(() => {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (overlay && ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  // ---- Slaydni konteynerga TO'LIQ sig'diradigan masshtabda chizish ----
  //
  // MUHIM: pdf.js PDF koordinatalarini (pastdan-yuqoriga) ekran koordinatalariga
  // o'girish uchun canvas kontekstiga Y-aylantirish transformini qo'llaydi.
  // Agar BIR canvas ustida ikkita render bir vaqtda ishlasa, transformlar
  // ustma-ust tushib, sahifa TESKARI (vertikal aylangan) chiziladi.
  // Shuning uchun: (1) avvalgi render majburan bekor qilinadi va tugashi
  // kutiladi, (2) renderlar navbat bilan (ketma-ket) bajariladi.
  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!doc || !canvas || !stage) return;

    const token = ++renderTokenRef.current;

    // Ishlab turgan renderni bekor qilamiz va u to'liq to'xtaguncha kutamiz.
    const running = renderTaskRef.current;
    if (running) {
      running.cancel();
      try {
        await running.promise;
      } catch {
        /* bekor qilingani normal holat */
      }
      renderTaskRef.current = null;
    }
    if (token !== renderTokenRef.current) return;

    try {
      const page = await doc.getPage(pageNum);
      if (token !== renderTokenRef.current) return;

      const base = page.getViewport({ scale: 1 });
      // Butun slayd ko'rinishi uchun eni va bo'yi bo'yicha kichigini olamiz.
      const fit = Math.min(stage.clientWidth / base.width, stage.clientHeight / base.height);
      if (!Number.isFinite(fit) || fit <= 0) return;
      // Proyektorda aniq chiqishi uchun ekran zichligini hisobga olamiz.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: fit * dpr });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // `width` ga yozish canvas holatini (shu jumladan transformni) tozalaydi.
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${base.width * fit}px`;
      canvas.style.height = `${base.height * fit}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } finally {
        if (renderTaskRef.current === task) renderTaskRef.current = null;
      }
      if (token !== renderTokenRef.current) return;

      // Chizma qatlamini slayd o'lchamiga moslaymiz (va tozalaymiz).
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        overlay.style.width = canvas.style.width;
        overlay.style.height = canvas.style.height;
        overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
      }
    } catch {
      /* rendering bekor qilingan bo'lishi mumkin */
    }
  }, [pageNum]);

  /** Renderlarni navbatga qo'yadi — hech qachon ikkitasi birga ishlamaydi. */
  const queueRender = useCallback(() => {
    renderChainRef.current = renderChainRef.current.then(renderPage).catch(() => {});
  }, [renderPage]);

  useEffect(() => {
    if (!numPages || useNativeViewer) return;
    queueRender();
  }, [numPages, pageNum, useNativeViewer, queueRender]);

  // Konteyner o'lchami o'zgarsa (to'liq ekran, oyna) — qayta moslab chizamiz.
  // Debounce: o'lcham o'zgarishi ketma-ket ko'p marta keladi, har biriga
  // render boshlash mantiqsiz va navbatni uzaytiradi.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || useNativeViewer) return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(queueRender, 120);
    });
    ro.observe(stage);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [queueRender, useNativeViewer]);

  const goPrev = useCallback(() => setPageNum((p) => Math.max(1, p - 1)), []);
  const goNext = useCallback(() => setPageNum((p) => Math.min(numPages, p + 1)), [numPages]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (blackout) {
        if (k === 'b' || e.key === 'Escape') {
          e.preventDefault();
          // Esc faqat qora ekranni o'chirsin — taqdimot oynasini yopib
          // yubormasin (u ham window'da Esc'ni kutadi).
          e.stopPropagation();
          setBlackout(false);
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goPrev();
      } else if (k === 'b') {
        e.preventDefault();
        setBlackout(true);
      } else if (k === 'l') {
        setTool((p) => (p === 'pointer' ? 'none' : 'pointer'));
      } else if (k === 'd') {
        setTool((p) => (p === 'draw' ? 'none' : 'draw'));
      } else if (k === 'c') {
        clearDrawing();
      }
    };
    // Capture fazasi: slayd ko'ruvchi tugmalarni ota oynadan OLDIN oladi.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [blackout, goPrev, goNext, clearDrawing]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  };

  // ---- Chizish / ko'rsatkich ----
  const overlayPoint = (e: React.MouseEvent) => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * overlay.width,
      y: ((e.clientY - rect.top) / rect.height) * overlay.height,
      cssX: e.clientX - rect.left,
      cssY: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool !== 'draw') return;
    const p = overlayPoint(e);
    const ctx = overlayRef.current?.getContext('2d');
    if (!p || !ctx) return;
    drawingRef.current = true;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const p = overlayPoint(e);
    if (!p) return;
    if (tool === 'pointer') {
      setPointerPos({ x: p.cssX, y: p.cssY });
      return;
    }
    if (tool !== 'draw' || !drawingRef.current) return;
    const ctx = overlayRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const toolBtn = (active: boolean) =>
    `p-2.5 rounded-full text-white ${active ? 'bg-red-500 hover:bg-red-400' : 'bg-white/15 hover:bg-white/25'}`;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full flex flex-col bg-gray-900 ${
        isFullscreen ? 'p-0' : 'rounded-lg overflow-hidden'
      }`}
    >
      <div ref={stageRef} className="flex-1 min-h-0 relative flex items-center justify-center p-2">
        {loading ? (
          <Loader2 className="animate-spin text-white/70" size={40} />
        ) : useNativeViewer ? (
          // Zaxira: brauzerning ichki PDF ko'ruvchisi (o'z paneli bilan)
          <iframe
            src={fileUrl}
            title={t('presentation.slideLabel')}
            className="w-full h-full border-0 bg-gray-900"
          />
        ) : (
          <div className="relative" style={{ lineHeight: 0 }}>
            <canvas ref={canvasRef} className="block bg-white shadow-2xl" />
            <canvas
              ref={overlayRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={() => {
                drawingRef.current = false;
              }}
              onMouseLeave={() => {
                drawingRef.current = false;
                setPointerPos(null);
              }}
              className={`absolute inset-0 ${
                tool === 'draw'
                  ? 'cursor-crosshair'
                  : tool === 'pointer'
                    ? 'cursor-none'
                    : 'pointer-events-none'
              }`}
            />
            {tool === 'pointer' && pointerPos && (
              <span
                className="pointer-events-none absolute z-10 block w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-red-500/70 ring-4 ring-red-500/25"
                style={{ left: pointerPos.x, top: pointerPos.y }}
              />
            )}
          </div>
        )}

        {/* Katta oldinga/orqaga tugmalari — slayd ustida, dars paytida qulay */}
        {!useNativeViewer && !loading && numPages > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              disabled={pageNum <= 1}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 p-3.5 rounded-full bg-black/45 hover:bg-black/70 text-white disabled:opacity-20 disabled:hover:bg-black/45"
              aria-label={t('presentation.prevSlide')}
            >
              <ChevronLeft size={30} />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={pageNum >= numPages}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 p-3.5 rounded-full bg-black/45 hover:bg-black/70 text-white disabled:opacity-20 disabled:hover:bg-black/45"
              aria-label={t('presentation.nextSlide')}
            >
              <ChevronRight size={30} />
            </button>
          </>
        )}
      </div>

      {/* Pastki panel */}
      <div className="shrink-0 flex items-center justify-center gap-2 py-2.5 px-3 bg-black/50 backdrop-blur-sm flex-wrap">
        {!useNativeViewer && numPages > 0 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              disabled={pageNum <= 1}
              className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white disabled:opacity-30"
              aria-label={t('presentation.prevSlide')}
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-white text-sm font-semibold tabular-nums px-2 min-w-[64px] text-center">
              {pageNum} / {numPages}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={pageNum >= numPages}
              className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white disabled:opacity-30"
              aria-label={t('presentation.nextSlide')}
            >
              <ChevronRight size={20} />
            </button>
            <span className="w-px h-6 bg-white/20 mx-1" />
          </>
        )}

        <button
          type="button"
          onClick={() => setTool((p) => (p === 'pointer' ? 'none' : 'pointer'))}
          className={toolBtn(tool === 'pointer')}
          title={t('presentation.pointer')}
          aria-label={t('presentation.pointer')}
        >
          <MousePointer2 size={18} />
        </button>
        <button
          type="button"
          onClick={() => setTool((p) => (p === 'draw' ? 'none' : 'draw'))}
          className={toolBtn(tool === 'draw')}
          title={t('presentation.draw')}
          aria-label={t('presentation.draw')}
        >
          <Pencil size={18} />
        </button>
        <button
          type="button"
          onClick={clearDrawing}
          className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white"
          title={t('presentation.clearDrawing')}
          aria-label={t('presentation.clearDrawing')}
        >
          <Eraser size={18} />
        </button>

        <span className="w-px h-6 bg-white/20 mx-1" />

        <button
          type="button"
          onClick={() => setBlackout(true)}
          className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white"
          title={t('presentation.blackScreen')}
          aria-label={t('presentation.blackScreen')}
        >
          <Square size={18} />
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white"
          title={t('presentation.fullscreen')}
          aria-label={t('presentation.fullscreen')}
        >
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </div>

      {blackout && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setBlackout(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setBlackout(false);
          }}
          className="absolute inset-0 z-30 bg-black flex items-end justify-center pb-10 cursor-pointer"
        >
          <p className="text-white/35 text-sm select-none">{t('presentation.blackScreenHint')}</p>
        </div>
      )}
    </div>
  );
}
