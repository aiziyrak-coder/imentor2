from __future__ import annotations
from typing import Any

# Never truncate JSON, language directives or the final task. Callers select source
# excerpts before constructing messages. Oversized requests fail without API spend.
MAX_TEXT_CHARS = 120_000

def clip_education_messages(messages: list[Any]) -> list[dict[str, Any]]:
    if len(messages) > 32:
        raise ValueError("AI request contains too many messages (maximum 32).")
    out = []
    total = 0
    for raw in messages:
        if not isinstance(raw, dict) or raw.get("role") not in ("system", "user", "assistant"):
            continue
        content = raw.get("content")
        if isinstance(content, str):
            total += len(content)
        elif isinstance(content, list):
            parts = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text" and isinstance(part.get("text"), str):
                    total += len(part["text"])
                    parts.append(part)
                elif part.get("type") == "image_url":
                    url = (part.get("image_url") or {}).get("url", "")
                    if not isinstance(url, str) or len(url) > 450_000:
                        raise ValueError("AI image is too large.")
                    parts.append(part)
            content = parts
        else:
            continue
        if total > MAX_TEXT_CHARS:
            raise ValueError("AI source is too large. Select a shorter relevant excerpt.")
        if content:
            out.append({"role": raw["role"], "content": content})
    return out
