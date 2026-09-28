#!/usr/bin/env bash
# iMentor: o'zgargan fayllarni serverga xavfsiz chiqarish (2026-09-24).
#
# Serverdagi kod git'da emas va unga boshqa sessiyalar ham yozadi. Shuning uchun
# har fayl yuborishdan OLDIN tekshiriladi: serverdagi nusxa bazaviy commitdagisi
# bilan bir xil bo'lishi kerak. Farq bo'lsa — hech narsa yuborilmaydi (birovning
# ishini ustidan yozib yubormaslik uchun); avval server nusxasini olib, birlashtiring.
#
# Ishlatish:
#   deploy/push-to-server.sh <bazaviy-commit> [--dry-run]
#     bazaviy-commit — serverda hozir turgan holat (odatda HEAD~1). Yuboriladigan
#     fayllar: shu commit bilan HEAD orasidagi farq.
#
# Qadamlar: tekshiruv → backup (tar + docker tag) → yuklash → build → migratsiya
# (kerak bo'lsa) → konteynerlarni qayta ishga tushirish → admin parol skriptini tiklash.
set -euo pipefail

BASE="${1:?bazaviy commit kerak, masalan: HEAD~1}"
DRY="${2:-}"
HOST="${IMENTOR_HOST:-admin_root@192.168.0.101}"
KEY="${IMENTOR_KEY:-$HOME/.ssh/imentor_deploy}"
ROOT="/home/imentor"
COMPOSE="docker compose -f docker-compose.prod.yml"
R() { ssh -i "$KEY" "$HOST" "$@"; }

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain -- backend_fastapi frontend deploy)" ]; then
  echo "Commit qilinmagan o'zgarishlar bor — avval commit qiling." >&2
  exit 1
fi

# Faqat server ishlatadigan fayllar (harness, testlar serverga kerak emas).
mapfile -t FILES < <(git diff --name-only --diff-filter=AMR "$BASE" HEAD -- backend_fastapi frontend deploy \
  | grep -v -e '^frontend/src/harness/' -e '^frontend/harness.html$' || true)
