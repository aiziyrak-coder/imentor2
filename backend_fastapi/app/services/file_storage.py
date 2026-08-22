from __future__ import annotations

import os
import re
import uuid

from app.core.config import get_settings

_ALLOWED_EXTENSIONS = frozenset(
    {".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg", ".heic", ".heif"}
)
_ALLOWED_PRESENTATION_EXTENSIONS = frozenset({".pdf", ".ppt", ".pptx"})
_ALLOWED_AVATAR_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp"})
AVATAR_MAX_BYTES = 2 * 1024 * 1024


def avatar_relative_path(owner_key: str, filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in _ALLOWED_AVATAR_EXTENSIONS:
        ext = ".jpg"
    return f"avatars/{owner_key}{ext}"


def verify_image_magic(head: bytes) -> bool:
    if len(head) < 3:
        return False
    if head[:3] == b"\xff\xd8\xff":
        return True
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return True
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return True
    return False


def validate_avatar_extension(filename: str) -> bool:
    ext = os.path.splitext(filename or "")[1].lower()
    return ext in _ALLOWED_AVATAR_EXTENSIONS


def media_root() -> str:
    settings = get_settings()
    return settings.django_media_root or "/app/media"


def _safe_filename(filename: str) -> str:
    return re.sub(r"[^\w.\-]", "_", filename)[:180]


def _topic_dir(topic_norm: str) -> str:
    slug = re.sub(r"[^\w.\-]+", "_", (topic_norm or "").strip().lower())[:80]
    return slug.strip("_") or "topic"


def handout_relative_path(
    topic_norm: str,
    owner_key: str,
    filename: str,
    language: str = "",
) -> str:
    safe = _safe_filename(filename)
    lang = re.sub(r"[^a-z]", "", (language or "uz").lower())[:8] or "uz"
    uniq = uuid.uuid4().hex[:10]
    return f"handouts/{_topic_dir(topic_norm)}/{owner_key}_{lang}_{uniq}_{safe}"


def presentation_relative_path(topic_norm: str, owner_key: str, filename: str) -> str:
    safe = _safe_filename(filename)
    return f"presentations/{_topic_dir(topic_norm)}/{owner_key}_{safe}"


def save_upload(relative_path: str, content: bytes) -> None:
    abs_path = os.path.join(media_root(), relative_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(content)


def delete_file(relative_path: str) -> None:
    abs_path = os.path.join(media_root(), relative_path)
    try:
        os.remove(abs_path)
    except OSError:
        pass


def absolute_path(relative_path: str) -> str:
    return os.path.join(media_root(), relative_path)


def detect_extension(filename: str, content: bytes = b"", content_type: str = "") -> str:
    """Haqiqiy rasm/PDF bo'lsa, nomdagi nuqtalar (masalan .translated.jpg) xalaqit bermasin."""
    name = (filename or "").lower()
    ctype = (content_type or "").split(";")[0].strip().lower()
    for ext in (".jpeg", ".jpg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg", ".heic", ".heif", ".pdf"):
        if name.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    if content[:3] == b"\xff\xd8\xff" or ctype in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    if content[:8] == b"\x89PNG\r\n\x1a\n" or ctype == "image/png":
        return ".png"
    if content[:6] in (b"GIF87a", b"GIF89a") or ctype == "image/gif":
        return ".gif"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return ".webp"
    if content[:5] == b"%PDF-" or ctype == "application/pdf":
        return ".pdf"
    if ctype.startswith("image/"):
        return ".jpg"
    return ""


def validate_extension(
    filename: str,
    *,
    presentation: bool = False,
    content: bytes = b"",
    content_type: str = "",
) -> bool:
    if presentation:
        ext = os.path.splitext(filename or "")[1].lower()
        return ext in _ALLOWED_PRESENTATION_EXTENSIONS
    return detect_extension(filename, content, content_type) in _ALLOWED_EXTENSIONS


def detect_handout_kind(name: str, content_type: str, content: bytes = b"") -> str:
    ext = detect_extension(name, content, content_type)
    if ext == ".pdf" or (content_type or "").split(";")[0].strip().lower() == "application/pdf":
        return "pdf"
    return "image"


def detect_presentation_kind(name: str) -> str:
    lower = (name or "").lower()
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".pptx"):
        return "pptx"
    return "ppt"
