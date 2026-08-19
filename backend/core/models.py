from django.db import models
from pgvector.django import VectorField


class PreparedContent(models.Model):
    KIND_LECTURE = 'lecture'
    KIND_PRESENTATION = 'presentation'
    KIND_CASE = 'case'
    KIND_TEST = 'test'
    KIND_CHOICES = (
        (KIND_LECTURE, 'Ma\'ruza'),
        (KIND_PRESENTATION, 'Taqdimot'),
        (KIND_CASE, 'Klinik holat'),
        (KIND_TEST, 'Test'),
    )

    owner_key = models.CharField(max_length=128, db_index=True)
    kind = models.CharField(max_length=32, db_index=True, choices=KIND_CHOICES)
    topic = models.CharField(max_length=255)
    topic_norm = models.CharField(max_length=255, db_index=True)
    author_display_name = models.CharField(max_length=128, blank=True, default='')
    subject_name = models.CharField(max_length=255, blank=True, default='', db_index=True)
    subject_code = models.CharField(max_length=64, blank=True, default='', db_index=True)
    variant_label = models.CharField(max_length=128, blank=True, default='', db_index=True)
    topic_code = models.CharField(max_length=32, blank=True, default='', db_index=True)
    # Fanga qat'iy bog'lanish (test bazasi fan bo'yicha guruhlanadi). Fan o'chsa NULL.
    syllabus = models.ForeignKey(
        'CourseSyllabus',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='prepared_contents',
    )
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Tayyor kontent"
        verbose_name_plural = "Tayyor kontentlar"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['owner_key', 'kind', 'topic_norm', '-created_at']),
            models.Index(
                fields=['kind', 'subject_code', 'variant_label', 'topic_code'],
                name='core_prep_kind_subj_var_topic',
            ),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.kind}:{self.topic}"


class SyllabusDocument(models.Model):
    """
    Legacy: per-user syllabus (deprecated). Yangi katalog — CourseSyllabus.
    """

    owner_key = models.CharField(max_length=128, db_index=True)
    external_id = models.CharField(max_length=128)
    file_name = models.CharField(max_length=512)
    topics = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Eski syllabus hujjati"
        verbose_name_plural = "Eski syllabus hujjatlari"
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['owner_key', 'external_id'],
                name='core_syllabus_owner_external_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['owner_key', '-created_at']),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.file_name}"


