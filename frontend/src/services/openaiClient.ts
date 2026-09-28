/**
 * OpenAI Chat Completions API.
 * Production: server proxy (kalit brauzerga kirmaydi).
 * Dev: to‘g‘ridan-to‘g‘ri API (frontend/.env.local OPENAI_API_KEY).
 */
import { httpJson } from '../api/httpClient';
import { type MedicalReference } from '../utils/medicalReferences';
import { ensureBackendAccessToken, getBackendAccessToken } from '../utils/backendAuth';
import { pdfjsLib } from '../utils/pdfjsSetup';

// Server baribir arzon modelni ishlatadi; bu yerda ham qimmat nom qolmasin.
export const OPENAI_CHAT = 'gpt-4.1-nano';
export const OPENAI_FAST = 'gpt-4.1-nano';
export const OPENAI_REASONER = 'gpt-4.1-nano';

/** Eski importlar bilan moslik */
export const DEEPSEEK_CHAT = OPENAI_CHAT;
export const DEEPSEEK_FAST = OPENAI_FAST;
export const DEEPSEEK_REASONER = OPENAI_REASONER;

const DIRECT_API_URL = 'https://api.openai.com/v1/chat/completions';

const JSON_ONLY_SUFFIX =
  '\n\nReturn ONLY valid JSON (no markdown fences, no commentary before or after).';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function localApiKey(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const fromVite = env?.OPENAI_API_KEY?.trim() || '';
  const fromProcess =
    typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
  const legacy =
    typeof process.env.DEEPSEEK_API_KEY === 'string' ? process.env.DEEPSEEK_API_KEY.trim() : '';
  return fromVite || fromProcess || legacy;
}

function viteEnv(): Record<string, string | boolean | undefined> {
  return (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env ?? {};
}

function preferBackendProxy(): boolean {
  const env = viteEnv();
  if (env.PROD) return true;
  const flag = env.VITE_AI_VIA_BACKEND;
  return flag === 'true' || flag === '1';
}

export function assertOpenAiApiKey(): void {
  if (localApiKey()) return;
  if (preferBackendProxy()) return;
  throw new Error(
    'OPENAI_API_KEY sozlanmagan. Mahalliy: frontend/.env.local. Server: deploy/.env.production (backend proxy).'
  );
}

/** @deprecated assertOpenAiApiKey ishlating */
export const assertDeepseekApiKey = assertOpenAiApiKey;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

async function extractTextFromPdfBase64(pdfBase64: string): Promise<string> {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ('str' in it ? String(it.str) : ''))
      .join(' ');
    pageTexts.push(line);
  }
  return pageTexts.join('\n');
}

export type BookContext = { subjectCode: string; topicQuery: string };

