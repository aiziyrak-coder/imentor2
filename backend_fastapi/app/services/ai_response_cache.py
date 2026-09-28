"""Exact transformation reuse. Generation remains fresh; no semantic matching."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import uuid
from functools import lru_cache
from typing import Callable

import redis

TTL = 7 * 24 * 3600
MAX_BYTES = 512_000
_stripes = [threading.Lock() for _ in range(64)]
_memory: dict[str, tuple[float, str]] = {}
_guard = threading.Lock()


@lru_cache
def _redis():
    from app.core.config import get_settings
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True,
                               socket_connect_timeout=0.5, socket_timeout=0.5)


def cache_key(api_key: str, body: dict, scope: str) -> str:
    data = json.dumps([hashlib.sha256(api_key.encode()).hexdigest(), scope, body],
                      sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "imentor:ai:response:v1:" + hashlib.sha256(data.encode()).hexdigest()


def _memory_get(key):
    with _guard:
        value = _memory.get(key)
        return value[1] if value and value[0] > time.monotonic() else None


def _memory_put(key, value):
    with _guard:
        now = time.monotonic()
        for old in list(_memory):
            if _memory[old][0] <= now:
                del _memory[old]
        if len(_memory) >= 128:
            del _memory[next(iter(_memory))]
        _memory[key] = (now + TTL, value)


def reuse(key: str, generate: Callable[[], str], valid: Callable[[str], bool],
          *, bypass: bool = False, wait_sec: int = 280) -> tuple[str, bool]:
    """Distributed single-flight, bounded local fallback, failures never stored."""
    with _stripes[int(key[-8:], 16) % len(_stripes)]:
        client = _redis()
        token = uuid.uuid4().hex
        lock_key = key + ":lock"
        acquired = False
        connected = True
        try:
            deadline = time.monotonic() + wait_sec
            while True:
                if not bypass:
                    value = client.get(key)
                    if value is not None and valid(value):
                        return value, True
                if client.set(lock_key, token, nx=True, ex=360):
                    acquired = True
                    break
                if time.monotonic() >= deadline:
                    from app.services.openai_client import OpenAiClientError
                    raise OpenAiClientError("Bir xil AI so'rovi hali bajarilmoqda. Birozdan keyin qayta urining.")
                time.sleep(0.2)
        except redis.RedisError:
            connected = False
            if not bypass:
                value = _memory_get(key)
                if value is not None and valid(value):
                    return value, True
        try:
            value = generate()
            if len(value.encode()) <= MAX_BYTES and valid(value):
                _memory_put(key, value)
                if connected:
                    try:
                        client.set(key, value, ex=TTL)
                    except redis.RedisError:
                        pass
            return value, False
        finally:
            if acquired:
                try:
                    client.eval("if redis.call('get',KEYS[1]) == ARGV[1] then "
                                "return redis.call('del',KEYS[1]) else return 0 end", 1, lock_key, token)
                except redis.RedisError:
                    pass


def transformation_validator(kind: str, messages: list[dict]):
    """Only complete known transformation formats qualify for reuse."""
    if kind not in {"test_translate", "test_option_explanations", "syllabus_translate",
                    "case_translate", "topic_text_repair"}:
        return None
    try:
        source = json.loads(next(m["content"] for m in reversed(messages) if m["role"] == "user"))
    except (ValueError, StopIteration, TypeError, KeyError):
        return None

    system = " ".join(str(m.get("content", "")) for m in messages if m.get("role") == "system")
    match = re.search(r"Translate(?: the given JSON test)? into (Russian|English|Uzbek)", system, re.I)
    target = match.group(1).lower() if match else ""

    def nonempty(value):
        return isinstance(value, str) and bool(value.strip())

    def valid(text):
        try:
            data = json.loads(text)
            if kind == "topic_text_repair":
                # Faqat bo'sh joy qo'shiladi/olinadi — harf o'zgarsa ("membrane" -> "membranes") rad.
                # Ilgari bu tekshiruv umumiy ro'yxat shartidan KEYIN turardi va hech qachon ishlamasdi.
                values = data if isinstance(data, list) else data["items"]
                return len(values) == len(source) and all(
                    isinstance(b, str) and a.replace(" ", "") == b.replace(" ", "") for a, b in zip(source, values)
                )
            if isinstance(source, list) and all(isinstance(v, str) for v in source):
                values = data if isinstance(data, list) else data["items"]
                return len(values) == len(source) and all(not a.strip() or nonempty(b) for a, b in zip(source, values))
            if kind == "test_translate":
                originals, translated = source["questions"], data["questions"]
                if len(originals) != len(translated) or not nonempty(data.get("topic")):
                    return False
                for original, item in zip(originals, translated):
                    if not nonempty(item.get("question")) or not nonempty(item.get("explanation")):
                        return False
                    for field in ("options", "optionExplanations"):
                        if field in original and (len(item.get(field, [])) != len(original[field])
                                                  or not all(nonempty(v) for v in item[field])):
                            return False
                    if "correctOptionIndex" in original and item.get("correctOptionIndex") != original["correctOptionIndex"]:
                        return False
                    for field in ("question", "explanation"):
                        text = item[field]
                        if len(original.get(field, "")) > 35 and text.strip() == original[field].strip():
                            return False
                        if target == "russian" and (not re.search(r"[А-Яа-яЁё]", text) or re.search(r"[қғҳўҚҒҲЎ]", text)):
                            return False
                        if target in {"english", "uzbek"} and re.search(r"[А-Яа-яЁё]", text):
                            return False
                return True
            if kind == "test_option_explanations":
                items = data["items"]
                by_id = {row["id"]: row for row in items}
                if len(by_id) != len(source) or len(items) != len(source):
                    return False
                for original in source:
                    row = by_id[original["id"]]
                    explanations = row["explanations"]
                    indices = {e["i"] for e in explanations if nonempty(e.get("text"))}
                    if not nonempty(row.get("analysis")) or len(explanations) != len(original["options"]):
                        return False
                    if indices != {o["i"] for o in original["options"]}:
                        return False
                return True
            values = data if isinstance(data, list) else data["items"]
            if len(values) != len(source) or not all(isinstance(v, str) for v in values):
                return False
            if kind == "topic_text_repair":
                return all(a.replace(" ", "") == b.replace(" ", "") for a, b in zip(source, values))
            return all(not a.strip() or nonempty(b) for a, b in zip(source, values))
        except (ValueError, TypeError, KeyError, AttributeError, IndexError):
            return False
    return valid
