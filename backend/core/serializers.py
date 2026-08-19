from collections import defaultdict

from django.utils import timezone
from rest_framework import serializers

from .models import (
    CampusBuilding,
    CourseSyllabus,
    PreparedContent,
    StaffCourseSelection,
    StaffLocationAlert,
    StaffLocationPing,
    StaffScheduleSlot,
    StartupProjectApplication,
    SubjectBook,
    SyllabusDocument,
    TopicHandout,
    TopicPresentation,
)
from .permissions import resolve_user_role
from .week_schedule import current_week_phase_code


class LocalLoginSerializer(serializers.Serializer):
    phone_digits = serializers.CharField(max_length=20)
    password = serializers.CharField(min_length=6, max_length=128)
    role = serializers.ChoiceField(choices=["admin", "hodim"], required=False)
    first_name = serializers.CharField(max_length=128, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=128, required=False, allow_blank=True)
    display_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    register = serializers.BooleanField(required=False, default=False)

    def validate_phone_digits(self, value: str) -> str:
        digits = "".join(ch for ch in value if ch.isdigit())
        if len(digits) != 12 or not digits.startswith("998"):
            raise serializers.ValidationError("phone_digits must be Uzbekistan 12-digit number.")
        return digits


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(min_length=6, max_length=128)
    new_password = serializers.CharField(min_length=6, max_length=128)


class AdminDeprovisionStaffSerializer(serializers.Serializer):
    phone_digits = serializers.CharField(max_length=20)

    def validate_phone_digits(self, value: str) -> str:
        digits = "".join(ch for ch in value if ch.isdigit())
        if len(digits) != 12 or not digits.startswith("998"):
            raise serializers.ValidationError("phone_digits must be Uzbekistan 12-digit number.")
        return digits


class AdminStaffUpsertSerializer(serializers.Serializer):
    """Admin panel: xodim yaratish/tahrirlash — parol faqat yangi xodim uchun majburiy."""

    phone_digits = serializers.CharField(max_length=20)
    password = serializers.CharField(min_length=6, max_length=128, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=["admin", "klinika_admin", "hodim"], required=False)
    first_name = serializers.CharField(max_length=128, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=128, required=False, allow_blank=True)
    faculty = serializers.CharField(max_length=255, required=False, allow_blank=True)
    department = serializers.CharField(max_length=255, required=False, allow_blank=True)
    direction = serializers.CharField(max_length=255, required=False, allow_blank=True)
    participant_kind = serializers.ChoiceField(
        choices=["student", "employee"], required=False, allow_blank=True
    )
    study_group = serializers.CharField(max_length=128, required=False, allow_blank=True)
    job_title = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate_phone_digits(self, value: str) -> str:
        digits = "".join(ch for ch in value if ch.isdigit())
        if len(digits) != 12 or not digits.startswith("998"):
            raise serializers.ValidationError("phone_digits must be Uzbekistan 12-digit number.")
        return digits


class AdminStaffListEntrySerializer(serializers.Serializer):
    phone_digits = serializers.CharField()
    phone_display = serializers.CharField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    display_name = serializers.CharField()
    role = serializers.CharField()
    faculty = serializers.CharField()
    department = serializers.CharField()
    direction = serializers.CharField()
    participant_kind = serializers.CharField()
    study_group = serializers.CharField()
    job_title = serializers.CharField()
    is_active = serializers.BooleanField()
    date_joined = serializers.DateTimeField()
    last_login = serializers.DateTimeField(allow_null=True)


