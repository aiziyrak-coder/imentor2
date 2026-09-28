from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Iterator

import requests

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
OPENAI_EMBEDDING_DIMENSIONS = 1536


class OpenAiClientError(Exception):
    """Model javobi yoki HTTP xatosi."""


def _economy_model_name(model: str) -> str:
    return "gpt-4.1-nano"


# Arzon model qoladi, lekin javob uzunligi so'ralganicha beriladi. Ilgari 1200
# token (~1,5 bet) bilan kesilardi: ma'ruzalarning 95% i o'rtasida uzilib
# qolar, JSON tarjimalar esa buzilib umuman saqlanmasdi.
ECONOMY_MAX_OUTPUT_TOKENS = 16384


def _economy_max_tokens(max_tokens: int) -> int:
    return max(256, min(int(max_tokens or 4096), ECONOMY_MAX_OUTPUT_TOKENS))


def _parse_retry_after_seconds(message: str) -> float:
    m = re.search(r"[Rr]etry[- ]after[:\s]+(\d+)", message)
    if m:
        return min(120.0, max(3.0, float(m.group(1)) + 1.0))
    return 55.0


#: OpenAI hisobida mablag' tugaganda ham 429 qaytadi, lekin bu vaqtinchalik emas: kutib qayta urinish
#: o'qituvchini daqiqalab kuttirib, oxirida baribir xato berardi (2026-09-17 da shunday bo'ldi).
QUOTA_EXHAUSTED_MESSAGE = (
    "AI xizmati vaqtincha ishlamayapti: OpenAI hisobidagi mablag' tugagan. "
    "Administratorga murojaat qiling — hisob to'ldirilgach generatsiya yana ishlaydi."
)


def _is_quota_exhausted(message: str) -> bool:
    return bool(re.search(r"no credits remaining|insufficient_quota|exceeded your current quota|billing", message, re.I))


def _is_rate_limited(message: str) -> bool:
    if _is_quota_exhausted(message):
        return False
    return bool(re.search(r"\b429\b|rate.?limit|overloaded", message, re.I))


def _is_transient_error(message: str) -> bool:
    return _is_rate_limited(message) or bool(re.search(r"\bHTTP 5\d\d\b", message))


def _clip_messages_for_cost(messages: list[dict]) -> list[dict]:
    from app.services.education_ai_utils import clip_education_messages
    try:
        return clip_education_messages(messages)
    except ValueError as exc:
        raise OpenAiClientError(str(exc)) from exc


def _complete_cached(api_key: str, body: dict, timeout_sec: int, usage_kind: str) -> str:
    from app.services.ai_response_cache import cache_key, reuse, transformation_validator
    validator = transformation_validator(usage_kind, body["messages"])
    def generate_fresh() -> str:
        resp = _http_post(api_key, body, url=OPENAI_CHAT_URL, timeout_sec=timeout_sec)
        _log_usage(resp, body["model"], usage_kind)
        return _extract_text(resp)
    if validator is None:
        # Faqat aniq o'girish (tarjima, matn tuzatish) keshlanadi. Generatsiya har safar yangi:
        # ilgari "Qayta yaratish" bosilganda o'sha keys/test keshdan qaytib kelardi.
        return generate_fresh()
    def valid(text):
        if validator is not None:
            return validator(text)
        if body.get("response_format"):
            try:
                return isinstance(json.loads(text), (dict, list))
            except (ValueError, TypeError):
                return False
        return bool(text.strip())
    def generate():
        resp = _http_post(api_key, body, url=OPENAI_CHAT_URL, timeout_sec=timeout_sec)
        _log_usage(resp, body["model"], usage_kind)
        return _extract_text(resp)
    value, hit = reuse(cache_key(api_key, body, usage_kind), generate, valid)
    if hit:
        logging.getLogger(__name__).info("AI_CACHE_HIT kind=%s", usage_kind)
    return value


def _http_post(api_key: str, payload: dict[str, Any], *, url: str, timeout_sec: int = 180) -> dict[str, Any]:
    try:
        resp = requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout_sec,
        )
    except requests.RequestException as e:
        raise OpenAiClientError(str(e)) from e
    if resp.status_code >= 400:
        try:
            msg = str((resp.json().get("error") or {}).get("message") or resp.text)
        except ValueError:
            msg = resp.text
        if _is_quota_exhausted(msg):
            logging.getLogger(__name__).error("OPENAI_QUOTA_EXHAUSTED: %s", msg[:200])
            raise OpenAiClientError(QUOTA_EXHAUSTED_MESSAGE)
        raise OpenAiClientError(f"HTTP {resp.status_code}: {msg}")
    return resp.json() if resp.content else {}


usage_logger = logging.getLogger("imentor.openai.usage")


