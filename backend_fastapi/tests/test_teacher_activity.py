"""Nazorat hisobotining ikkinchi qatlami (2026-09-25).

Savol: o'qituvchi darsda iMentor'ni OCHGANI yetarli emas — qaysi bo'limda
qancha turgan, nima yaratgan, profili va materiali to'liqmi.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import control_report_service as cr
from app.services import teacher_activity_service as ta


def test_depth_separates_a_visit_from_real_work():
    assert ta._depth(3, 0) == "visit"        # kirib chiqqan
    assert ta._depth(40, 0) == "viewed"      # ko'rgan, lekin yaratmagan
    assert ta._depth(2, 1) == "worked"       # kam turgan, lekin test yaratgan
    assert ta._depth(0, 0) == "none"


def test_module_totals_add_minutes_and_count_people():
    engagement = {
        "a": {"modules": [{"page": "tests", "label": "Test", "minutes": 30, "opens": 4},
                          {"page": "cases", "label": "Keys", "minutes": 10, "opens": 1}]},
        "b": {"modules": [{"page": "tests", "label": "Test", "minutes": 12, "opens": 2}]},
    }
    rows = ta.module_totals(engagement)
    assert rows[0] == {"page": "tests", "label": "Test", "minutes": 42, "opens": 6, "people": 2}
    assert rows[1]["page"] == "cases" and rows[1]["people"] == 1


def test_created_totals_cover_every_kind():
    engagement = {
        "a": {"created": {**{k: 0 for k in ta.CREATED_LABEL}, "tests": 2, "videos": 1}},
        "b": {"created": {**{k: 0 for k in ta.CREATED_LABEL}, "tests": 3}},
    }
    out = ta.created_totals(engagement)
    assert out["tests"] == 5 and out["videos"] == 1 and out["handouts"] == 0


def test_profile_map_lists_what_is_missing():
    db = MagicMock()
    profile = SimpleNamespace(owner_key="u1", photo="", department="Fiziologiya", job_title="")
    db.execute.return_value.scalars.return_value = [profile]
    db.execute.return_value.all.side_effect = [
        [SimpleNamespace(owner_key="u1", n=2)],   # tanlangan fanlar
        [("u1",)],                                 # yuz shabloni
    ]
    out = ta.profile_map(db)["u1"]
    assert out["percent"] == 60  # kafedra + fan + yuz
    assert out["missing"] == ["Surat", "Lavozim"]
    assert out["subjects"] == 2


def test_materials_map_counts_empty_topics_per_subject():
    db = MagicMock()
    db.execute.return_value.all.side_effect = [
        [SimpleNamespace(id=7, subject_name="Fiziologiya")],
        [SimpleNamespace(owner_key="u1", syllabus_id=7, variant_label="")],
    ]
    topics = {7: [
        {"code": "l1", "title": "A", "type": "lecture", "variant": "", "key": (7, "l1")},
        {"code": "l2", "title": "B", "type": "lecture", "variant": "", "key": (7, "l2")},
    ]}
    coverage = {(7, "l1"): {"handout", "video"}}
    with patch.object(ta, "syllabus_topics", return_value=topics), \
         patch.object(ta, "material_coverage", return_value=coverage):
        out = ta.materials_map(db)["u1"]
    assert out["topics"] == 2 and out["empty"] == 1 and out["percent"] == 50
    assert out["handout"] == 1 and out["presentation"] == 0
    assert out["subjects"][0]["subject"] == "Fiziologiya"


def test_attach_puts_the_second_layer_on_a_teacher_row():
    row = {"teacher_key": "u1", "linked": True}
    cr._attach(
        row,
        {"u1": {"minutes": 45, "active_days": 3, "created": {"tests": 2}, "created_total": 2,
                "modules": [{"page": "tests", "label": "Test", "minutes": 45, "opens": 3}],
                "depth": "worked"}},
        {"u1": {"percent": 80, "missing": ["Surat"], "subjects": 1}},
        {"u1": {"percent": 50, "topics": 20, "empty": 10}},
    )
    assert row["minutes"] == 45 and row["depth"] == "worked" and row["top_module"] == "Test"
    assert row["profile_percent"] == 80 and row["profile_missing"] == ["Surat"]
    assert row["material_percent"] == 50 and row["material_empty"] == 10


def test_attach_leaves_an_unlinked_teacher_unjudged():
    row = {"teacher_key": "", "linked": False}
    cr._attach(row, {}, {}, {})
    assert row["depth"] == "none" and row["minutes"] == 0 and row["profile_percent"] is None
