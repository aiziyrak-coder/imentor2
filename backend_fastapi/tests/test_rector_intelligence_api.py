from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import require_rector
from app.api.routes.rector import router
from app.core.db import get_db


def client(authorized=True):
    app = FastAPI()
    app.include_router(router, prefix='/api/v1')
    app.dependency_overrides[get_db] = lambda: None
    if authorized:
        # `require_rector` endi kontekst lug'atini qaytaradi (dekan uchun kafedralar bilan).
        app.dependency_overrides[require_rector] = lambda: {'kind': 'rektor', 'login': 'rektor', 'label': 'Rektor', 'departments': []}
    return TestClient(app)


def test_report_requires_auth():
    response = client(False).get('/api/v1/rector/intelligence/?date_from=2026-09-01&date_to=2026-09-14')
    assert response.status_code == 401


def test_query_validation_before_database():
    c = client()
    for query in [
        'date_from=2026-09-15&date_to=2026-09-14',
        'date_from=2026-09-01&date_to=2026-09-14&min_minutes=10&max_minutes=2',
        'date_from=2026-09-01&date_to=2026-09-14&focus=made_up',
    ]:
        response = c.get('/api/v1/rector/intelligence/?' + query)
        assert response.status_code == 422, response.text


def test_query_round_trip():
    with patch('app.services.rector_intelligence.build_report', side_effect=lambda db, f, **_kw: f.model_dump(mode='json')):
        response = client().get('/api/v1/rector/intelligence/', params={
            'date_from':'2026-09-01', 'date_to':'2026-09-14', 'q':'Раҳимов',
            'match_mode':'exact', 'compare':'false', 'focus':'no_lessons,no_materials'})
    assert response.status_code == 200
    assert response.json()['q'] == 'Раҳимов'
    assert response.json()['compare'] is False
    assert response.json()['match_mode'] == 'exact'


def test_analysis_requires_auth_before_model_call():
    with patch('app.services.rector_intelligence.analyze_report') as model:
        response = client(False).post('/api/v1/rector/intelligence/analyze/', json={
            'date_from':'2026-09-01', 'date_to':'2026-09-14'})
    assert response.status_code == 401
    model.assert_not_called()
