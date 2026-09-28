import datetime as dt
import json
import unittest

from pydantic import ValidationError
from app.schemas.rector_intelligence import IntelligenceQuery
from app.services.rector_intelligence import enrich_row, filter_rows, matches_name, normalize_name, summarize, validate_analysis


def row(name='Rahimov Ali', owner='1', **values):
    return enrich_row(dict(owner_key=owner, display_name=name, department='Terapiya',
                           minutes=values.get('minutes', 10), active_days=1,
                           created_total=values.get('created_total', 1),
                           lessons_total=values.get('lessons_total', 1),
                           is_active=values.get('is_active', True),
                           avg_student_score=values.get('avg_student_score', 70),
                           student_attempts=values.get('student_attempts', 10)))


class NameSearchTests(unittest.TestCase):
    def test_cyrillic_latin(self):
        self.assertEqual(normalize_name('Ғуломов Ўткир'), normalize_name('G‘ulomov Oʻtkir'))
        self.assertTrue(matches_name(row('Раҳимов Али'), 'ali rahimov'))
        self.assertTrue(matches_name(row('Шарипов Жасур'), 'sharipov jasur'))

    def test_surname_is_first_when_directory_has_separate_fields(self):
        r = enrich_row({**row(), 'first_name': 'Ali', 'last_name': 'Rahimov'})
        self.assertEqual(r['display_name'], 'Rahimov Ali')

    def test_exact_tokens_and_login(self):
        self.assertTrue(matches_name(row(), 'rahimov', 'exact'))
        self.assertFalse(matches_name(row('Rahimova Aliya'), 'rahimov', 'exact'))
        self.assertTrue(matches_name(row('Rahimova Aliya'), 'rahimov'))
        self.assertTrue(matches_name(row(owner='998901234567'), '998901234567', 'exact'))

    def test_apostrophes_and_order(self):
        self.assertTrue(matches_name(row('O‘rinov G‘ayrat'), "G'ayrat O`rinov", 'exact'))
        self.assertFalse(matches_name(row('Rahimov Ali'), 'Rahimov Vali'))


class EvidenceTests(unittest.TestCase):
    def test_unknown_score_is_not_zero(self):
        unknown = row(avg_student_score=None, student_attempts=0)
        zero = row('Rahimov Vali', '2', avg_student_score=0)
        self.assertEqual(filter_rows([unknown, zero], {'max_score': 55}), [zero])
        self.assertNotIn('low_results', unknown['signals'])
        self.assertEqual(filter_rows([unknown, zero], {'results': 'none'}), [unknown])

    def test_small_sample_not_flagged_as_failure(self):
        r = row(avg_student_score=10, student_attempts=2)
        self.assertTrue(r['small_sample'])
        self.assertNotIn('low_results', r['signals'])
        self.assertIn('low_results', row(avg_student_score=10, student_attempts=5)['signals'])

    def test_focus_is_and_and_department_is_exact(self):
        r1 = row(lessons_total=0, created_total=0)
        r2 = row('Other', '2', lessons_total=0)
        self.assertEqual(filter_rows([r1, r2], {'focus': 'no_lessons,no_materials'}), [r1])
        self.assertEqual(filter_rows([r1], {'department': 'terapi'}), [])
        self.assertEqual(filter_rows([r1], {'department': 'Терапия'}), [r1])

    def test_comparison_and_summary_are_selected_people(self):
        r = enrich_row(row(minutes=30), {'minutes': 20, 'created_total': 0, 'lessons_total': 0})
        self.assertEqual(r['delta']['minutes'], 10)
        self.assertEqual(summarize([r])['teachers'], 1)
        self.assertEqual(summarize([r])['minutes'], 30)

    def test_range_validation(self):
        base = dict(date_from=dt.date(2026, 9, 1), date_to=dt.date(2026, 9, 14))
        for values in [dict(min_minutes=5, max_minutes=3), dict(min_score=50, max_score=30),
                       dict(focus='made_up'), dict(date_to=dt.date(2026, 8, 1)), dict(max_score=101)]:
            with self.subTest(values=values), self.assertRaises(ValidationError):
                IntelligenceQuery(**{**base, **values})

    def test_valid_analysis_uses_database_evidence(self):
        r = row()
        output = validate_analysis(json.dumps({'summary': 'Tahlil', 'priorities': [
            {'owner_key': '1', 'display_name': 'Fake name', 'metric_keys': ['minutes'], 'action': 'Dars rejasini aniqlashtiring.', 'verification': 'Sessiyani tekshiring.'}]}), [r])
        self.assertEqual(output['priorities'][0]['display_name'], 'Rahimov Ali')
        self.assertEqual(output['priorities'][0]['evidence'][0]['value'], 10)

    def test_model_cannot_introduce_people_or_metrics(self):
        for owner, metric in [('missing', 'minutes'), ('1', 'invented_rating')]:
            with self.subTest(owner=owner, metric=metric), self.assertRaises(ValueError):
                validate_analysis(json.dumps({'summary': 'Tahlil', 'priorities': [
                    {'owner_key': owner, 'metric_keys': [metric], 'action': 'Tekshiring'}]}), [row()])


if __name__ == '__main__':
    unittest.main()
