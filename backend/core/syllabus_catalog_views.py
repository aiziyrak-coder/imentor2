"""Markaziy fan syllabus katalogi (admin) va o'qituvchi tanlovi."""

from __future__ import annotations

import re

from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import AcademicDepartment, CourseSyllabus, StaffCourseSelection, StaffProfile
from .pagination import paginated_response
from .permissions import HasEducationRole, IsAdminRole, IsHodimRole
from .phone import normalize_uz_phone_digits
from .serializers import (
    AdminStaffCourseSelectionSerializer,
    CourseSyllabusSerializer,
    CourseSyllabusUpsertSerializer,
    StaffCourseSelectionSerializer,
)


def _slugify_subject(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-")
    return (s or "fan")[:64]


def _sync_legacy_fields(obj: CourseSyllabus) -> None:
    """Eski file_name/topics maydonlarini birinchi variantdan yangilash."""
    variants = obj.variants or []
    if variants:
        first = variants[0]
        obj.file_name = (first.get("file_name") or obj.file_name or "")[:512]
        obj.topics = first.get("topics") or []
    elif not obj.topics:
        obj.topics = []


class AdminCourseSyllabusListCreateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    @extend_schema(responses=CourseSyllabusSerializer(many=True))
    def get(self, request):
        qs = CourseSyllabus.objects.all().order_by("sort_order", "subject_name")
        return paginated_response(
            qs,
            request,
            default_page_size=50,
            max_page_size=200,
            mapper=lambda obj: CourseSyllabusSerializer(obj).data,
        )

    @extend_schema(request=CourseSyllabusUpsertSerializer, responses=CourseSyllabusSerializer)
    def post(self, request):
        ser = CourseSyllabusUpsertSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if not (data.get("subject_name") or "").strip():
            return Response({"detail": "Fan nomi kerak."}, status=400)
        code = (data.get("subject_code") or "").strip() or _slugify_subject(data["subject_name"])
        base_code = code
        n = 1
        while CourseSyllabus.objects.filter(subject_code=code).exists():
            code = f"{base_code}-{n}"[:64]
            n += 1
        variants = data.get("variants") or []
        fan_name = data["subject_name"].strip()
        file_name = (data.get("file_name") or "").strip() or f"{fan_name}.pdf"
        topics = data.get("topics") or []
        if variants and not (data.get("file_name") or "").strip():
            file_name = variants[0]["file_name"]
        if variants and not topics:
            topics = variants[0]["topics"]
        instr_lang = (data.get("instruction_language") or "uz").strip().lower()
        if instr_lang not in ("uz", "en", "ru"):
            instr_lang = "uz"
        obj = CourseSyllabus.objects.create(
            subject_name=data["subject_name"].strip(),
            subject_code=code,
            description=(data.get("description") or "").strip()[:512],
            instruction_language=instr_lang,
            file_name=file_name,
            topics=topics,
            variants=variants,
            sort_order=int(data.get("sort_order") or 0),
            is_active=bool(data.get("is_active", True)),
        )
        _sync_legacy_fields(obj)
        obj.save(update_fields=["file_name", "topics"])
        return Response(CourseSyllabusSerializer(obj).data, status=status.HTTP_201_CREATED)


def build_syllabus_catalog_stats() -> dict:
    """Kafedra → fan → yo'nalish → mavzu ierarxiyasi (faqat haqiqiy kafedralar)."""
    syl_ids = set(
        CourseSyllabus.objects.filter(is_active=True, department_id__isnull=False)
        .values_list("department_id", flat=True)
        .distinct()
    )
    staff_ids = set(
        StaffProfile.objects.filter(academic_department_id__isnull=False)
        .values_list("academic_department_id", flat=True)
        .distinct()
    )
    real_ids = syl_ids | staff_ids

    by_department = list(
        AcademicDepartment.objects.filter(is_active=True, id__in=real_ids)
        .annotate(subjects_count=Count("subjects", filter=Q(subjects__is_active=True)))
        .order_by("sort_order", "name")
        .values("id", "name", "code", "subjects_count", "sort_order")
    )

    academic_n = None
    try:
        from .online_test_client import fetch_academic_catalog

        catalog = fetch_academic_catalog()
        academic_n = sum(
            1 for row in (catalog.get("kafedralar") or []) if str(row.get("name") or "").strip()
        ) or None
    except Exception:
        academic_n = None

    active_qs = CourseSyllabus.objects.filter(is_active=True)
    subjects_count = active_qs.count()
    field_names = {f.name for f in CourseSyllabus._meta.get_fields()}
    if "direction_code" in field_names:
        variants_count = (
            active_qs.exclude(direction_code="")
            .values("direction_code")
            .distinct()
            .count()
        )
    else:
        variants_count = 0
        for variants in active_qs.values_list("variants", flat=True).iterator():
            if isinstance(variants, list) and variants:
                variants_count += len(variants)
            else:
                variants_count += 1
    topics_count = 0
    for topics in active_qs.values_list("topics", flat=True).iterator():
        if isinstance(topics, list):
            topics_count += len(topics)

    return {
        "departments_count": academic_n or len(by_department),
        "subjects_count": subjects_count,
        "subjects_total": CourseSyllabus.objects.count(),
        "variants_count": variants_count,
        "topics_count": topics_count,
        "by_department": [
            {
                "id": row["id"],
                "name": row["name"],
                "code": row["code"],
                "subjects_count": row["subjects_count"],
                "sort_order": row["sort_order"],
            }
            for row in by_department
        ],
    }


class AdminSyllabusCatalogStatsView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(build_syllabus_catalog_stats())


class AdminCourseSyllabusDetailView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    def _get(self, pk: int) -> CourseSyllabus | None:
        return CourseSyllabus.objects.filter(pk=pk).first()

    @extend_schema(responses=CourseSyllabusSerializer)
    def patch(self, request, pk: int):
        obj = self._get(pk)
        if not obj:
            return Response({"detail": "Topilmadi."}, status=404)
        ser = CourseSyllabusUpsertSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if "subject_name" in data:
            obj.subject_name = data["subject_name"].strip()
        if "description" in data:
            obj.description = (data.get("description") or "").strip()[:512]
        if "variants" in data:
            incoming = data["variants"]
            if data.get("append_variants"):
                existing = list(obj.variants or [])
                existing_labels = {(v.get("label") or "").lower() for v in existing}
                for v in incoming:
                    key = (v.get("label") or "").lower()
                    if key in existing_labels:
                        existing = [x for x in existing if (x.get("label") or "").lower() != key]
                        existing_labels.discard(key)
                    existing.append(v)
                obj.variants = existing
            else:
                obj.variants = incoming
            _sync_legacy_fields(obj)
        if "file_name" in data:
            obj.file_name = data["file_name"].strip()
        if "topics" in data:
            obj.topics = data["topics"]
        if "sort_order" in data:
            obj.sort_order = int(data["sort_order"])
        if "is_active" in data:
            obj.is_active = bool(data["is_active"])
        if "instruction_language" in data:
            lang = (data.get("instruction_language") or "uz").strip().lower()
            if lang in ("uz", "en", "ru"):
                obj.instruction_language = lang
        if "subject_code" in data and data["subject_code"]:
            new_code = data["subject_code"].strip()[:64]
            if new_code != obj.subject_code and not CourseSyllabus.objects.filter(subject_code=new_code).exclude(pk=pk).exists():
                obj.subject_code = new_code
        obj.save()
        return Response(CourseSyllabusSerializer(obj).data)

    def delete(self, request, pk: int):
        obj = self._get(pk)
        if not obj:
            return Response({"detail": "Topilmadi."}, status=404)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseSyllabusCatalogView(APIView):
    """Barcha faol fanlar — o'qituvchi tanlash uchun."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    @extend_schema(responses=CourseSyllabusSerializer(many=True))
    def get(self, request):
        qs = CourseSyllabus.objects.filter(is_active=True).order_by("sort_order", "subject_name")
        rows = []
        for obj in qs:
            data = CourseSyllabusSerializer(obj).data
            variants = data.get("variants") or []
            topic_count = sum(len(v.get("topics") or []) for v in variants)
            if not topic_count and data.get("topics"):
                topic_count = len(data.get("topics") or [])
            if topic_count > 0:
                rows.append(data)
        return paginated_response(rows, request, default_page_size=50, max_page_size=200)


class StaffCourseSelectionListView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsHodimRole]

    @extend_schema(responses=StaffCourseSelectionSerializer(many=True))
    def get(self, request):
        qs = (
            StaffCourseSelection.objects.filter(
                owner_key=request.user.username,
                syllabus__is_active=True,
            )
            .select_related("syllabus")
            .order_by("-selected_at")
        )
        return Response(StaffCourseSelectionSerializer(qs, many=True).data)

    @extend_schema(
        request=serializers.Serializer,
        responses=StaffCourseSelectionSerializer,
    )
    def post(self, request):
        return Response(
            {
                "detail": "Fanni faqat administrator biriktiradi. Administrator bilan bog'laning.",
            },
            status=status.HTTP_403_FORBIDDEN,
        )


class StaffCourseSelectionDetailView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsHodimRole]

    def delete(self, request, syllabus_id: int):
        return Response(
            {
                "detail": "Fanni faqat administrator olib tashlaydi.",
            },
            status=status.HTTP_403_FORBIDDEN,
        )


class AdminStaffCourseSelectionListCreateView(APIView):
    """Admin: barcha o'qituvchi-fan biriktiruvlarini ko'rish va yangi biriktirish."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    @extend_schema(responses=AdminStaffCourseSelectionSerializer(many=True))
    def get(self, request):
        qs = StaffCourseSelection.objects.select_related("syllabus").order_by("-selected_at")
        syllabus_id = request.query_params.get("syllabus_id")
        if syllabus_id:
            qs = qs.filter(syllabus_id=syllabus_id)
        owner_key = request.query_params.get("owner_key")
        if owner_key:
            qs = qs.filter(owner_key=normalize_uz_phone_digits(owner_key))
        shared_context: dict = {}
        return paginated_response(
            qs,
            request,
            default_page_size=100,
            max_page_size=500,
            mapper=lambda obj: AdminStaffCourseSelectionSerializer(
                obj, context=shared_context
            ).data,
        )

    @extend_schema(request=serializers.Serializer, responses=AdminStaffCourseSelectionSerializer)
    def post(self, request):
        phone_raw = (request.data.get("phone_digits") or request.data.get("owner_key") or "").strip()
        syllabus_id = request.data.get("syllabus_id")
        if not phone_raw or not syllabus_id:
            return Response({"detail": "phone_digits va syllabus_id kerak."}, status=400)
        try:
            phone = normalize_uz_phone_digits(phone_raw)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        from django.contrib.auth.models import User

        if not User.objects.filter(username=phone).exists():
            return Response({"detail": "Bu telefon raqamli xodim topilmadi."}, status=404)

        syllabus = CourseSyllabus.objects.filter(pk=syllabus_id).first()
        if not syllabus:
            return Response({"detail": "Fan topilmadi."}, status=404)

        available = [
            (v.get("label") or "").strip()
            for v in (syllabus.variants or [])
            if (v.get("label") or "").strip()
        ]

        # `variant_labels` (ro'yxat) yoki eski `variant_label` (bitta) qabul qilinadi.
        raw_labels = request.data.get("variant_labels")
        if raw_labels is None:
            single = (request.data.get("variant_label") or "").strip()
            raw_labels = [single] if single else []
        if not isinstance(raw_labels, list):
            return Response({"detail": "variant_labels ro'yxat bo'lishi kerak."}, status=400)

        labels: list[str] = []
        for item in raw_labels:
            label = str(item).strip()
            if label and label not in labels:
                labels.append(label)

        if available:
            invalid = [lbl for lbl in labels if lbl not in available]
            if invalid:
                return Response({"detail": "Noto'g'ri syllabus/yo'nalish."}, status=400)
            if not labels:
                return Response(
                    {"detail": "Kamida bitta syllabus (yo'nalish) tanlang."},
                    status=400,
                )
        else:
            # Fanda yo'nalish (variant) yo'q — bitta bo'sh biriktirish
            labels = [""]

        cache: dict = {}
        rows = []
        for label in labels:
            sel, _ = StaffCourseSelection.objects.update_or_create(
                owner_key=phone,
                syllabus=syllabus,
                variant_label=label,
                defaults={},
            )
            rows.append(sel)

        return Response(
            [
                AdminStaffCourseSelectionSerializer(r, context={"_user_cache": cache}).data
                for r in rows
            ],
            status=status.HTTP_201_CREATED,
        )


class AdminStaffCourseSelectionDetailView(APIView):
    """Admin: biriktiruvni bekor qilish (o'qituvchini fandan chetlashtirish)."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    def delete(self, request, pk: int):
        deleted, _ = StaffCourseSelection.objects.filter(pk=pk).delete()
        if not deleted:
            return Response({"detail": "Topilmadi."}, status=404)
        return Response(status=status.HTTP_204_NO_CONTENT)
