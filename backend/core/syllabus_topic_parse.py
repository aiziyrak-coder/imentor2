"""PDF syllabus matnidan mavzular (M1, L1, A1…) ajratish — frontend syllabusTopicParse.ts porti."""

from __future__ import annotations

import re
from typing import Literal

TopicSection = Literal["lecture", "practical", "unknown"]

LECTURE_PREFIXES = {"M", "L", "Л"}
PRACTICAL_PREFIXES = {"A", "P", "П"}

LECTURE_SECTION_RE = re.compile(
    r"^(?:ma'?ruza(?:lar)?|maruza|lecture(?:s)?|лекци[яиюеё]?|теоретическ|theor)",
    re.I,
)
PRACTICAL_SECTION_RE = re.compile(
    r"^(?:amaliy(?:\s+mashg'?ulot)?|practical(?:s)?|практик[аиеё]?|лаборатор|seminar|семинар)",
    re.I,
)
UNIVERSITY_NOISE_RE = re.compile(
    r"(?:universitet|institut|akademiy|vazirlik|ministry|республик|o[''`]zbekiston|uzbekistan|fakultet|kafedra|department|syllabus|учебн(?:ая|ый)\s+программ)",
    re.I,
)
RUBRIC_NOISE_RE = re.compile(
    r"(?:fanning\s+mohiyati|xatolik\s+va\s+chalkashlik|savollarga\s+aniq|aniq\s+tasavvurga|to[''`]liq\s+yorita|meyoriy-huquqiy|baholash\s+mezon|o[''`]zlashtirish\s+darajasi)",
    re.I,
)
STANDALONE_TOPIC_ID_RE = re.compile(r"^([MALP])(\d{1,2})$", re.I)


def normalize_syllabus_document_text(text: str) -> str:
    text = (
        text.replace("\u041c", "M")
        .replace("\u0410", "A")
        .replace("\u041b", "L")
        .replace("\u041f", "P")
        .replace("\u043c", "m")
        .replace("\u0430", "a")
    )
    text = re.sub(r"^Ml$", "M1", text, flags=re.M)
    text = re.sub(r"^Мl$", "M1", text, flags=re.M)
    return text


def detect_topic_section(line: str) -> TopicSection:
    trimmed = line.strip()
    if not trimmed:
        return "unknown"
    if re.search(r"\bseminar\b|\bсеминар", trimmed, re.I):
        return "practical"
    if LECTURE_SECTION_RE.search(trimmed):
        return "lecture"
    if PRACTICAL_SECTION_RE.search(trimmed):
        return "practical"
    return "unknown"


def infer_topic_type_from_id(topic_id: str) -> Literal["lecture", "practical"]:
    first = (topic_id[:1] or "").upper()
    if first == "S":
        return "practical"
    if first in LECTURE_PREFIXES:
        return "lecture"
    if first in PRACTICAL_PREFIXES:
        return "practical"
    return "lecture"


def coerce_topic_id(raw_id: str, topic_type: Literal["lecture", "practical"], fallback_index: int) -> str:
    compact = re.sub(r"\s+", "", (raw_id or "").strip().upper())
    standard = re.match(r"^([MALPЛП])(\d{1,2})$", compact)
    if standard:
        letter = standard.group(1).upper()
        num = standard.group(2)
        if letter in LECTURE_PREFIXES or letter in PRACTICAL_PREFIXES:
            return f"{letter}{num}"

    labeled = re.match(r"^(?:MARUZA|MA'?RUZA|LECTURE|LEKTSIYA|LEKTS|ЛЕКЦИЯ|ЛЕК)(?:№|#)?(\d{1,2})$", compact, re.I)
    if labeled:
        return f"L{labeled.group(1)}"

    practical_labeled = re.match(r"^(?:AMALIY|PRACTICAL|PRAKTIK|ПРАКТИК|ПРАК)(?:№|#)?(\d{1,2})$", compact, re.I)
    if practical_labeled:
        return f"A{practical_labeled.group(1)}"

    num_only = re.match(r"^(\d{1,2})$", compact)
    num = num_only.group(1) if num_only else str(fallback_index)
    prefix = "A" if topic_type == "practical" else "L"
    return f"{prefix}{num}"


def _is_noise_line(line: str) -> bool:
    t = line.strip()
    if len(t) < 3:
        return True
    if re.match(r"^TN\d+", t, re.I):
        return True
    if re.match(r"^\d+$", t):
        return True
    if re.match(r"^\d{1,2}\s*>", t):
        return True
    if UNIVERSITY_NOISE_RE.search(t):
        return True
    if RUBRIC_NOISE_RE.search(t):
        return True
    if LECTURE_SECTION_RE.search(t) or PRACTICAL_SECTION_RE.search(t):
        return True
    if re.match(r"^mashg['’]?ulotlar\s+shakli:", t, re.I):
        return True
    if re.match(r"^fan\s+ma[/\\]?muni$", t, re.I):
        return True
    return False


def _is_weak_topic_title(title: str) -> bool:
    t = title.strip()
    if len(t) < 10:
        return True
    if RUBRIC_NOISE_RE.search(t):
        return True
    if re.match(r"^[''']?smal", t, re.I):
        return True
    if re.match(r"^\d{4}\s*й\.?$", t):
        return True
    if re.match(r"^(?:\d{1,2}\s*>)+\s*", t):
        return True
    return False


