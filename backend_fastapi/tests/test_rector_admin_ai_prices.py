from app.services import rector_admin_service as svc


def test_nano_is_priced_as_nano_not_gpt4o():
    # 1M kirish + 1M chiqish: nano $0.50, gpt-4o $12.50.
    assert round(svc._cost("gpt-4.1-nano", 1_000_000, 0, 1_000_000), 2) == 0.50
    assert round(svc._cost("gpt-4o", 1_000_000, 0, 1_000_000), 2) == 12.50
    assert svc._price("gpt-4o-mini-2024-07-18") == svc.AI_PRICES["gpt-4o-mini"]