def _store_usage(kind: str, model: str, prompt: int, cached: int, completion: int, total: int) -> None:
    """Sarfni `core_aiusagelog` ga yozadi (rektor "AI sarfi" bo'limi shundan o'qiydi).

    Alohida qisqa sessiya: chaqiruvchining tranzaksiyasiga aralashmaydi.
    Yozib bo'lmasa jim o'tadi — hisob yuritish asosiy ishni to'xtatmasin.
    """
    try:
        from app.core.db import SessionLocal
        from app.models.ai_usage import AiUsageLog

        with SessionLocal() as db:
            db.add(
                AiUsageLog(
                    kind=(kind or "")[:64],
                    model=(model or "")[:64],
                    prompt_tokens=prompt,
                    cached_tokens=cached,
                    completion_tokens=completion,
                    total_tokens=total,
                )
            )
            db.commit()
    except Exception:  # noqa: BLE001
        pass


def _log_usage(resp: dict, model: str, kind: str) -> None:
    """Javobdagi `usage` ni log va bazaga yozadi. Hech qachon xato ko'tarmaydi."""
    try:
        u = resp.get("usage") if isinstance(resp, dict) else None
        if not isinstance(u, dict):
            return
        details = u.get("prompt_tokens_details")
        cached = int(details.get("cached_tokens") or 0) if isinstance(details, dict) else 0
        prompt = int(u.get("prompt_tokens") or 0)
        completion = int(u.get("completion_tokens") or 0)
        total = int(u.get("total_tokens") or 0)
        usage_logger.info(
            "OPENAI_USAGE kind=%s model=%s in=%s cached=%s out=%s total=%s",
            kind, model, prompt, cached, completion, total,
        )
        _store_usage(kind, model, prompt, cached, completion, total)
    except Exception:  # noqa: BLE001
        pass


def _extract_text(resp: dict[str, Any]) -> str:
    choices = resp.get("choices")
    if not isinstance(choices, list) or not choices:
        raise OpenAiClientError("No choices in OpenAI response")
    if isinstance(choices[0], dict) and choices[0].get("finish_reason") == "length":
        # Chala javob muvaffaqiyat sifatida qaytmaydi: aks holda chala ma'ruza
        # saqlanadi, buzuq JSON keshga tushadi. Barcha chaqiruvchilar bu xatoni
        # ushlaydi (502/503 yoki zaxira qiymat).
        usage_logger.warning("OPENAI_TRUNCATED javob max_tokens chegarasida kesildi")
        raise OpenAiClientError("Model javobi uzunlik chegarasida kesildi")
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(msg, dict):
        raise OpenAiClientError("No message in OpenAI response")
    content = msg.get("content")
    if not isinstance(content, str) or not content.strip():
        raise OpenAiClientError("Empty model text")
    return content.strip()


def generate_openai_chat(
    api_key: str,
    *,
    messages: list[dict],
    model: str = "gpt-4.1-nano",
    max_tokens: int = 4096,
    temperature: float = 0.35,
    timeout_sec: int = 280,
    response_format: dict | None = None,
    usage_kind: str = "chat",
) -> str:
    """Tayyor `messages` ro'yxati (system/user/assistant) bilan chat completion."""
    body: dict[str, Any] = {
        "model": _economy_model_name(model),
        "messages": _clip_messages_for_cost(messages),
        "max_tokens": _economy_max_tokens(max_tokens),
        "temperature": temperature,
        "stream": False,
    }
    if response_format:
        body["response_format"] = response_format
    return _complete_cached(api_key, body, timeout_sec, usage_kind)


def stream_openai_chat(
    api_key: str,
    *,
    messages: list[dict],
    model: str = "gpt-4.1-nano",
    max_tokens: int = 4096,
    temperature: float = 0.35,
    timeout_sec: int = 280,
    usage_kind: str = "chat_stream",
) -> Iterator[str]:
    """OpenAI chat completion'ni SSE orqali oqim (stream) sifatida o'qib,
    har bir matn bo'lagini (`delta.content`) navbat bilan qaytaradi.
    Foydalanuvchi generatsiya jarayonida darhol matnni ko'rib turishi uchun —
    umumiy vaqt bir xil, lekin sezilgan tezlik ancha yaxshilanadi."""
    body = {
        "model": _economy_model_name(model),
        "messages": _clip_messages_for_cost(messages),
        "max_tokens": _economy_max_tokens(max_tokens),
        "temperature": temperature,
        "stream": True,
        # Oqimda `usage` faqat so'ralsa keladi — oxirgi, `choices` bo'sh bo'lakda.
        "stream_options": {"include_usage": True},
    }
    try:
        resp = requests.post(
            OPENAI_CHAT_URL,
            json=body,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout_sec,
            stream=True,
        )
    except requests.RequestException as e:
        raise OpenAiClientError(str(e)) from e

    completed = False
    try:
        if resp.status_code >= 400:
            try:
                msg = str((resp.json().get("error") or {}).get("message") or resp.text)
            except ValueError:
                msg = resp.text
            if _is_quota_exhausted(msg):
                raise OpenAiClientError(QUOTA_EXHAUSTED_MESSAGE)
            raise OpenAiClientError(f"HTTP {resp.status_code}: {msg}")
        for raw_line in resp.iter_lines(decode_unicode=True):
            if not raw_line or not raw_line.startswith("data:"):
                continue
            data = raw_line[len("data:"):].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except ValueError:
                continue
            if chunk.get("usage"):
                _log_usage(chunk, body["model"], usage_kind)
            choices = chunk.get("choices") or []
            if not choices:
                continue
            reason = choices[0].get("finish_reason")
            if reason == "stop":
                completed = True
            elif reason in ("length", "content_filter"):
                raise OpenAiClientError("AI response was incomplete. Please retry with a smaller section.")
            text = (choices[0].get("delta") or {}).get("content")
            if text:
                yield text
        if not completed:
            raise OpenAiClientError("AI stream ended before completion. Please retry.")
    except requests.RequestException as exc:
        raise OpenAiClientError(str(exc)) from exc
    finally:
        resp.close()