class PreparedContentSerializer(serializers.ModelSerializer):
    def validate_owner_key(self, value: str) -> str:
        v = value.strip()
        if len(v) < 3:
            raise serializers.ValidationError('owner_key is too short.')
        return v

    def validate_topic(self, value: str) -> str:
        v = value.strip()
        if len(v) < 2:
            raise serializers.ValidationError('topic is too short.')
        return v

    def validate(self, attrs):
        topic = (attrs.get('topic') or '').strip()
        topic_norm = (attrs.get('topic_norm') or '').strip().lower()
        if not topic_norm:
            topic_norm = topic.lower()
        attrs['topic'] = topic
        attrs['topic_norm'] = topic_norm
        return attrs

    class Meta:
        model = PreparedContent
        fields = [
            'id',
            'owner_key',
            'kind',
            'topic',
            'topic_norm',
            'author_display_name',
            'subject_name',
            'subject_code',
            'variant_label',
            'topic_code',
            'payload',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class TopicHandoutSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = TopicHandout
        fields = [
            "id",
            "owner_key",
            "author_name",
            "topic",
            "topic_norm",
            "title",
            "kind",
            "file_name",
            "file_size",
            "file_url",
            "can_delete",
            "sort_order",
            "created_at",
            "language",
        ]
        read_only_fields = fields

    def get_file_url(self, obj: TopicHandout) -> str:
        request = self.context.get("request")
        if not obj.file:
            return ""
        if request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url

    def get_can_delete(self, obj: TopicHandout) -> bool:
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        if obj.owner_key == request.user.username:
            return True
        return resolve_user_role(request.user, request) == "admin"


class SubjectBookSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    department_code = serializers.CharField(source="department.code", read_only=True)
    file_url = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    chunk_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = SubjectBook
        fields = [
            "id",
            "department",
            "department_name",
            "department_code",
            "title",
            "source_archive",
            "language",
            "page_count",
            "chunk_count",
            "file_url",
            "file_size",
            "is_active",
            "created_at",
        ]
        read_only_fields = fields

    def get_file_url(self, obj: SubjectBook) -> str:
        request = self.context.get("request")
        if not obj.file:
            return ""
        try:
            url = obj.file.url
        except ValueError:
            return ""
        if request:
            return request.build_absolute_uri(url)
        return url

    def get_file_size(self, obj: SubjectBook) -> int:
        try:
            return int(obj.file.size) if obj.file else 0
        except (ValueError, OSError):
            return 0


class TopicPresentationSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = TopicPresentation
        fields = [
            "id",
            "owner_key",
            "author_name",
            "topic",
            "topic_norm",
            "title",
            "kind",
            "file_name",
            "file_size",
            "file_url",
            "can_delete",
            "sort_order",
            "created_at",
        ]
        read_only_fields = fields

    def get_file_url(self, obj: TopicPresentation) -> str:
        request = self.context.get("request")
        if not obj.file:
            return ""
        if request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url

    def get_can_delete(self, obj: TopicPresentation) -> bool:
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        if obj.owner_key == request.user.username:
            return True
        return resolve_user_role(request.user, request) == "admin"


class SyllabusVariantSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=128)
    file_name = serializers.CharField(max_length=512)
    topics = serializers.ListField(child=serializers.DictField(), allow_empty=False)


class CourseSyllabusSerializer(serializers.ModelSerializer):
    variants = serializers.SerializerMethodField()
    department_name = serializers.CharField(source="department.name", read_only=True, default="")
    department_code = serializers.CharField(source="department.code", read_only=True, default="")

    class Meta:
        model = CourseSyllabus
        fields = [
            "id",
            "subject_name",
            "subject_code",
            "department",
            "department_name",
            "department_code",
            "description",
            "instruction_language",
            "file_name",
            "topics",
            "variants",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "department_name", "department_code"]

    def get_variants(self, obj) -> list:
        if obj.variants:
            return obj.variants
        if obj.topics:
            return [
                {
                    "label": "Asosiy",
                    "file_name": obj.file_name or "syllabus.pdf",
                    "topics": obj.topics,
                }
            ]
        return []


