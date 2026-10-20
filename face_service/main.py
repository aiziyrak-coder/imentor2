"""iMentor yuz xizmati — faqat ichki tarmoq uchun (nginx orqali ochilmaydi).

Bitta vazifa: rasmdagi eng katta yuzning ArcFace embedding'ini qaytarish.
Kim ekanini aniqlash (bazadagi yuzlar bilan solishtirish, hisobga bog'lash)
backend_fastapi'da. Model va sozlamalar cam.fermi.uz bilan AYNAN bir xil
(buffalo_l, det_size 640, detection+recognition) — aks holda u yerda
ro'yxatdan o'tgan yuz izlari bu yerdagilar bilan solishtirib bo'lmaydi.
"""

from __future__ import annotations

import logging
import os
import threading

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from insightface.app import FaceAnalysis

logger = logging.getLogger("imentor.face")

MAX_IMAGE_BYTES = 3 * 1024 * 1024
# Juda kichik yuz (uzoqdan, doskadan 3 metr) ishonchsiz embedding beradi.
MIN_FACE_PIXELS = 60

app = FastAPI(title="iMentor face", docs_url=None, redoc_url=None, openapi_url=None)

_model: FaceAnalysis | None = None
_model_lock = threading.Lock()
# ONNX sessiyasi bir vaqtda bir nechta so'rovni xavfsiz ko'taradi, lekin CPU
# chegarasida navbat tartibli bo'lsin — kirish oynasida kechikish sezilmaydi.
_infer_lock = threading.Semaphore(int(os.environ.get("FACE_MAX_PARALLEL", "4")))


def _get_model() -> FaceAnalysis:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                model = FaceAnalysis(
                    name="buffalo_l",
                    providers=["CPUExecutionProvider"],
                    allowed_modules=["detection", "recognition"],
                )
                # Yuzni QIDIRISH o'lchami. Tanish sifatiga TA'SIR QILMAYDI:
                # embedding topilgan yuzning 112x112 qirqimidan hisoblanadi,
                # det_size esa faqat yuz topiladimi-yo'qmi degan qismga ta'sir
                # qiladi. 640 -> 320 da bitta kadr 350 ms dan 147 ms ga tushadi
                # (2026-10-02 o'lchov), ya'ni navbat ikki barobardan ko'proq
                # qisqaradi. Evaziga uzoqdagi kichik yuz topilmay qolishi
                # mumkin — kirish uchun odam kameraga yaqin turadi, shuning
                # uchun bu qabul qilinarli. Kerak bo'lsa FACE_DET_SIZE bilan
                # qaytariladi.
                det = int(os.environ.get("FACE_DET_SIZE", "640"))
                model.prepare(ctx_id=0, det_size=(det, det))
                _model = model
    return _model


@app.on_event("startup")
def _warm_up() -> None:
    # Birinchi o'qituvchi 10 soniya kutmasin — model konteyner turganda yuklanadi.
    _get_model()


@app.get("/health")
def health() -> dict:
    return {"ok": _model is not None}


@app.post("/embed")
async def embed(image: UploadFile = File(...)) -> dict:
    data = await image.read()
    if not data:
        raise HTTPException(status_code=422, detail="Rasm bo'sh")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Rasm juda katta")
    arr = np.frombuffer(data, dtype=np.uint8)
    try:
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except cv2.error:
        img = None
    if img is None:
        raise HTTPException(status_code=422, detail="Rasm formatini o'qib bo'lmadi")

    with _infer_lock:
        faces = _get_model().get(img)
    if not faces:
        return {"faces": 0, "embedding": None}

    best = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    width = float(best.bbox[2] - best.bbox[0])
    height = float(best.bbox[3] - best.bbox[1])
    if min(width, height) < MIN_FACE_PIXELS:
        return {"faces": len(faces), "embedding": None, "too_small": True}
    return {
        "faces": len(faces),
        "embedding": [float(x) for x in best.normed_embedding],
        "det_score": float(best.det_score),
    }