async function chatViaBackend(params: {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  bookContext?: BookContext;
  responseFormat?: Record<string, unknown>;
  /** Qaysi funksiya — server sarfni shu nom bilan yozadi. */
  purpose?: string;
  /** Server RAG uchun ISHLATGAN darsliklar (AI o'ylab topgani emas). */
  onBookReferences?: (refs: MedicalReference[]) => void;
}): Promise<string> {
  const call = async (token: string) =>
    httpJson<{ content?: string; detail?: string; book_references?: MedicalReference[] }>(`${apiBaseUrl()}/v1/education-ai/completion/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.35,
        ...(params.bookContext?.subjectCode
          ? { subject_code: params.bookContext.subjectCode, topic_query: params.bookContext.topicQuery }
          : {}),
        ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
        ...(params.purpose ? { purpose: params.purpose } : {}),
      },
      timeoutMs: 290_000,
    });

  let token = await ensureBackendAccessToken().catch(async () => {
    const fallback = await getBackendAccessToken();
    if (!fallback) throw new Error('no-backend-token');
    return fallback;
  });

  try {
    const data = await call(token);
    const text = data.content?.trim();
    if (!text) throw new Error(data.detail || 'OpenAI: bo‘sh javob (server proxy)');
    if (Array.isArray(data.book_references) && data.book_references.length) {
      params.onBookReferences?.(data.book_references);
    }
    return text;
  } catch (e: unknown) {
    const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : 0;
    if (status !== 401) throw e;
    const retryToken = await getBackendAccessToken();
    if (!retryToken || retryToken === token) {
      throw new Error('no-backend-token');
    }
    const data = await call(retryToken);
    const text = data.content?.trim();
    if (!text) throw new Error(data.detail || 'OpenAI: bo‘sh javob (server proxy)');
    return text;
  }
}

/** SSE oqim orqali javob qabul qilib, har bir bo'lakni `onDelta`ga
 * yuboradi (matn generatsiya bo'lgan sari darhol ko'rsatish uchun).
 * Umumiy generatsiya vaqti bir xil, lekin foydalanuvchi kutish tuyg'usi yo'q. */
async function chatViaBackendStream(params: {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  bookContext?: BookContext;
  purpose?: string;
  onDelta: (text: string) => void;
  onBookReferences?: (refs: MedicalReference[]) => void;
}): Promise<string> {
  let token = await ensureBackendAccessToken().catch(async () => {
    const fallback = await getBackendAccessToken();
    if (!fallback) throw new Error('no-backend-token');
    return fallback;
  });

  const doStream = async (authToken: string): Promise<string> => {
    const res = await fetch(`${apiBaseUrl()}/v1/education-ai/completion/stream/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.35,
        ...(params.bookContext?.subjectCode
          ? { subject_code: params.bookContext.subjectCode, topic_query: params.bookContext.topicQuery }
          : {}),
        ...(params.purpose ? { purpose: params.purpose } : {}),
      }),
    });

    if (res.status === 401) {
      const err = new Error('unauthorized') as Error & { status?: number };
      err.status = 401;
      throw err;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let streamError: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        let evt: { delta?: string; done?: boolean; book_references?: MedicalReference[]; error?: string };
        try {
          evt = JSON.parse(raw);
        } catch {
          continue;
        }
        if (evt.error) {
          streamError = evt.error;
        } else if (evt.delta) {
          full += evt.delta;
          params.onDelta(full);
        } else if (evt.done) {
          if (Array.isArray(evt.book_references) && evt.book_references.length) {
            params.onBookReferences?.(evt.book_references);
          }
        }
      }
    }

    if (streamError) throw new Error(streamError);
    if (!full.trim()) throw new Error('OpenAI: bo‘sh javob (server proxy, stream)');
    return full.trim();
  };

  try {
    return await doStream(token);
  } catch (e: unknown) {
    const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : 0;
    if (status !== 401) throw e;
    const retryToken = await getBackendAccessToken();
    if (!retryToken || retryToken === token) throw new Error('no-backend-token');
    return doStream(retryToken);
  }
}