def normalize_syllabus_topics(topics: list[dict]) -> list[dict]:
    cleaned: list[dict] = []
    for index, raw in enumerate(topics):
        if not raw or not isinstance(raw.get("title"), str):
            continue
        title = raw["title"].strip()
        raw_type = raw.get("type")
        if raw_type in ("practical", "lecture"):
            inferred_type = raw_type
        else:
            inferred_type = infer_topic_type_from_id(str(raw.get("id") or ""))
        topic_id = coerce_topic_id(str(raw.get("id") or ""), inferred_type, index + 1)
        if _is_weak_topic_title(title):
            continue
        cleaned.append(
            {
                "id": topic_id,
                "title": title[:500],
                "type": infer_topic_type_from_id(topic_id),
            }
        )

    dedup: dict[str, dict] = {}
    for topic in cleaned:
        existing = dedup.get(topic["id"])
        if not existing or len(topic["title"]) > len(existing["title"]):
            dedup[topic["id"]] = topic

    def parse_order(topic_id: str) -> tuple[int, int]:
        prefix = topic_id[:1] if topic_id else ""
        num_match = re.search(r"\d+", topic_id or "")
        num = int(num_match.group(0)) if num_match else 0
        group = 0 if prefix in LECTURE_PREFIXES else 1
        return group, num

    return sorted(dedup.values(), key=lambda t: (*parse_order(t["id"]), t["id"]))


def _parse_topic_from_line(
    line: str,
    section: TopicSection,
    lecture_counter: dict,
    practical_counter: dict,
) -> dict | None:
    trimmed = line.strip()
    if len(trimmed) < 4:
        return None

    standard = re.match(r"\b([MALPЛП])\s*[-.):]?\s*(\d{1,2})\b[\s:.)–\-]*(.+)$", trimmed, re.I)
    if standard:
        topic_id = f"{standard.group(1).upper()}{standard.group(2)}"
        title = standard.group(3).strip()
        if len(title) < 3:
            return None
        return {"id": topic_id, "title": title, "type": infer_topic_type_from_id(topic_id)}

    lecture_line = re.match(
        r"^(?:ma'?ruza|maruza|lecture|лекци[яиюеё]?)\s*[#№.]?\s*(\d{1,2})[\s:.)–\-]+(.+)$",
        trimmed,
        re.I,
    )
    if lecture_line:
        return {"id": f"L{lecture_line.group(1)}", "title": lecture_line.group(2).strip(), "type": "lecture"}

    practical_line = re.match(
        r"^(?:amaliy|practical|практик[аиеё]?|лаборатор(?:ная)?)\s*[#№.]?\s*(\d{1,2})[\s:.)–\-]+(.+)$",
        trimmed,
        re.I,
    )
    if practical_line:
        return {"id": f"A{practical_line.group(1)}", "title": practical_line.group(2).strip(), "type": "practical"}

    numbered = re.match(r"^(\d{1,2})[\s.)–\-]+(.{4,})$", trimmed)
    if numbered and section != "unknown" and int(numbered.group(1)) > 0:
        topic_type: Literal["lecture", "practical"] = "practical" if section == "practical" else "lecture"
        counter = practical_counter if topic_type == "practical" else lecture_counter
        counter["n"] += 1
        topic_id = coerce_topic_id(numbered.group(1), topic_type, counter["n"])
        return {"id": topic_id, "title": numbered.group(2).strip(), "type": topic_type}

    return None


def extract_topics_by_regex(text: str) -> list[dict]:
    normalized = normalize_syllabus_document_text(text)
    result: list[dict] = []
    section: TopicSection = "unknown"
    lecture_counter = {"n": 0}
    practical_counter = {"n": 0}
    pending_id: str | None = None
    pending_title_lines: list[str] = []

    def flush_pending() -> None:
        nonlocal pending_id, pending_title_lines
        if not pending_id:
            return
        title = " ".join(
            line.strip()
            for line in pending_title_lines
            if len(line.strip()) >= 4 and not _is_noise_line(line)
        )
        title = re.sub(r"\s+", " ", title).strip()
        if not _is_weak_topic_title(title):
            topic_type = infer_topic_type_from_id(pending_id)
            result.append(
                {
                    "id": coerce_topic_id(pending_id, topic_type, len(result) + 1),
                    "title": title[:500],
                    "type": topic_type,
                }
            )
        pending_id = None
        pending_title_lines = []

    for raw_line in normalized.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        section_hint = detect_topic_section(line)
        if section_hint != "unknown":
            flush_pending()
            section = section_hint
            continue

        standalone = STANDALONE_TOPIC_ID_RE.match(normalize_syllabus_document_text(line.strip()))
        if standalone:
            flush_pending()
            pending_id = f"{standalone.group(1).upper()}{standalone.group(2)}"
            pending_title_lines = []
            continue

        inline = _parse_topic_from_line(line, section, lecture_counter, practical_counter)
        if inline:
            flush_pending()
            result.append(inline)
            continue

        if pending_id and not _is_noise_line(line):
            pending_title_lines.append(line)

    flush_pending()
    return normalize_syllabus_topics(result)
