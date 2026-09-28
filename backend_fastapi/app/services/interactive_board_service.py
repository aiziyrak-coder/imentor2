"""Verified room inventory supplied by the rector; explicit aliases only, no fuzzy claims."""
import json
from functools import lru_cache
from pathlib import Path

@lru_cache(maxsize=1)
def inventory():
    return json.loads((Path(__file__).resolve().parents[1] / 'data' / 'interactive_boards.json').read_text(encoding='utf-8'))

def department_key(value):
    from app.services.rector_intelligence import normalize_name
    return ' '.join(w for w in normalize_name(value).split() if w not in ('kafedra', 'kafedrasi', 'sillabus'))

@lru_cache(maxsize=1)
def department_index():
    index={}
    for record in inventory()['departments']:
        for name in [record['department'], *record.get('aliases', [])]:
            key=department_key(name)
            if key in index and index[key]['row'] != record['row']:
                raise ValueError('Ambiguous board department alias: '+name)
            index[key]=record
    return index

def board_info(department):
    source=inventory()
    record=department_index().get(department_key(department or ''))
    rooms=[*record['rooms'], *[r['room'] for r in record.get('extra_rooms', [])]] if record else []
    status='unknown' if record is None else 'available' if rooms else 'unavailable'
    reason={
        'available':'Interaktiv doska mavjud',
        'unavailable':'Interaktiv doska mavjud emas — berilgan jadvalda ishlaydigan auditoriya ko‘rsatilmagan. Dars ko‘rsatkichi kamchilik sifatida baholanmaydi.',
        'unknown':'Kafedra yoki uning jadvaldagi mosligi aniqlanmagan. Doska mavjudligi tasdiqlanmaguncha dars ko‘rsatkichi baholanmaydi.',
    }[status]
    return dict(status=status, reason=reason, department=record['department'] if record else None,
                rooms=rooms, unavailable_rooms=record.get('unavailable_rooms', []) if record else [],
                inventory_row=record['row'] if record else None,
                source_url=source['source_url'], checked_on=source['checked_on'])