def generate_openai_text(
    api_key: str,
    *,
    user_text: str,
    system_instruction: str | None = None,
    model: str = "gpt-4.1-nano",
    max_tokens: int = 8192,
    temperature: float = 0.35,
    json_only: bool = False,
    max_429_retries: int = 2,
    timeout_sec: int = 180,
    usage_kind: str = "text",
) -> str:
    sys_text = (system_instruction or "").strip()
    if json_only:
        suffix = "\n\nReturn ONLY valid JSON (no markdown fences, no extra text)."
        sys_text = (sys_text + suffix).strip() if sys_text else suffix.strip()

    messages: list[dict[str, str]] = []
    if sys_text:
        messages.append({"role": "system", "content": sys_text})
    messages.append({"role": "user", "content": user_text})

    body = {
        "model": _economy_model_name(model),
        "messages": _clip_messages_for_cost(messages),
        "max_tokens": _economy_max_tokens(max_tokens),
        "temperature": temperature,
        "stream": False,
    }

    last_err: str | None = None
    for attempt in range(max(1, max_429_retries)):
        try:
            return _complete_cached(api_key, body, timeout_sec, usage_kind)
        except OpenAiClientError as e:
            msg = str(e)
            last_err = msg
            if _is_rate_limited(msg) and attempt + 1 < max_429_retries:
                time.sleep(_parse_retry_after_seconds(msg))
                continue
            raise
    raise OpenAiClientError(last_err or "Unknown OpenAI error")


_EMBED_CACHE: dict[tuple[str, str], list[float]] = {}
_EMBED_CACHE_MAX = 2000


def create_embeddings(
    api_key: str,
    texts: list[str],
    *,
    model: str = OPENAI_EMBEDDING_MODEL,
    batch_size: int = 96,
    timeout_sec: int = 120,
    max_429_retries: int = 6,
    cache: bool = False,
) -> list[list[float]]:
    """Matnlar embeddingi. `cache=True` — bir xil so'rov qayta pul to'lamasin.

    Kitob qidiruvi (RAG) har generatsiyada mavzu nomini qayta embed qiladi;
    xotiradagi kesh shu takrorni oladi. Kesh jarayon ichida, hajmi cheklangan.
    """
    if cache:
        missing = [t for t in dict.fromkeys(texts) if (model, t) not in _EMBED_CACHE]
        if missing:
            fresh = create_embeddings(
                api_key, missing, model=model, batch_size=batch_size,
                timeout_sec=timeout_sec, max_429_retries=max_429_retries,
            )
            if len(_EMBED_CACHE) + len(missing) > _EMBED_CACHE_MAX:
                _EMBED_CACHE.clear()
            for text, vec in zip(missing, fresh):
                _EMBED_CACHE[(model, text)] = vec
        return [_EMBED_CACHE[(model, t)] for t in texts]

    out: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        resp: dict[str, Any] | None = None
        for attempt in range(max(1, max_429_retries)):
            try:
                resp = _http_post(
                    api_key,
                    {"model": model, "input": batch},
                    url=OPENAI_EMBEDDINGS_URL,
                    timeout_sec=timeout_sec,
                )
                _log_usage(resp, model, "embedding")
                break
            except OpenAiClientError as e:
                msg = str(e)
                if _is_transient_error(msg) and attempt + 1 < max_429_retries:
                    time.sleep(_parse_retry_after_seconds(msg))
                    continue
                raise
        assert resp is not None
        data = resp.get("data")
        if not isinstance(data, list) or len(data) != len(batch):
            raise OpenAiClientError("Embedding javobi noto'g'ri formatda")
        ordered = sorted(data, key=lambda item: item.get("index", 0))
        for item in ordered:
            embedding = item.get("embedding")
            if not isinstance(embedding, list):
                raise OpenAiClientError("Embedding qiymati topilmadi")
            out.append(embedding)
    return out