mapfile -t DELETED < <(git diff --name-only --diff-filter=D "$BASE" HEAD -- backend_fastapi frontend deploy || true)
if [ ${#FILES[@]} -eq 0 ] && [ ${#DELETED[@]} -eq 0 ]; then
  echo "Yuboriladigan o'zgarish yo'q."
  exit 0
fi

echo "== 1. Parity tekshiruvi (server = $BASE?)"
bad=0
for f in "${FILES[@]}" "${DELETED[@]}"; do
  # Testlar ishlayotgan xizmatga ta'sir qilmaydi (konteynerda ishga tushirilmaydi),
  # shuning uchun ular parity'ni to'xtatmaydi — faqat ogohlantiriladi.
  # Frontend testlari (`*.test.ts(x)`) ham shunday: ular hatto serverda bo'lmasligi mumkin.
  if [[ "$f" == */tests/* || "$f" == *.test.ts || "$f" == *.test.tsx ]]; then
    want=$(git show "$BASE:$f" 2>/dev/null | tr -d '\r' | md5sum | cut -c1-32 || true)
    have=$(R "if [ -f '$ROOT/$f' ]; then tr -d '\r' < '$ROOT/$f' | md5sum | cut -c1-32; else echo missing; fi")
    [ "$want" = "$have" ] || echo "  (test fayli serverda boshqacha, ustidan yoziladi: $f)"
    continue
  fi
  want=$(git show "$BASE:$f" 2>/dev/null | tr -d '\r' | md5sum | cut -c1-32 || true)
  git cat-file -e "$BASE:$f" 2>/dev/null || want="missing"
  have=$(R "if [ -f '$ROOT/$f' ]; then tr -d '\r' < '$ROOT/$f' | md5sum | cut -c1-32; else echo missing; fi")
  if [ "$want" != "$have" ]; then
    echo "  FARQ: $f"
    bad=1
  fi
done
if [ $bad -ne 0 ]; then
  echo "Serverdagi fayllar $BASE bilan mos emas — hech narsa yuborilmadi." >&2
  echo "Server nusxasini olib, o'zgarishlarni birlashtiring, keyin qayta urining." >&2
  exit 2
fi
echo "  hammasi mos (${#FILES[@]} ta yuboriladi, ${#DELETED[@]} ta o'chiriladi)"

need_backend=0; need_frontend=0; need_migrate=0
for f in "${FILES[@]}" "${DELETED[@]}"; do
  case "$f" in
    backend_fastapi/alembic/*) need_migrate=1; need_backend=1 ;;
    backend_fastapi/tests/*) ;;
    backend_fastapi/*) need_backend=1 ;;
    frontend/*) need_frontend=1 ;;
  esac
done
echo "  backend=$need_backend frontend=$need_frontend migratsiya=$need_migrate"
if [ "$DRY" = "--dry-run" ]; then
  printf '  %s\n' "${FILES[@]}"
  exit 0
fi

T=$(date +%Y%m%d-%H%M%S)
echo "== 2. Backup ($T)"
existing=()
for f in "${FILES[@]}" "${DELETED[@]}"; do git cat-file -e "$BASE:$f" 2>/dev/null && existing+=("$f"); done
if [ ${#existing[@]} -gt 0 ]; then
  # Faqat serverda HAQIQATAN bor fayllar: git'da bo'lib serverda yo'q fayl
  # (masalan hech qachon yuborilmagan test) tar'ni yiqitib, deployni to'xtatardi.
  R "cd $ROOT && for f in ${existing[*]}; do [ -e \"\$f\" ] && echo \"\$f\"; done | tar czf backups/push-before-$T.tgz -T -"
fi
R "docker tag imentor-backend_fastapi:latest imentor-backend_fastapi:before-$T 2>/dev/null; docker tag imentor-frontend:latest imentor-frontend:before-$T 2>/dev/null; true"
echo "  $ROOT/backups/push-before-$T.tgz"

echo "== 3. Yuklash"
for f in "${FILES[@]}"; do
  R "mkdir -p '$ROOT/$(dirname "$f")'"
  git show "HEAD:$f" | tr -d '\r' | R "cat > '$ROOT/$f'"
done
for f in "${DELETED[@]}"; do R "rm -f '$ROOT/$f'"; done

if [ $need_backend -eq 1 ]; then
  echo "== 4. Backend build"
  R "cd $ROOT && $COMPOSE build backend_fastapi > /tmp/push-backend.log 2>&1" || { echo "build yiqildi: /tmp/push-backend.log"; exit 3; }
  if [ $need_migrate -eq 1 ]; then
    # migrate_fastapi O'Z image'ini ishlatadi — uni ham qurmasa, yangi migratsiya ko'rinmaydi.
    echo "== 4b. Migratsiya"
    R "cd $ROOT && $COMPOSE build migrate_fastapi > /tmp/push-migrate.log 2>&1 && $COMPOSE run --rm --no-deps migrate_fastapi 2>&1 | grep -i 'running upgrade\|error' || true"
  fi
  R "cd $ROOT && $COMPOSE up -d --no-deps --no-build backend_fastapi"
fi
if [ $need_frontend -eq 1 ]; then
  echo "== 5. Frontend build (imentor + online portal)"
  R "cd $ROOT && $COMPOSE build frontend frontend_online > /tmp/push-frontend.log 2>&1" || { echo "build yiqildi: /tmp/push-frontend.log"; exit 3; }
  R "cd $ROOT && $COMPOSE up -d --no-deps --no-build frontend frontend_online"
fi

echo "== 6. Tekshiruv"
sleep 12
R "docker cp $ROOT/backups/reset_admin_password.py imentor-backend_fastapi-1:/tmp/reset_admin_password.py 2>/dev/null; docker ps --format '{{.Names}}: {{.Status}}' | grep -e backend_fastapi -e frontend"
echo "Tayyor. Orqaga qaytarish: $ROOT/backups/push-before-$T.tgz va imentor-*:before-$T image'lari."
