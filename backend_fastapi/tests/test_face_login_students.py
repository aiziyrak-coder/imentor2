"""Talaba va malaka tinglovchisi yuz orqali kirishi (2026-09-19)."""

import datetime as dt
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np

from app.api.routes import face_login as route
from app.core.security import decode_token
from app.models.face_template import FaceTemplate
from app.services import face_login as fl


def unit(seed: int) -> list[float]:
    rng = np.random.default_rng(seed)
    v = rng.normal(size=512).astype(np.float32)
    return [float(x) for x in v / np.linalg.norm(v)]


def tpl(pid, name, owner="", source="", ptype="talaba"):
    return FaceTemplate(
        source_person_id=pid, full_name=name, position="", embedding=json.dumps(unit(1)),
        owner_key=owner, link_source=source, is_active=True, person_type=ptype, group_name="",
    )


class ListenerDb:
    def __init__(self, listeners):
        self.listeners = listeners

    def execute(self, _stmt):
        res = MagicMock()
        res.scalars.return_value.all.return_value = list(self.listeners)
        return res


NOW = dt.datetime(2026, 9, 19, tzinfo=dt.timezone.utc)


def test_student_face_links_to_unique_onlinetest_name_with_group():
    t = tpl("c-1", "Karimova Dilnoza Olimjon qizi")
    result = fl.SyncResult()
    students = [
        {"id": "3442001", "name": "Karimova Dilnoza", "group": "DI-2824"},
        {"id": "3442002", "name": "Aliyev Vali", "group": "DI-2825"},
    ]
    fl._link_students(ListenerDb([]), [t], {}, students, NOW, result)
    assert t.owner_key == "ot_3442001" and t.group_name == "DI-2824" and t.link_source == "auto"


def test_namesakes_in_onlinetest_are_not_linked():
    t = tpl("c-1", "Aliyev Vali Salimovich")
    students = [{"id": "1", "name": "Aliyev Vali", "group": "A"}, {"id": "2", "name": "Aliyev Vali", "group": "B"}]
    fl._link_students(ListenerDb([]), [t], {}, students, NOW, fl.SyncResult())
    assert t.owner_key == ""


def test_passport_links_to_malaka_listener_first():
    t = tpl("c-1", "Karimova Dilnoza Olimjon qizi")
    students = [{"id": "3442001", "name": "Karimova Dilnoza", "group": "DI-2824"}]
    fl._link_students(ListenerDb(["AA1111111"]), [t], {"c-1": "aa 1111111"}, students, NOW, fl.SyncResult())
    assert t.owner_key == "AA1111111"


def test_without_onlinetest_list_student_links_are_kept():
    t = tpl("c-1", "Karimova Dilnoza", owner="ot_3442001", source="auto")
    fl._link_students(ListenerDb([]), [t], {}, None, NOW, fl.SyncResult())
    assert t.owner_key == "ot_3442001"


def test_student_who_left_onlinetest_is_unlinked_but_admin_link_stays():
    gone = tpl("c-1", "Karimova Dilnoza", owner="ot_999", source="auto")
    admin = tpl("c-2", "Boshqa Odam", owner="ot_998", source="admin")
    fl._link_students(ListenerDb([]), [gone, admin], {}, [{"id": "1", "name": "X Y", "group": ""}], NOW, fl.SyncResult())
    assert gone.owner_key == "" and admin.owner_key == "ot_998"


def test_staff_rules_never_link_student_faces():
    student_face = tpl("c-1", "Karimov Ali Valiyevich")
    staff_user = SimpleNamespace(username="3442000003", last_name="Karimov", first_name="Ali")
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = [student_face]
    with patch.object(fl, "_face_login_users", return_value=[staff_user]), \
         patch.object(fl, "_account_info", return_value={}), \
         patch.object(fl, "_link_students"):
        fl.sync_templates(db, [{"id": "c-1", "full_name": "Karimov Ali Valiyevich", "position": "",
                                "embedding": json.dumps(unit(1)), "type": "talaba"}])
    assert student_face.owner_key == ""


def test_student_face_login_creates_ot_account_with_group():
    t = tpl("c-1", "Karimova Dilnoza Olimjon qizi", owner="ot_3442001", source="auto")
    t.group_name = "DI-2824"
    created = SimpleNamespace(id=9, username="ot_3442001", password="x", is_active=True, first_name="", last_name="")
    with patch.object(route.auth_service, "get_user_by_username", return_value=None), \
         patch.object(route.auth_service, "create_user", return_value=created) as create_user, \
         patch.object(route.auth_service, "set_user_role_group"), \
         patch.object(route.auth_service, "touch_last_login"), \
         patch.object(route, "record_activity_event"), \
         patch("app.api.routes.auth.sp.staff_photo_url_for_user", return_value=""):
        r = route._student_face_login(MagicMock(), "ot_3442001", t)
    claims = decode_token(r.access)
    assert create_user.call_args.args[1:] == ("ot_3442001", "", "Dilnoza", "Karimova")
    assert r.role == "student" and claims["student_id"] == "3442001" and claims["group_name"] == "DI-2824"
    assert created.password == ""
