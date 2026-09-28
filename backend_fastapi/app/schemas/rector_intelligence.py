from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class IntelligenceQuery(BaseModel):
    date_from: dt.date
    date_to: dt.date
    department: str = Field(default='', max_length=200)
    q: str = Field(default='', max_length=128)
    match_mode: Literal['contains', 'exact'] = 'contains'
    activity: Literal['all', 'active', 'inactive'] = 'all'
    board: Literal['all', 'available', 'unavailable', 'unknown'] = 'all'
    criterion: Literal['usage', 'materials', 'lessons', 'results'] = 'usage'
    status: Literal['all', 'red', 'yellow', 'green', 'none'] = 'all'
    green_minutes_per_day: int = Field(default=10, ge=1, le=1440)
    focus: str = Field(default='', max_length=200)
    min_minutes: int | None = Field(default=None, ge=0, le=1000000)
    max_minutes: int | None = Field(default=None, ge=0, le=1000000)
    min_score: float | None = Field(default=None, ge=0, le=100)
    max_score: float | None = Field(default=None, ge=0, le=100)
    results: Literal['all', 'has', 'none'] = 'all'
    sort: Literal['name', 'name_desc', 'department', 'attention', 'minutes_desc', 'minutes_asc', 'lessons', 'lessons_asc', 'materials', 'materials_asc', 'score', 'score_desc', 'days', 'days_asc', 'students', 'students_asc'] = 'name'
    compare: bool = True

    @model_validator(mode='after')
    def validate_ranges(self):
        if self.date_from > self.date_to:
            raise ValueError('Boshlanish sanasi tugash sanasidan keyin bo‘lmasin.')
        if (self.date_to - self.date_from).days >= 366:
            raise ValueError('Eng ko‘pi 366 kunni tanlang.')
        for lo, hi in ((self.min_minutes, self.max_minutes), (self.min_score, self.max_score)):
            if lo is not None and hi is not None and lo > hi:
                raise ValueError('Eng kam qiymat eng ko‘p qiymatdan oshmasin.')
        allowed = {'no_activity', 'no_lessons', 'no_materials', 'low_results', 'no_results'}
        if set(filter(None, self.focus.split(','))) - allowed:
            raise ValueError('Noma’lum filtr.')
        return self


class IntelligenceAnalysisRequest(IntelligenceQuery):
    question: str = Field(default='Kimga qanday yordam kerak va qaysi ishlar ustuvor?', max_length=600)
    owner_keys: list[str] = Field(default_factory=list, max_length=30)
