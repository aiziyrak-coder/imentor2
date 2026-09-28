import json
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from app.models.face_template import FaceTemplate
from app.services import face_login as fl


def unit(seed: int) -> list[float]:
    rng = np.random.default_rng(seed)
    v = rng.normal(size=512).astype(np.float32)
    return [float(x) for x in v / np.linalg.norm(v)]


def near(vec: list[float], noise: float, seed: int) -> list[float]:
    rng = np.random.default_rng(seed)
    v = np.asarray(vec, dtype=np.float32) + rng.normal(scale=noise, size=512).astype(np.float32)
    return [float(x) for x in v / np.linalg.norm(v)]


def matrix(*vecs):
    return np.asarray(vecs, dtype=np.float32)


# ------------------------------------------------------------------ decide


def test_two_frames_of_same_person_log_in():
    a, b = unit(1), unit(2)
    d = fl.decide([near(a, 0.02, 10), near(a, 0.02, 11)], [7, 8], ["3442000001", "3442000002"], matrix(a, b))
    assert d.status == "ok" and d.owner_key == "3442000001" and d.template_id == 7


def test_frames_matching_different_people_are_rejected():
    a, b = unit(1), unit(2)
    d = fl.decide([near(a, 0.02, 10), near(b, 0.02, 11)], [7, 8], ["u1", "u2"], matrix(a, b))
    assert d.status == "unknown"


def test_stranger_is_rejected():
    a, b = unit(1), unit(2)
    d = fl.decide([unit(99), unit(98)], [7, 8], ["u1", "u2"], matrix(a, b))
    assert d.status == "unknown"


def test_lookalikes_without_margin_are_rejected():
    a = unit(1)
    twin = near(a, 0.01, 5)  # ikki shablon deyarli bir xil
    d = fl.decide([near(a, 0.01, 10), near(a, 0.01, 11)], [7, 8], ["u1", "u2"], matrix(a, twin))
    assert d.status == "unknown"


def test_recognised_but_unlinked_face():
    a, b = unit(1), unit(2)
    d = fl.decide([near(a, 0.02, 10), near(a, 0.02, 11)], [7, 8], ["", "u2"], matrix(a, b))
    assert d.status == "unlinked" and d.template_id == 7


def test_missing_face_in_any_frame():
    a = unit(1)
    assert fl.decide([near(a, 0.02, 10), None], [7], ["u1"], matrix(a)).status == "no_face"


# ------------------------------------------------------------------ helpers


def test_name_key_ignores_spelling_variants():
    assert fl.name_key("Raximova", "Xusnidaxon") == fl.name_key("Rahimova ", "Husnidahon")
    assert fl.name_key("Sarimsaqov", "O‘ktam") == fl.name_key("sarimsakov", "o'ktam")


def test_parse_embedding_rejects_garbage():
    assert fl.parse_embedding("not json") is None
    assert fl.parse_embedding(json.dumps([0.1] * 10)) is None
    assert fl.parse_embedding(json.dumps([0.0] * 512)) is None
    vec = fl.parse_embedding(json.dumps([2.0] * 512))
    assert vec is not None and abs(np.linalg.norm(vec) - 1) < 1e-5


# ------------------------------------------------------------------ sync


class FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return list(self._items)


class FakeSession:
    def __init__(self, templates):
        self.templates = list(templates)
        self.committed = False

    def execute(self, _stmt):
        return FakeResult(self.templates)

    def add(self, obj):
        # Haqiqiy sessiya kabi: ustun sukutlari bu yerda QO'LLANMAYDI.
        self.templates.append(obj)

    def commit(self):
        self.committed = True


def user(username, last, first):
    return SimpleNamespace(username=username, last_name=last, first_name=first)


class FakeSessionWithRollback(FakeSession):
    rolled_back = False

    def rollback(self):
        self.rolled_back = True


def row(pid, full_name, seed):
    return {"id": pid, "full_name": full_name, "position": "Kafedra", "embedding": json.dumps(unit(seed))}


def test_sync_auto_links_only_unique_names_and_keeps_admin_links():
    admin_linked = FaceTemplate(
        source_person_id="p-admin", full_name="Karimov Ali Valiyevich", position="", embedding=json.dumps(unit(3)),
        owner_key="998900000009", link_source="admin", is_active=True,
    )
    db = FakeSession([admin_linked])
    users = [
        user("998913281198", "Raximova", "Xusnidaxon"),
        user("3442000001", "Aliyev", "Vali"),
        user("3442000002", "Aliyev", "Vali"),  # ikki hisob — avtomatik bog'lanmaydi
        user("3442000003", "Karimov", "Ali"),
    ]
    rows = [
        row("p-1", "Rahimova Husnidahon Valijon qizi", 1),
        row("p-2", "Aliyev Vali Salimovich", 2),
        row("p-admin", "Karimov Ali Valiyevich", 3),
    ]
    with patch.object(fl, "_face_login_users", return_value=users),          patch.object(fl, "_account_info", return_value={}):
        result = fl.sync_templates(db, rows)
    by_pid = {t.source_person_id: t for t in db.templates}
    assert by_pid["p-1"].owner_key == "998913281198" and by_pid["p-1"].link_source == "auto"
    assert by_pid["p-2"].owner_key == ""
    assert by_pid["p-admin"].owner_key == "998900000009" and by_pid["p-admin"].link_source == "admin"
    assert result.created == 2 and result.auto_linked == 1 and db.committed


