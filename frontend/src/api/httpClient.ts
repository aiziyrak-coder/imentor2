export class HttpError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 401 da bir marta token yangilab qayta urinish */
  retryOnUnauthorized?: boolean;
};

const DEFAULT_TIMEOUT_MS = 12000;

type TokenRefresher = () => Promise<string | null>;

let tokenRefresher: TokenRefresher | null = null;

export function setHttpTokenRefresher(refresher: TokenRefresher | null): void {
  tokenRefresher = refresher;
}

type Fetched = { res: Response; text: string };

/**
 * So'rov VA javob matni bitta vaqt chegarasi ostida o'qiladi.
 *
 * Ilgari chegara faqat `fetch` ga qo'yilar, `res.text()` esa chegarasiz edi:
 * sarlavhalar kelgandan keyin aloqa uzilsa (institut Wi-Fi), so'rov abadiy
 * osilib qolardi. Natijada "Katalogdan tanlash" oynasi "Fanlar yuklanmoqda…"
 * da qotib qolardi — server esa so'rovni bajarilgan deb ko'rsatardi (2026-09-23).
 */
async function fetchOnce(url: string, options: RequestOptions): Promise<Fetched> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const hasBody = options.body !== undefined;
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        // DELETE/GET da bo'sh body bilan Content-Type yubormaslik — ba'zi proxy/serverlarda 4xx beradi.
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    return { res, text: await res.text() };
  } catch (err) {
    // O'z taymerimiz uzgan so'rov: ilgari foydalanuvchiga va xatolar jurnaliga
    // "signal is aborted without reason" bo'lib borardi (2026-09-25). Endi
    // sababi aniq yoziladi; status 0 — tarmoq/vaqt xatosi (408 emas, server javob bermadi).
    if (controller.signal.aborted && (err as { name?: string })?.name === 'AbortError') {
      throw new HttpError("So'rov vaqti tugadi — internet sekin yoki server band. Qayta urinib ko'ring.", 0, null);
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function httpJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const hadAuth = Boolean(options.headers?.Authorization);
  const allowRetry = options.retryOnUnauthorized !== false && hadAuth && Boolean(tokenRefresher);

  let fetched = await fetchOnce(url, options);

  if (fetched.res.status === 401 && allowRetry && tokenRefresher) {
    const nextToken = await tokenRefresher();
    if (nextToken) {
      fetched = await fetchOnce(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${nextToken}`,
        },
        retryOnUnauthorized: false,
      });
    }
  }

  const { res, text } = fetched;
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, res.status, data);
  }
  return data as T;
}