class CourseSyllabusUpsertSerializer(serializers.Serializer):
    subject_name = serializers.CharField(max_length=255, required=False)
    subject_code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    description = serializers.CharField(max_length=512, required=False, allow_blank=True)
    file_name = serializers.CharField(max_length=512, required=False, allow_blank=True)
    topics = serializers.ListField(child=serializers.DictField(), required=False, allow_empty=True)
    variants = SyllabusVariantSerializer(many=True, required=False)
    sort_order = serializers.IntegerField(required=False, default=0, min_value=0, max_value=9999)
    is_active = serializers.BooleanField(required=False, default=True)
    append_variants = serializers.BooleanField(required=False, default=False)
    instruction_language = serializers.ChoiceField(
        choices=["uz", "en", "ru"],
        required=False,
    )

    def validate_subject_name(self, value: str) -> str:
        v = value.strip()
        if len(v) < 2:
            raise serializers.ValidationError("Fan nomi juda qisqa.")
        return v

    def validate(self, attrs):
        variants = attrs.get("variants") or []
        file_name = (attrs.get("file_name") or "").strip()
        topics = attrs.get("topics") or []
        is_partial = self.partial

        if not is_partial and not variants and not (file_name and topics):
            subject_name = (attrs.get("subject_name") or "").strip()
            if not subject_name:
                raise serializers.ValidationError(
                    "Fan nomi yoki kamida bitta PDF (variants) kerak."
                )
        if variants:
            cleaned = []
            for v in variants:
                label = (v.get("label") or "").strip() or "Asosiy"
                fn = (v.get("file_name") or "").strip()
                tps = v.get("topics") or []
                if not fn or not tps:
                    raise serializers.ValidationError("Har bir variant uchun fayl nomi va mavzular kerak.")
                cleaned.append({"label": label[:128], "file_name": fn, "topics": tps})
            attrs["variants"] = cleaned
        return attrs


class StaffCourseSelectionSerializer(serializers.ModelSerializer):
    syllabus = CourseSyllabusSerializer(read_only=True)

    class Meta:
        model = StaffCourseSelection
        fields = ["id", "syllabus", "variant_label", "selected_at"]


class AdminStaffCourseSelectionSerializer(serializers.ModelSerializer):
    syllabus = CourseSyllabusSerializer(read_only=True)
    owner_name = serializers.SerializerMethodField()
    owner_phone_display = serializers.SerializerMethodField()

    class Meta:
        model = StaffCourseSelection
        fields = [
            "id",
            "owner_key",
            "owner_name",
            "owner_phone_display",
            "syllabus",
            "variant_label",
            "selected_at",
        ]

    def get_owner_name(self, obj: StaffCourseSelection) -> str:
        user = self._user(obj)
        if user is None:
            return ""
        name = f"{user.first_name} {user.last_name}".strip()
        return name or obj.owner_key

    def get_owner_phone_display(self, obj: StaffCourseSelection) -> str:
        d = obj.owner_key
        return f"+{d}" if len(d) == 12 else d

    def _user(self, obj: StaffCourseSelection):
        cache = self.context.setdefault("_user_cache", {})
        if obj.owner_key not in cache:
            from django.contrib.auth.models import User

            cache[obj.owner_key] = User.objects.filter(username=obj.owner_key).first()
        return cache[obj.owner_key]


class SyllabusDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyllabusDocument
        fields = ['id', 'external_id', 'file_name', 'topics', 'created_at']
        read_only_fields = ['id', 'created_at']


class SyllabusUpsertSerializer(serializers.Serializer):
    external_id = serializers.CharField(max_length=128)
    file_name = serializers.CharField(max_length=512)
    topics = serializers.ListField(child=serializers.DictField(), allow_empty=True)

    def validate_external_id(self, value: str) -> str:
        v = value.strip()
        if len(v) < 4:
            raise serializers.ValidationError('external_id is too short.')
        return v

    def validate_file_name(self, value: str) -> str:
        v = value.strip()
        if len(v) < 2:
            raise serializers.ValidationError('file_name is too short.')
        return v


class LiveTestUpsertSerializer(serializers.Serializer):
    session_key = serializers.CharField(max_length=160, required=False, allow_blank=True)
    topic = serializers.CharField(max_length=1024)
    questions = serializers.ListField(child=serializers.DictField(), allow_empty=False, max_length=200)
    created_at_ms = serializers.IntegerField(required=False, min_value=0)
    subject_code = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')


class LiveTestSubmissionCreateSerializer(serializers.Serializer):
    participant_key = serializers.CharField(max_length=64, required=False, allow_blank=True, default='')
    first_name = serializers.CharField(max_length=128)
    last_name = serializers.CharField(max_length=128)
    answers = serializers.ListField(child=serializers.IntegerField(), allow_empty=False, max_length=200)