async function chatViaDirectApi(params: {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  responseFormat?: Record<string, unknown>;
}): Promise<string> {
  const key = localApiKey();
  if (!key) throw new Error('OPENAI_API_KEY yo‘q (mahalliy dev).');

  const res = await fetch(DIRECT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0.35,
      stream: false,
      ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
    }),
  });

  const raw = await res.text();
  let data: {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`OpenAI API javobi JSON emas: ${raw.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = data?.error?.message || raw.slice(0, 400);
    throw new Error(`OpenAI HTTP ${res.status}: ${msg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error('OpenAI: bo‘sh javob');
  return String(text).trim();
}

async function chatCompletion(params: {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  bookContext?: BookContext;
  responseFormat?: Record<string, unknown>;
  purpose?: string;
  onBookReferences?: (refs: MedicalReference[]) => void;
}): Promise<string> {
  const msgs: ChatMessage[] = [];
  const sys = params.system.trim();
  if (sys) msgs.push({ role: 'system', content: sys });
  msgs.push(...params.messages);

  const useProxy = preferBackendProxy() || !localApiKey();
  if (useProxy) {
    return chatViaBackend({
      model: params.model,
      messages: msgs,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      bookContext: params.bookContext,
      responseFormat: params.responseFormat,
      purpose: params.purpose,
      onBookReferences: params.onBookReferences,
    });
  }
  return chatViaDirectApi({
    model: params.model,
    messages: msgs,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    responseFormat: params.responseFormat,
  });
}

export async function openaiText(opts: {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  bookContext?: BookContext;
  purpose?: string;
}): Promise<string> {
  return chatCompletion({
    model: opts.model ?? OPENAI_CHAT,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
    bookContext: opts.bookContext,
    purpose: opts.purpose,
  });
}

/** `openaiText` bilan bir xil, lekin matn generatsiya bo'lgan sari
 * `onDelta(hozirgacha to'plangan matn)` chaqiriladi — foydalanuvchi
 * kutmasdan darhol natijani ko'radi. Faqat backend-proxy rejimida
 * (production) haqiqiy stream; to'g'ridan-to'g'ri API kalit bilan ishlashda
 * (dev) natija bir martada keladi. */
export async function openaiTextStream(opts: {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  bookContext?: BookContext;
  purpose?: string;
  onDelta: (textSoFar: string) => void;
  onBookReferences?: (refs: MedicalReference[]) => void;
}): Promise<string> {
  const msgs: ChatMessage[] = [];
  const sys = opts.system.trim();
  if (sys) msgs.push({ role: 'system', content: sys });
  msgs.push({ role: 'user', content: opts.user });

  const useProxy = preferBackendProxy() || !localApiKey();
  if (useProxy) {
    return chatViaBackendStream({
      model: opts.model ?? OPENAI_CHAT,
      messages: msgs,
      maxTokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature,
      bookContext: opts.bookContext,
      onDelta: opts.onDelta,
      onBookReferences: opts.onBookReferences,
      purpose: opts.purpose,
    });
  }
  const text = await chatViaDirectApi({
    model: opts.model ?? OPENAI_CHAT,
    messages: msgs,
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
  });
  opts.onDelta(text);
  return text;
}

export async function openaiJson<T>(opts: {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  parse: (text: string) => T;
  bookContext?: BookContext;
  responseFormat?: Record<string, unknown>;
  purpose?: string;
  onBookReferences?: (refs: MedicalReference[]) => void;
}): Promise<T> {
  const text = await chatCompletion({
    model: opts.model ?? OPENAI_CHAT,
    system: opts.system + (opts.responseFormat ? '' : JSON_ONLY_SUFFIX),
    messages: [{ role: 'user', content: opts.user }],
    maxTokens: opts.maxTokens ?? 8192,
    temperature: opts.temperature ?? 0.3,
    bookContext: opts.bookContext,
    responseFormat: opts.responseFormat,
    purpose: opts.purpose,
    onBookReferences: opts.onBookReferences,
  });
  return opts.parse(text);
}

/** `openaiJson` bilan bir xil, lekin xom JSON matni generatsiya bo'lgan
 * sari `onProgress(hozirgacha to'plangan xom matn)` chaqiriladi — UI
 * foydalanuvchiga "tayyorlanmoqda" his-tuyg'usini bermasdan, jarayonni
 * jonli ko'rsatishi mumkin. Faqat backend-proxy (production) rejimida
 * haqiqiy stream; aks holda natija bir martada keladi. */
export async function openaiJsonStream<T>(opts: {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  parse: (text: string) => T;
  bookContext?: BookContext;
  onProgress?: (rawTextSoFar: string) => void;
  onBookReferences?: (refs: MedicalReference[]) => void;
  purpose?: string;
}): Promise<T> {
  const msgs: ChatMessage[] = [{ role: 'system', content: opts.system + JSON_ONLY_SUFFIX }, { role: 'user', content: opts.user }];
  const useProxy = preferBackendProxy() || !localApiKey();
  let text: string;
  if (useProxy) {
    text = await chatViaBackendStream({
      model: opts.model ?? OPENAI_CHAT,
      messages: msgs,
      maxTokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 0.3,
      bookContext: opts.bookContext,
      onDelta: opts.onProgress ?? (() => {}),
      onBookReferences: opts.onBookReferences,
      purpose: opts.purpose,
    });
  } else {
    text = await chatViaDirectApi({
      model: opts.model ?? OPENAI_CHAT,
      messages: msgs,
      maxTokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 0.3,
    });
    opts.onProgress?.(text);
  }
  return opts.parse(text);
}

export async function openaiWithPdf(opts: {
  model?: string;
  system: string;
  userText: string;
  pdfBase64: string;
  maxTokens?: number;
}): Promise<string> {
  let pdfText = '';
  try {
    pdfText = await extractTextFromPdfBase64(opts.pdfBase64);
  } catch {
    pdfText = '';
  }
  const user =
    pdfText.trim().length > 80
      ? `${opts.userText}\n\n--- PDF matn ---\n${pdfText.slice(0, 100_000)}`
      : `${opts.userText}\n\n(PDF matn ajratib bo‘lmadi — mavzu va kontekst bo‘yicha javob bering.)`;
  return chatCompletion({
    model: opts.model ?? OPENAI_CHAT,
    system: opts.system,
    messages: [{ role: 'user', content: user }],
    maxTokens: opts.maxTokens ?? 8192,
    temperature: 0.3,
  });
}

export async function openaiWithImage(opts: {
  model?: string;
  system: string;
  userText: string;
  imageBase64: string;
  mimeType?: string;
  maxTokens?: number;
}): Promise<string> {
  const mime = opts.mimeType || 'image/jpeg';
  const url = `data:${mime};base64,${opts.imageBase64}`;
  const parts: ContentPart[] = [
    { type: 'image_url', image_url: { url } },
    { type: 'text', text: opts.userText },
  ];
  return chatCompletion({
    model: opts.model ?? OPENAI_CHAT,
    system: opts.system,
    messages: [{ role: 'user', content: parts }],
    maxTokens: opts.maxTokens ?? 4096,
    temperature: 0.2,
  });
}