class AcademicDepartment(models.Model):
    """Kafedra — fan syllabus katalogining yuqori darajasi."""

    name = models.CharField(max_length=255, unique=True, db_index=True)
    code = models.CharField(max_length=64, unique=True, db_index=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Kafedra"
        verbose_name_plural = "Kafedralar"
        ordering = ["sort_order", "name"]

    def __str__(self) -> str:
        return self.name


class CourseSyllabus(models.Model):
    """
    Administrator yuklaydigan markaziy fan syllabus (barcha o'qituvchilar uchun katalog).
    """

    LANG_UZ = "uz"
    LANG_EN = "en"
    LANG_RU = "ru"
    INSTRUCTION_LANGUAGE_CHOICES = (
        (LANG_UZ, "O'zbek"),
        (LANG_EN, "Ingliz"),
        (LANG_RU, "Rus"),
    )

    subject_name = models.CharField(max_length=255, db_index=True)
    subject_code = models.CharField(max_length=64, unique=True, db_index=True)
    department = models.ForeignKey(
        AcademicDepartment,
        on_delete=models.PROTECT,
        related_name="subjects",
        null=True,
        blank=True,
    )
    description = models.CharField(max_length=512, blank=True)
    instruction_language = models.CharField(
        max_length=8,
        choices=INSTRUCTION_LANGUAGE_CHOICES,
        default=LANG_UZ,
        db_index=True,
    )
    file_name = models.CharField(max_length=512)
    topics = models.JSONField(default=list)
    # Bir fan ichida bir nechta yo'nalish PDF (masalan: PI, DI, TPI)
    variants = models.JSONField(default=list, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Fan syllabus katalogi"
        verbose_name_plural = "Fan syllabus katalogi"
        ordering = ['sort_order', 'subject_name']
        indexes = [
            models.Index(fields=['is_active', 'sort_order', 'subject_name']),
            models.Index(
                fields=['department', 'subject_name'],
                name='core_course_dept_subj_idx',
            ),
        ]

    def __str__(self) -> str:
        return self.subject_name


class StaffCourseSelection(models.Model):
    """O'qituvchi tanlagan fan(lar) — shu fan mavzulari ko'rinadi."""

    owner_key = models.CharField(max_length=128, db_index=True)
    syllabus = models.ForeignKey(
        CourseSyllabus,
        on_delete=models.CASCADE,
        related_name='selections',
    )
    # Admin biriktirganda qat'iy: aynan shu yo'nalish/variant bo'yicha dars beradi.
    # Bo'sh — hali qat'iy belgilanmagan (masalan o'qituvchi o'zi tanlagan bo'lsa).
    variant_label = models.CharField(max_length=128, blank=True, default="")
    selected_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "O'qituvchi fan tanlovi"
        verbose_name_plural = "O'qituvchi fan tanlovlari"
        ordering = ['-selected_at']
        constraints = [
            # Bitta o'qituvchi bitta fanning bir nechta yo'nalishiga (variant)
            # biriktirilishi mumkin — noyoblik (o'qituvchi + fan + variant) bo'yicha.
            models.UniqueConstraint(
                fields=['owner_key', 'syllabus', 'variant_label'],
                name='core_staff_course_selection_variant_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['owner_key', '-selected_at']),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.syllabus.subject_code}"


class LiveTestSession(models.Model):
    """
    Teacher-published live quiz for QR access; payload holds topic + questions (JSON).
    Students fetch by session_key without auth; teacher owns via owner_key (JWT username).
    """

    session_key = models.CharField(max_length=160, unique=True, db_index=True)
    owner_key = models.CharField(max_length=128, db_index=True)
    payload = models.JSONField()
    # Fan kesimida natijalar/statistika uchun — bo'sh bo'lishi mumkin (eski yozuvlar).
    subject_code = models.CharField(max_length=200, blank=True, default='', db_index=True)
    is_closed = models.BooleanField(default=False, db_index=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Jonli test sessiyasi"
        verbose_name_plural = "Jonli test sessiyalari"
        ordering = ['-created_at']

    def __str__(self) -> str:
        return self.session_key


class LiveTestSubmission(models.Model):
    session = models.ForeignKey(LiveTestSession, on_delete=models.CASCADE, related_name='submissions')
    participant_key = models.CharField(max_length=64, blank=True, default='', db_index=True)
    # OnlineTest AppUser.id — login qilgan talaba (guest bo'lsa bo'sh)
    student_id = models.CharField(max_length=64, blank=True, default='', db_index=True)
    first_name = models.CharField(max_length=128)
    last_name = models.CharField(max_length=128)
    answers = models.JSONField()
    submitted_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Test javobi"
        verbose_name_plural = "Test javoblari"
        ordering = ['-submitted_at']

    def __str__(self) -> str:
        return f"{self.session.session_key}:{self.last_name}"


class LiveTestDraft(models.Model):
    """Talaba QR orqali test ochganda va yuborishdan oldin draft javoblarni saqlaydi."""

    session = models.ForeignKey(LiveTestSession, on_delete=models.CASCADE, related_name='drafts')
    participant_key = models.CharField(max_length=64, db_index=True)
    first_name = models.CharField(max_length=128, blank=True, default='')
    last_name = models.CharField(max_length=128, blank=True, default='')
    answers = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        verbose_name = "Test draft"
        verbose_name_plural = "Test draftlari"
        constraints = [
            models.UniqueConstraint(
                fields=['session', 'participant_key'],
                name='uniq_live_test_draft_participant',
            ),
        ]
        ordering = ['-updated_at']

    def __str__(self) -> str:
        return f"{self.session.session_key}:{self.participant_key}"


class StartupProjectApplication(models.Model):
    """
    Startuper / innovatsiya loyihasi: loyiha tavsifi, AI tahlil, administratorga yuborish.
    """

    STATUS_DRAFT = "draft"
    STATUS_SUBMITTED = "submitted"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Qoralama"),
        (STATUS_SUBMITTED, "Yuborilgan"),
    )

    PARTICIPANT_STUDENT = "student"
    PARTICIPANT_EMPLOYEE = "employee"

    owner_key = models.CharField(max_length=128, db_index=True)
    title = models.CharField(max_length=512)
    summary = models.TextField(blank=True)
    description = models.TextField(blank=True)
    participant_kind = models.CharField(max_length=16, default=PARTICIPANT_STUDENT)

    DOMAIN_STARTUP = "startup"
    DOMAIN_RESEARCH = "research"
    DOMAIN_CHOICES = (
        (DOMAIN_STARTUP, "Startap"),
        (DOMAIN_RESEARCH, "Ilmiy tadqiqot"),
    )
    project_domain = models.CharField(
        max_length=20,
        default=DOMAIN_STARTUP,
        db_index=True,
    )
    workspace_profile = models.JSONField(default=dict)

    profile_snapshot = models.JSONField(default=dict)
    ai_pack = models.JSONField(default=dict)
    submission_dossier = models.JSONField(default=dict)
    status = models.CharField(max_length=16, default=STATUS_DRAFT, db_index=True)
    submitted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Startap arizasi"
        verbose_name_plural = "Startap arizalari"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner_key", "-updated_at"]),
            models.Index(fields=["status", "-submitted_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.title[:40]}"


class CampusBuilding(models.Model):
    """
    Universitet kampusidagi bino (oldindan kiritiladi, jadvalda tanlanadi).
    """

    name = models.CharField(max_length=255, db_index=True)
    short_code = models.CharField(max_length=64, blank=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius_m = models.PositiveIntegerField(default=100)
    boundary = models.JSONField(
        default=list,
        blank=True,
        help_text="Bino chegarasi: [[lat, lng], ...] kamida 3 nuqta.",
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    notes = models.CharField(max_length=512, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Kampus binosi"
        verbose_name_plural = "Kampus binolari"
        ordering = ["sort_order", "name"]
        indexes = [
            models.Index(fields=["is_active", "sort_order", "name"]),
        ]

    def __str__(self) -> str:
        return self.name

    def boundary_ring(self) -> list[tuple[float, float]]:
        from .geo import normalize_boundary

        return normalize_boundary(self.boundary)

    def contains_point(self, lat: float, lng: float) -> bool:
        from .geo import haversine_m

        return haversine_m(lat, lng, self.latitude, self.longitude) <= float(self.radius_m)


class StaffScheduleSlot(models.Model):
    """
    O'qituvchi uchun kutilgan joy va vaqt (admin belgilaydi).
    weekday: 0=Dushanba ... 6=Yakshanba (Python weekday).
    week_phase: every=har hafta; upper/lower=ISO hafta toq/juft (yuqori/pastki).
    """

    WEEK_EVERY = "every"
    WEEK_UPPER = "upper"
    WEEK_LOWER = "lower"
    WEEK_PHASE_CHOICES = [
        (WEEK_EVERY, "Har hafta"),
        (WEEK_UPPER, "Yuqori hafta (ISO toq)"),
        (WEEK_LOWER, "Pastki hafta (ISO juft)"),
    ]

    owner_key = models.CharField(max_length=128, db_index=True)
    week_phase = models.CharField(
        max_length=16,
        choices=WEEK_PHASE_CHOICES,
        default=WEEK_EVERY,
        db_index=True,
    )
    weekday = models.SmallIntegerField(db_index=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    building = models.ForeignKey(
        CampusBuilding,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="schedule_slots",
    )
    building_name = models.CharField(max_length=255)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius_m = models.PositiveIntegerField(default=100)
    title = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Xodim jadval sloti"
        verbose_name_plural = "Xodim jadval slotlari"
        ordering = ["owner_key", "week_phase", "weekday", "start_time"]
        indexes = [
            models.Index(fields=["owner_key", "weekday", "is_active"]),
            models.Index(fields=["owner_key", "week_phase", "weekday", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.week_phase}:{self.weekday}:{self.start_time}"

    def get_expected_point(self) -> tuple[float, float, int, str]:
        """Kutilgan nuqta: bog'langan bino (yangilanadi) yoki slotdagi snapshot."""
        if self.building_id:
            b = self.building
            return b.latitude, b.longitude, int(b.radius_m), b.name
        return self.latitude, self.longitude, int(self.radius_m), self.building_name


class StaffLocationPing(models.Model):
    """O'qituvchi telefonidan kelgan GPS ping."""

    owner_key = models.CharField(max_length=128, db_index=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    accuracy_m = models.FloatField(null=True, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    client_ts_ms = models.BigIntegerField(null=True, blank=True)

    class Meta:
        verbose_name = "Joylashuv pingi"
        verbose_name_plural = "Joylashuv pinglari"
        ordering = ["-recorded_at"]
        indexes = [
            models.Index(fields=["owner_key", "-recorded_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}@{self.recorded_at}"


class StaffLocationAlert(models.Model):
    """
    Dars oynasida radiusdan tashqarida aniqlangan holat (bir slot kuniga cheklangan takror).
    """

    owner_key = models.CharField(max_length=128, db_index=True)
    slot = models.ForeignKey(
        StaffScheduleSlot,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="alerts",
    )
    building_name = models.CharField(max_length=255, blank=True)
    expected_lat = models.FloatField()
    expected_lng = models.FloatField()
    actual_lat = models.FloatField()
    actual_lng = models.FloatField()
    distance_m = models.FloatField()
    radius_m = models.PositiveIntegerField()
    slot_start = models.TimeField(null=True, blank=True)
    slot_end = models.TimeField(null=True, blank=True)
    message = models.CharField(max_length=512, blank=True)
    alert_date = models.DateField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Joylashuv ogohlantirishi"
        verbose_name_plural = "Joylashuv ogohlantirishlari"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner_key", "-created_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["owner_key", "slot", "alert_date"],
                name="core_stafflocationalert_owner_slot_day_uniq",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:alert@{self.created_at}"


def _handout_topic_dir(topic_norm: str) -> str:
    import re

    slug = re.sub(r"[^\w.\-]+", "_", (topic_norm or "").strip().lower())[:80]
    return slug.strip("_") or "topic"


def handout_upload_to(instance: "TopicHandout", filename: str) -> str:
    import re

    safe = re.sub(r"[^\w.\-]", "_", filename)[:180]
    return f"handouts/{_handout_topic_dir(instance.topic_norm)}/{instance.owner_key}_{safe}"


class TopicHandout(models.Model):
    """
    Syllabus mavzusiga bog‘langan tarqatma (PDF / rasm).
    Barcha hodimlar bir mavzu bo‘yicha yuklangan materiallarni ko‘radi.
    """

    KIND_PDF = "pdf"
    KIND_IMAGE = "image"
    KIND_CHOICES = (
        (KIND_PDF, "PDF"),
        (KIND_IMAGE, "Rasm"),
    )

    owner_key = models.CharField(max_length=128, db_index=True)
    author_name = models.CharField(max_length=255, blank=True)
    topic = models.CharField(max_length=255)
    topic_norm = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=KIND_PDF)
    file = models.FileField(upload_to=handout_upload_to, max_length=512)
    file_name = models.CharField(max_length=512)
    file_size = models.PositiveIntegerField(default=0)
    language = models.CharField(max_length=8, default="uz", db_index=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Mavzu tarqatmasi"
        verbose_name_plural = "Mavzu tarqatmalari"
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(fields=["topic_norm", "sort_order", "created_at"]),
            models.Index(fields=["owner_key", "-created_at"]),
            models.Index(fields=["topic_norm", "language"]),
        ]

    def __str__(self) -> str:
        return f"{self.topic_norm}:{self.file_name}"


def presentation_upload_to(instance: "TopicPresentation", filename: str) -> str:
    import re

    safe = re.sub(r"[^\w.\-]", "_", filename)[:180]
    return f"presentations/{_handout_topic_dir(instance.topic_norm)}/{instance.owner_key}_{safe}"


class TopicPresentation(models.Model):
    """Syllabus mavzusiga bog‘langan taqdimot (PDF / PPT / PPTX)."""

    KIND_PDF = "pdf"
    KIND_PPT = "ppt"
    KIND_PPTX = "pptx"
    KIND_CHOICES = (
        (KIND_PDF, "PDF"),
        (KIND_PPT, "PPT"),
        (KIND_PPTX, "PPTX"),
    )

    owner_key = models.CharField(max_length=128, db_index=True)
    author_name = models.CharField(max_length=255, blank=True)
    topic = models.CharField(max_length=255)
    topic_norm = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=KIND_PDF)
    file = models.FileField(upload_to=presentation_upload_to, max_length=512)
    file_name = models.CharField(max_length=512)
    file_size = models.PositiveIntegerField(default=0)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Mavzu taqdimoti"
        verbose_name_plural = "Mavzu taqdimotlari"
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(fields=["topic_norm", "sort_order", "created_at"]),
            models.Index(fields=["owner_key", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.topic_norm}:{self.file_name}"


class TopicVideo(models.Model):
    """Syllabus mavzusiga biriktirilgan YouTube video (admin qo‘shadi, o‘qituvchi ko‘radi)."""

    owner_key = models.CharField(max_length=128, db_index=True)
    author_name = models.CharField(max_length=255, blank=True)
    topic = models.CharField(max_length=255)
    topic_norm = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=255, blank=True)
    youtube_url = models.CharField(max_length=512)
    youtube_id = models.CharField(max_length=32, db_index=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Mavzu videosi"
        verbose_name_plural = "Mavzu videolari"
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(
                fields=['topic_norm', 'sort_order', 'created_at'],
                name='core_topicv_topic_n_6e0c9e_idx',
            ),
        ]

    def __str__(self) -> str:
        return f"{self.topic_norm}:{self.youtube_id}"


class DevicePairingSession(models.Model):
    """
    Hodim: kompyuter QR ↔ telefon login. GPS faqat telefondan.
    """

    STATUS_PENDING = "pending"
    STATUS_CONFIRMED = "confirmed"
    STATUS_PICKED_UP = "picked_up"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Kutilmoqda"),
        (STATUS_CONFIRMED, "Tasdiqlangan"),
        (STATUS_PICKED_UP, "Ulangan"),
        (STATUS_EXPIRED, "Muddati tugagan"),
    ]

    pairing_token = models.CharField(max_length=64, unique=True, db_index=True)
    desktop_secret = models.CharField(max_length=64, blank=True, db_index=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    owner_key = models.CharField(max_length=128, blank=True, db_index=True)
    role = models.CharField(max_length=16, default="hodim")
    profile_snapshot = models.JSONField(default=dict)
    access_token = models.TextField(blank=True)
    refresh_token = models.TextField(blank=True)
    expires_at = models.DateTimeField(db_index=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Qurilma ulanishi"
        verbose_name_plural = "Qurilma ulanishlari"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "expires_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.pairing_token[:8]}…:{self.status}"


def staff_avatar_upload_to(instance: "StaffProfile", filename: str) -> str:
    import re

    safe = re.sub(r"[^\w.\-]", "_", filename)[:180]
    return f"avatars/{instance.owner_key}_{safe}"


class StaffProfile(models.Model):
    """Xodim profili — rasm va admin panelida ko'rinadigan qo'shimcha ma'lumotlar."""

    PARTICIPANT_STUDENT = "student"
    PARTICIPANT_EMPLOYEE = "employee"
    PARTICIPANT_KIND_CHOICES = (
        (PARTICIPANT_STUDENT, "Talaba"),
        (PARTICIPANT_EMPLOYEE, "Xodim"),
    )

    owner_key = models.CharField(max_length=128, unique=True, db_index=True)
    photo = models.FileField(upload_to=staff_avatar_upload_to, max_length=512, blank=True)
    faculty = models.CharField(max_length=255, blank=True, default="")
    department = models.CharField(max_length=255, blank=True, default="")
    academic_department = models.ForeignKey(
        "AcademicDepartment",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="staff_profiles",
        db_column="department_id",
    )
    direction = models.CharField(max_length=255, blank=True, default="")
    participant_kind = models.CharField(
        max_length=16, choices=PARTICIPANT_KIND_CHOICES, blank=True, default=""
    )
    study_group = models.CharField(max_length=128, blank=True, default="")
    job_title = models.CharField(max_length=255, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Xodim profili"
        verbose_name_plural = "Xodim profillari"
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.owner_key


class ClinicalGroup(models.Model):
    """Klinika / tibbiyot guruhi — alohida tenant."""

    PLAN_BASIC = "basic"
    PLAN_STANDARD = "standard"
    PLAN_PREMIUM = "premium"
    PLAN_CHOICES = [
        (PLAN_BASIC, "Basic"),
        (PLAN_STANDARD, "Standard"),
        (PLAN_PREMIUM, "Premium"),
    ]

    STATUS_ACTIVE = "active"
    STATUS_TRIAL = "trial"
    STATUS_SUSPENDED = "suspended"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_TRIAL, "Trial"),
        (STATUS_SUSPENDED, "Suspended"),
        (STATUS_EXPIRED, "Expired"),
    ]

    name = models.CharField(max_length=255)
    code = models.SlugField(max_length=64, unique=True, blank=True)
    address = models.CharField(max_length=512, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    contact_person = models.CharField(max_length=255, blank=True)
    subscription_plan = models.CharField(
        max_length=32, choices=PLAN_CHOICES, default=PLAN_STANDARD
    )
    subscription_status = models.CharField(
        max_length=32, choices=STATUS_CHOICES, default=STATUS_ACTIVE
    )
    subscription_until = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Klinika guruhi"
        verbose_name_plural = "Klinika guruhlari"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class ClinicalGroupMember(models.Model):
    """Klinika guruhidagi foydalanuvchi."""

    clinic = models.ForeignKey(
        ClinicalGroup, on_delete=models.CASCADE, related_name="members"
    )
    owner_key = models.CharField(max_length=128, db_index=True)
    app_role = models.CharField(max_length=16, default="hodim")
    is_clinic_admin = models.BooleanField(default=False)
    first_name = models.CharField(max_length=128, blank=True)
    last_name = models.CharField(max_length=128, blank=True)
    faculty = models.CharField(max_length=255, blank=True)
    department = models.CharField(max_length=255, blank=True)
    direction = models.CharField(max_length=255, blank=True)
    job_title = models.CharField(max_length=255, blank=True)
    study_group = models.CharField(max_length=128, blank=True)
    participant_kind = models.CharField(max_length=16, blank=True, default="")
    is_active = models.BooleanField(default=True)
    joined_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Klinika aʼzosi"
        verbose_name_plural = "Klinika aʼzolari"
        ordering = ["-is_clinic_admin", "last_name", "first_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["clinic", "owner_key"],
                name="core_clinicalgroupmember_clinic_owner_uniq",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key} @ {self.clinic.name}"


class ClinicalGroupPayment(models.Model):
    """Klinika to‘lovlari."""

    STATUS_PENDING = "pending"
    STATUS_PAID = "paid"
    STATUS_OVERDUE = "overdue"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Kutilmoqda"),
        (STATUS_PAID, "To‘langan"),
        (STATUS_OVERDUE, "Muddati o‘tgan"),
        (STATUS_CANCELLED, "Bekor qilingan"),
    ]

    clinic = models.ForeignKey(
        ClinicalGroup, on_delete=models.CASCADE, related_name="payments"
    )
    amount_uzs = models.DecimalField(max_digits=14, decimal_places=2)
    period_label = models.CharField(max_length=128)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    payment_method = models.CharField(max_length=64, blank=True)
    reference = models.CharField(max_length=128, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.CharField(max_length=128, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Klinika to‘lovi"
        verbose_name_plural = "Klinika to‘lovlari"
        ordering = ["-period_start", "-created_at"]

    def __str__(self) -> str:
        return f"{self.clinic.name} — {self.period_label} ({self.amount_uzs} UZS)"


def book_upload_to(instance: "SubjectBook", filename: str) -> str:
    import re

    safe = re.sub(r"[^\w.\-]", "_", filename)[:200]
    return f"books/{instance.department_id}/{safe}"


class SubjectBook(models.Model):
    """Kafedraga bog'langan darslik (RAG manba materiali)."""

    department = models.ForeignKey(
        AcademicDepartment,
        on_delete=models.CASCADE,
        related_name="books",
    )
    title = models.CharField(max_length=512)
    source_archive = models.CharField(max_length=255, blank=True, default="")
    file = models.FileField(upload_to=book_upload_to, max_length=512, blank=True)
    language = models.CharField(max_length=8, blank=True, default="")
    page_count = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Fan darsligi"
        verbose_name_plural = "Fan darsliklari"
        ordering = ["department__sort_order", "title"]

    def __str__(self) -> str:
        return self.title


class BookChunk(models.Model):
    """SubjectBook matnidan olingan chunk + embedding (pgvector, RAG retrieval uchun)."""

    book = models.ForeignKey(SubjectBook, on_delete=models.CASCADE, related_name="chunks")
    department = models.ForeignKey(
        AcademicDepartment,
        on_delete=models.CASCADE,
        related_name="book_chunks",
        db_index=True,
    )
    chunk_index = models.PositiveIntegerField()
    page_start = models.PositiveIntegerField()
    page_end = models.PositiveIntegerField()
    text = models.TextField()
    embedding = VectorField(dimensions=1536)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Kitob chunk'i"
        verbose_name_plural = "Kitob chunk'lari"
        ordering = ["book_id", "chunk_index"]
        indexes = [
            models.Index(fields=["department"]),
            models.Index(fields=["book", "chunk_index"]),
        ]

    def __str__(self) -> str:
        return f"{self.book.title}#{self.chunk_index} ({self.page_start}-{self.page_end})"
