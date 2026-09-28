import datetime as dt
from unittest.mock import patch
from app.services import activity_report_service as service


def test_overview_and_daily_breakdown_round_the_same_way():
    start, end = dt.date(2026, 9, 1), dt.date(2026, 9, 3)
    seconds = {('teacher', start + dt.timedelta(days=i), 'lectures'): 35 for i in range(3)}
    with patch.object(service, 'page_minutes', return_value=seconds), \
         patch.object(service, 'page_opens', return_value={}), \
         patch.object(service, 'content_views', return_value={}), \
         patch.object(service, 'created_counts', return_value={}):
        all_rows = service.all_teachers_activity(None, start_day=start, end_day=end)
        detail = service.teacher_daily_activity(None, owner_key='teacher', start_day=start, end_day=end)
    assert all_rows['teacher']['minutes'] == detail['total_minutes'] == 3
    assert sum(p['minutes'] for p in detail['pages']) == 3
    assert sum(d['minutes'] for d in detail['days']) == 3
