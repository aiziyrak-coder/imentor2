import datetime as dt
import json
from unittest.mock import patch
import pytest
from app.schemas.rector_intelligence import IntelligenceQuery
from app.services.interactive_board_service import board_info, inventory, department_index
from app.services.rector_intelligence import enrich_row, criterion_status, filter_rows, build_report, validate_analysis

def teacher(department, owner='1'):
    return dict(owner_key=owner,display_name='Test Teacher',department=department,
                minutes=0, active_days=0, created_total=0, lessons_total=0, is_active=False,
                avg_student_score=None,student_attempts=0,board=board_info(department))

def test_full_supplied_inventory_and_explicit_aliases():
    records=inventory()['departments']
    assert len(records)==28
    assert sum(bool(r['rooms']) for r in records)==16
    assert sum(len(r['rooms']) for r in records)==99
    assert department_index()
    assert board_info('Normal anatomiya')['inventory_row']==10
    assert board_info('Mikrobiologiya,virusologiya,immunologiya')['status']=='available'
    assert board_info('Nevrologiya va psixatriya')['status']=='available'
    assert board_info('Неврология ва психатрия')['status']=='available'
    # 2026-09-17: kafedra jadval bilan 2 ta xona yubordi (extra_rooms, MON-100/101).
    assert board_info('Umumiy xirurgiya')['status']=='available'
    assert len(board_info('Umumiy xirurgiya')['rooms'])==2
    assert board_info('Terapiya UASH')['status']=='unavailable'
    assert board_info('Endokrinologiya,gemotologiya va ftiziatriya sillabus')['status']=='unavailable'

def test_faulty_room_excluded_and_reason_has_source():
    info=board_info('Ijtimoiy fanlar')
    assert len(info['rooms'])==3
    assert len(info['unavailable_rooms'])==1
    assert all('Nosoz' not in r for r in info['rooms'])
    assert info['source_url'].startswith('https://docs.google.com/')
    assert info['checked_on']=='2026-10-09'

@pytest.mark.parametrize('department', ['Pediatriya','Akusherlik va ginekologiya','', 'Unknown department'])
def test_unavailable_or_unknown_never_lesson_failure(department):
    row=enrich_row(teacher(department))
    assert 'no_lessons' not in row['signals']
    assert criterion_status(row,'lessons',7)=='none'
    assert criterion_status(row,'usage',7)=='red'
    assert 'no_materials' in row['signals']

def test_equipped_departments_still_have_lesson_requirement():
    row=enrich_row(teacher('Fiziologiya'))
    assert 'no_lessons' in row['signals']
    assert criterion_status(row,'lessons',7)=='red'

def test_unknown_is_not_false_absence_and_not_fuzzy_match():
    assert board_info('')['status']=='unknown'
    assert board_info('Pediatriya X')['status']=='unknown'

def test_lesson_color_scopes_and_board_filters_agree():
    rows=[teacher('Fiziologiya','1'),teacher('Pediatriya','2'),teacher('','3')]
    q=IntelligenceQuery(date_from=dt.date(2026,9,8),date_to=dt.date(2026,9,14),criterion='lessons',compare=False)
    with patch('app.services.rector_report_service.teacher_report',return_value=rows):
        report=build_report(None,q)
    assert report['status_counts']==dict(red=1,yellow=0,green=0,none=2)
    assert [r['owner_key'] for r in filter_rows(report['rows'],{'focus':'no_lessons'})]==['1']
    assert [r['owner_key'] for r in filter_rows(report['rows'],{'board':'unavailable'})]==['2']

def test_ai_cannot_turn_lesson_evidence_into_demand_for_unavailable_board():
    raw=json.dumps({'summary':'Test','priorities':[{'owner_key':'1','metric_keys':['lessons_total'],
                  'action':'Dars o‘tkazing','verification':'Darsni tekshiring'}]})
    priority=validate_analysis(raw,[enrich_row(teacher('Pediatriya'))])['priorities'][0]
    assert 'doska mavjud emas' in priority['action']
    assert 'baholanmaydi' in priority['action']
    assert priority['evidence'][0]['value']==0

@pytest.mark.parametrize('action', ['Faol kunlar uchun darslar rejasini tuzing', 'Talabalarni jalb qilib testlar o‘tkazish'])
def test_ai_blocks_lesson_demand_even_when_metric_is_not_lessons(action):
    raw=json.dumps({'summary':'Test','priorities':[{'owner_key':'1','metric_keys':['active_days'],
                  'action':action,'verification':'Darsni tekshiring'}]})
    priority=validate_analysis(raw,[enrich_row(teacher('Pediatriya'))])['priorities'][0]
    assert 'doska mavjud emas' in priority['action']
    assert 'baholanmaydi' in priority['action']

def test_repeated_ai_entries_merge_evidence_and_keep_equipment_exemption():
    raw=json.dumps({'summary':'Test','priorities':[
        {'owner_key':'1','metric_keys':['created_total'],'action':'Materiallarni tekshiring','verification':'Mavzuni oching'},
        {'owner_key':'1','metric_keys':['active_days'],'action':'Darslar rejasini tuzing','verification':'Darsni tekshiring'}]})
    result=validate_analysis(raw,[enrich_row(teacher('Pediatriya'))])['priorities']
    assert len(result)==1
    assert 'doska mavjud emas' in result[0]['action']
    assert {e['key'] for e in result[0]['evidence']}=={'created_total','active_days'}