class LiveTestDraftUpsertSerializer(serializers.Serializer):
    participant_key = serializers.CharField(max_length=64)
    first_name = serializers.CharField(max_length=128, required=False, allow_blank=True, default='')
    last_name = serializers.CharField(max_length=128, required=False, allow_blank=True, default='')
    answers = serializers.ListField(child=serializers.IntegerField(), required=False, default=list, max_length=200)


class StartupProjectApplicationSerializer(serializers.ModelSerializer):
    project_domain = serializers.ChoiceField(choices=['startup', 'research'], default='startup')
    workspace_profile = serializers.JSONField(required=False, default=dict)

    class Meta:
        model = StartupProjectApplication
        fields = [
            'id',
            'owner_key',
            'title',
            'summary',
            'description',
            'participant_kind',
            'project_domain',
            'workspace_profile',
            'profile_snapshot',
            'ai_pack',
            'submission_dossier',
            'status',
            'submitted_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'owner_key', 'status', 'submitted_at', 'created_at', 'updated_at']

    def create(self, validated_data):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError('Authentication required.')
        validated_data['owner_key'] = request.user.username
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if instance.status == StartupProjectApplication.STATUS_SUBMITTED and validated_data:
            raise serializers.ValidationError('Yuborilgan arizani tahrirlash mumkin emas.')
        return super().update(instance, validated_data)


class CampusBuildingSerializer(serializers.ModelSerializer):
    class Meta:
        model = CampusBuilding
        fields = [
            'id',
            'name',
            'short_code',
            'latitude',
            'longitude',
            'radius_m',
            'boundary',
            'sort_order',
            'notes',
            'is_active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_boundary(self, value):
        from .geo import normalize_boundary

        ring = normalize_boundary(value)
        if value and len(ring) < 3:
            raise serializers.ValidationError('Chegara uchun kamida 3 nuqta kerak.')
        return [[lat, lng] for lat, lng in ring]


class StaffScheduleSlotSerializer(serializers.ModelSerializer):
    applies_this_calendar_week = serializers.SerializerMethodField()
    week_phase_label = serializers.SerializerMethodField()
    building = CampusBuildingSerializer(read_only=True)
    building_id = serializers.IntegerField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = StaffScheduleSlot
        fields = [
            'id',
            'owner_key',
            'week_phase',
            'week_phase_label',
            'weekday',
            'start_time',
            'end_time',
            'building',
            'building_id',
            'building_name',
            'latitude',
            'longitude',
            'radius_m',
            'title',
            'is_active',
            'applies_this_calendar_week',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'week_phase_label',
            'applies_this_calendar_week',
            'created_at',
            'updated_at',
            'building',
        ]

    def get_week_phase_label(self, obj: StaffScheduleSlot) -> str:
        return dict(StaffScheduleSlot.WEEK_PHASE_CHOICES).get(obj.week_phase, obj.week_phase)

    def get_applies_this_calendar_week(self, obj: StaffScheduleSlot) -> bool:
        if obj.week_phase == StaffScheduleSlot.WEEK_EVERY:
            return True
        return obj.week_phase == current_week_phase_code(timezone.localtime())

    def _apply_building(self, attrs: dict, building_id) -> None:
        if building_id is None:
            attrs['building'] = None
            return
        try:
            b = CampusBuilding.objects.get(pk=building_id, is_active=True)
        except CampusBuilding.DoesNotExist as exc:
            raise serializers.ValidationError({'building_id': "Bino topilmadi yoki o'chirilgan."}) from exc
        attrs['building'] = b
        attrs['building_name'] = b.name
        attrs['latitude'] = b.latitude
        attrs['longitude'] = b.longitude
        attrs['radius_m'] = b.radius_m

    def create(self, validated_data):
        if 'building_id' in validated_data:
            bid = validated_data.pop('building_id')
            if bid is not None:
                self._apply_building(validated_data, bid)
            else:
                validated_data['building'] = None
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if 'building_id' in validated_data:
            bid = validated_data.pop('building_id')
            if bid is not None:
                self._apply_building(validated_data, bid)
            else:
                validated_data['building'] = None
        return super().update(instance, validated_data)


class StaffScheduleBulkRowSerializer(serializers.Serializer):
    MAX_INTERVALS_PER_WEEKDAY = 12

    weekday = serializers.IntegerField(min_value=0, max_value=6)
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()
    building_id = serializers.IntegerField(required=False, allow_null=True)
    building_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    radius_m = serializers.IntegerField(min_value=30, max_value=50_000, default=100)
    title = serializers.CharField(max_length=255, allow_blank=True, default='')

    def validate(self, attrs):
        if attrs['start_time'] >= attrs['end_time']:
            raise serializers.ValidationError({'end_time': 'Tugash vaqti boshlanishdan keyin bo‘lishi kerak.'})
        bid = attrs.get('building_id')
        if bid is not None:
            if not CampusBuilding.objects.filter(pk=bid, is_active=True).exists():
                raise serializers.ValidationError({'building_id': "Bino topilmadi yoki o'chirilgan."})
            return attrs
        name = (attrs.get('building_name') or '').strip()
        if attrs.get('latitude') is None or attrs.get('longitude') is None or not name:
            raise serializers.ValidationError(
                "Bino ro'yxatidan tanlang (building_id) yoki qo'lda: nom, lat, lng kiriting."
            )
        return attrs


class StaffScheduleBulkSerializer(serializers.Serializer):
    """Bir o‘qituvchi uchun bitta hafta bosqichini to‘liq almashtirish."""

    owner_key = serializers.CharField(max_length=128)
    week_phase = serializers.ChoiceField(
        choices=[
            StaffScheduleSlot.WEEK_EVERY,
            StaffScheduleSlot.WEEK_UPPER,
            StaffScheduleSlot.WEEK_LOWER,
        ]
    )
    replace_existing = serializers.BooleanField(default=True)
    slots = StaffScheduleBulkRowSerializer(many=True)

    def validate_owner_key(self, value: str) -> str:
        digits = ''.join(ch for ch in value if ch.isdigit())
        if len(digits) != 12 or not digits.startswith('998'):
            raise serializers.ValidationError("Telefon 998 bilan 12 raqam bo‘lishi kerak.")
        return digits

    def validate_slots(self, rows):
        by_day: defaultdict[int, list] = defaultdict(list)
        for row in rows:
            by_day[row['weekday']].append((row['start_time'], row['end_time']))
        max_iv = StaffScheduleBulkRowSerializer.MAX_INTERVALS_PER_WEEKDAY
        names = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']
        for wd, intervals in by_day.items():
            if len(intervals) > max_iv:
                raise serializers.ValidationError(
                    f"{names[wd]} kunida bir vaqtda maksimal {max_iv} ta vaqt oralig'i."
                )
            intervals.sort(key=lambda x: x[0])
            for i in range(len(intervals) - 1):
                if intervals[i][1] > intervals[i + 1][0]:
                    raise serializers.ValidationError(
                        f"{names[wd]} kunida dars vaqtlari ustma-ust tushmasligi kerak."
                    )
        return rows


class StaffLocationPingSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffLocationPing
        fields = [
            'id',
            'owner_key',
            'latitude',
            'longitude',
            'accuracy_m',
            'recorded_at',
            'client_ts_ms',
        ]
        read_only_fields = fields


class StaffLocationPingCreateSerializer(serializers.Serializer):
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    accuracy_m = serializers.FloatField(required=False, allow_null=True, min_value=0)
    client_ts_ms = serializers.IntegerField(required=False, allow_null=True)
    client_kind = serializers.CharField(required=False, allow_blank=True, max_length=16)

    def validate(self, attrs):
        lat = attrs["latitude"]
        lng = attrs["longitude"]
        if abs(lat) < 1e-6 and abs(lng) < 1e-6:
            raise serializers.ValidationError("Koordinata noto‘g‘ri (0,0).")
        return attrs


class StaffLocationAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffLocationAlert
        fields = [
            'id',
            'owner_key',
            'slot',
            'building_name',
            'expected_lat',
            'expected_lng',
            'actual_lat',
            'actual_lng',
            'distance_m',
            'radius_m',
            'slot_start',
            'slot_end',
            'message',
            'alert_date',
            'created_at',
        ]
        read_only_fields = fields