def test_sync_deactivates_people_no_longer_enrolled():
    old = FaceTemplate(source_person_id="gone", full_name="Eski Odam", position="", embedding=json.dumps(unit(4)),
                       owner_key="", link_source="", is_active=True)
    db = FakeSession([old])
    with patch.object(fl, "_face_login_users", return_value=[]),          patch.object(fl, "_account_info", return_value={}):
        result = fl.sync_templates(db, [row("p-new", "Yangi Odam", 5)])
    assert old.is_active is False and result.deactivated == 1


# ------------------------------------------------------------------ yangi qoidalar


def test_name_key_strict_on_different_names():
    assert fl.name_key("Abdullayeva", "Diloramxon") != fl.name_key("Abdullayeva", "Dildoraxon")
    assert fl.name_key("Xaydarova", "Azizaxon") != fl.name_key("Xaydarov", "Azizjon")
    assert fl.name_key("Абдуллаев", "Икбол") == fl.name_key("Abdullayev", "Iqbol")
    assert fl.name_key("Xamdamova", "Shaxnoza") == fl.name_key("Xamdamova", "Shaxnozaxon")


def test_choose_account_phone_and_staff_id_of_one_person_prefers_used_one():
    phone, staff_id = user("998978531978", "Tojiboyeva", "Sadoqat"), user("3442412016", "Tojiboyeva", "Sadoqat")
    info = {"998978531978": {"activity": 2, "department": "Ovqatlanish"}, "3442412016": {"activity": 0, "department": "Kommunal"}}
    assert fl.choose_account([staff_id, phone], "Kommunal va mehnat gigienasi", info) == "998978531978"


def test_choose_account_two_namesakes_by_department():
    a, b = user("3442511169", "Xoshimov", "Ilxomjon"), user("3442211059", "Xoshimov", "Ilxomjon")
    info = {
        "3442511169": {"activity": 0, "department": "Stomatologiya va otorinolaringologiya"},
        "3442211059": {"activity": 0, "department": "Urologiya va onkologiya"},
    }
    assert fl.choose_account([a, b], "Stomatologiya va otorinolaringologiya", info) == "3442511169"
    assert fl.choose_account([a, b], "Kadrlar bo'limi", info) is None


def test_choose_account_tie_is_left_to_admin():
    phone1, phone2 = user("998900000001", "Aliyev", "Vali"), user("998900000002", "Aliyev", "Vali")
    assert fl.choose_account([phone1, phone2], "", {}) is None


def test_same_person_enrolled_twice_links_both_and_still_logs_in():
    db = FakeSessionWithRollback([])
    users = [user("998975558515", "Xabibullayev", "Fayzulla")]
    rows = [row("p-1", "Xabibullayev Fayzulla Nabibullayevich", 1), row("p-2", "Xabibullayev Fayzulla Nabibullayevich", 2)]
    with patch.object(fl, "_face_login_users", return_value=users), patch.object(fl, "_account_info", return_value={}):
        result = fl.sync_templates(db, rows)
    assert result.auto_linked == 2
    assert {t.owner_key for t in db.templates} == {"998975558515"}
    # Ikki yuz bir odamniki — bir-biriga "raqib" bo'lmaydi.
    a, b = json.loads(db.templates[0].embedding), json.loads(db.templates[1].embedding)
    d = fl.decide([near(a, 0.02, 10), near(a, 0.02, 11)], [1, 2], ["998975558515", "998975558515"], matrix(a, b))
    assert d.status == "ok" and d.owner_key == "998975558515"


def test_namesakes_in_camera_are_not_auto_linked():
    db = FakeSessionWithRollback([])
    users = [user("3442000001", "Aliyev", "Vali")]
    rows = [row("p-1", "Aliyev Vali Salimovich", 1), row("p-2", "Aliyev Vali Karimovich", 2)]
    with patch.object(fl, "_face_login_users", return_value=users), patch.object(fl, "_account_info", return_value={}):
        result = fl.sync_templates(db, rows)
    assert result.auto_linked == 0


def test_dry_run_changes_nothing():
    db = FakeSessionWithRollback([])
    with patch.object(fl, "_face_login_users", return_value=[user("3442000001", "Aliyev", "Vali")]),          patch.object(fl, "_account_info", return_value={}):
        result = fl.sync_templates(db, [row("p-1", "Aliyev Vali Salimovich", 1)], dry_run=True)
    assert result.links == [("Aliyev Vali Salimovich", "3442000001")]
    assert db.rolled_back and not db.committed


def test_choose_account_department_with_typo():
    a, b = user("3442511169", "Xoshimov", "Ilxomjon"), user("3442211059", "Xoshimov", "Ilxomjon")
    info = {
        "3442511169": {"activity": 0, "department": "Stomatologiya va otorinolaringologiya"},
        "3442211059": {"activity": 0, "department": "Urologiya va onkologiya"},
    }
    assert fl.choose_account([a, b], "Stomatologiya va otoloringologiya", info) == "3442511169"


def test_swapped_first_and_last_name_account_is_a_candidate():
    db = FakeSessionWithRollback([])
    staff_id = user("3442412066", "Boynazarova", "Zilolaxon")
    phone = user("998979409007", "Zilolaxon", "Boynazarova")
    info = {"3442412066": {"activity": 4}, "998979409007": {"activity": 73}}
    with patch.object(fl, "_face_login_users", return_value=[staff_id, phone]), patch.object(fl, "_account_info", return_value=info):
        result = fl.sync_templates(db, [row("p-1", "Boynazarova Zilola", 1)], dry_run=True)
    assert result.links == [("Boynazarova Zilola", "998979409007")]


def test_uzbek_o_apostrophe_matches_russified_u():
    assert fl.name_key("Ro'zaliyev", "Komiljon") == fl.name_key("Ruzaliyev", "Komiljon")
    assert fl.name_key("Рузматов", "Зухриддин") == fl.name_key("Ro‘zmatov", "Zuxriddin")
