import datetime as dt
from unittest.mock import patch
import pytest
from app.schemas.rector_intelligence import IntelligenceQuery
from app.services.rector_intelligence import criterion_status, build_report, filter_rows

def teacher(owner, minutes, name='Rahimov'):
    return dict(owner_key=owner, display_name=name, last_name=name, department='Terapiya', minutes=minutes,
                active_days=1, created_total=1, lessons_total=0, student_attempts=0,
                avg_student_score=None, is_active=minutes>0, students_taught=0, signals=[])

@pytest.mark.parametrize('minutes,days,boundary,expected', [(0,7,10,'red'),(69,7,10,'yellow'),(70,7,10,'green'),(70,7,11,'yellow'),(10,1,10,'green')])
def test_usage_boundary(minutes, days, boundary, expected):
    assert criterion_status(teacher('1',minutes),'usage',days,boundary)==expected

@pytest.mark.parametrize('score,attempts,expected', [(None,0,'none'),(20,4,'none'),(55.9,5,'red'),(56,5,'yellow'),(70.9,5,'yellow'),(71,5,'green')])
def test_result_status_requires_evidence(score,attempts,expected):
    assert criterion_status({'avg_student_score':score,'student_attempts':attempts},'results',7)==expected

def test_status_counts_keep_other_filters_and_ignore_selected_color():
    rows=[teacher('1',0),teacher('2',69),teacher('3',70),{**teacher('4',0), 'department':'Other'}]
    filters=IntelligenceQuery(date_from=dt.date(2026,9,8),date_to=dt.date(2026,9,14),department='Terapiya',status='red',compare=False)
    with patch('app.services.rector_report_service.teacher_report',return_value=rows):
        report=build_report(None,filters)
    assert report['count']==1
    assert report['rows'][0]['owner_key']=='1'
    assert report['status_counts']=={'red':1,'yellow':1,'green':1,'none':0}
    assert report['summary']['minutes']==0

def test_sort_both_directions_and_missing_scores_last():
    rows=[teacher('1',20,'Aliyev'),teacher('2',10,'Valiyev')]
    assert [r['owner_key'] for r in filter_rows(rows,{'sort':'name_desc'})]==['2','1']
    rows[0]['avg_student_score']=0
    for sort in ('score','score_desc'):
        assert filter_rows(rows,{'sort':sort})[0]['owner_key']=='1'

def test_content_boundaries():
    assert criterion_status({'created_total':0},'materials',7)=='red'
    assert criterion_status({'created_total':4},'materials',7)=='yellow'
    assert criterion_status({'created_total':5},'materials',7)=='green'
    assert criterion_status({'lessons_total':2},'lessons',7)=='yellow'
    assert criterion_status({'lessons_total':3},'lessons',7)=='green'
