#!/usr/bin/env bash
#
# Jitsi Meet'ni SHU serverda ko'taradi — video darslar universitetdan
# chiqmasin va davomat avtomatik yig'ilsin.
#
# Ishlatish:
#     sudo bash /home/imentor/deploy/setup-jitsi.sh
#
# OLDINDAN KERAK (busiz video ishlamaydi):
#   1. DNS:    meet.fermi.uz  ->  87.192.230.208   (A yozuvi)
#   2. Router: UDP 10000  ->  192.168.0.101        (port yo'naltirish)
#      Jitsi video oqimi AYNAN shu port orqali yuradi. Ochilmasa
#      talabalar bir-birini ko'ra olmaydi.
#
# Boshqa loyihalarga ta'sir qilmaydi:
#   - alohida compose loyihasi (`jitsi`), alohida katalog, alohida tarmoq
#   - 80/443 EGALLANMAYDI: web 127.0.0.1:9230 da turadi, host nginx uzatadi
#   - iMentor'ning docker-compose fayliga tegilmaydi

set -euo pipefail

DOMAIN="meet.fermi.uz"
HTTP_PORT="9230"          # faqat localhost; host nginx shu yerga uzatadi
BASE="/home/jitsi"
JITSI_VERSION="stable-9909"

if [ "$(id -u)" -ne 0 ]; then
  echo "XATO: root kerak.  sudo bash $0"
  exit 1
fi

echo "==> 1/6  Oldindan shartlar"
resolved="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ -z "$resolved" ]; then
  echo "TO'XTADI: $DOMAIN uchun DNS yozuvi yo'q."
  echo "          Avval A yozuvini qo'shing:  $DOMAIN -> 87.192.230.208"
  exit 1
fi
echo "    DNS: $DOMAIN -> $resolved"

for p in 10000 4443; do
  if ss -ulnp 2>/dev/null | grep -q ":$p " || ss -tlnp 2>/dev/null | grep -q ":$p "; then
    echo "TO'XTADI: $p porti band. Jitsi uni talab qiladi."
    exit 1
  fi
done
if ss -tlnp 2>/dev/null | grep -q ":${HTTP_PORT} "; then
  echo "TO'XTADI: ${HTTP_PORT} porti band. Skriptdagi HTTP_PORT ni o'zgartiring."
  exit 1
fi
echo "    portlar bo'sh: 10000/udp, 4443/tcp, ${HTTP_PORT}/tcp"

echo "==> 2/6  Jitsi fayllari"
mkdir -p "$BASE"
cd "$BASE"
if [ ! -f "docker-compose.yml" ]; then
  curl -fsSL "https://github.com/jitsi/docker-jitsi-meet/releases/download/${JITSI_VERSION}/docker-jitsi-meet-${JITSI_VERSION}.tar.gz" \
    | tar xz --strip-components=1
  echo "    ${JITSI_VERSION} yuklandi"
else
  echo "    allaqachon bor — qayta yuklanmadi"
fi

echo "==> 3/6  Sozlama"
if [ ! -f ".env" ]; then
  cp env.example .env
  bash gen-passwords.sh
  mkdir -p "$BASE/config/"{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb}

  # Bizga kerakli o'zgarishlar. `sed -i` faqat SHU .env faylida.
  sed -i "s|^#\?PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|"        .env
  sed -i "s|^#\?HTTP_PORT=.*|HTTP_PORT=${HTTP_PORT}|"               .env
  sed -i "s|^#\?HTTPS_PORT=.*|HTTPS_PORT=8443|"                     .env
  sed -i "s|^#\?CONFIG=.*|CONFIG=${BASE}/config|"                   .env
  sed -i "s|^#\?JVB_ADVERTISE_IPS=.*|JVB_ADVERTISE_IPS=87.192.230.208|" .env
  sed -i "s|^#\?ENABLE_LETSENCRYPT=.*|ENABLE_LETSENCRYPT=0|"        .env
  sed -i "s|^#\?DISABLE_HTTPS=.*|DISABLE_HTTPS=1|"                  .env
  # Xona nomlarini iMentor yaratadi va ular taxmin qilib bo'lmaydigan —
  # qo'shimcha autentifikatsiya shart emas, lekin lobby yoqiladi.
  sed -i "s|^#\?ENABLE_LOBBY=.*|ENABLE_LOBBY=1|"                    .env
  {
    echo ""
    echo "# iMentor: web faqat localhost'da, tashqariga host nginx uzatadi."
    echo "HTTP_BIND=127.0.0.1"
  } >> .env
  echo "    .env yaratildi (parollar avtomatik)"
else
  echo "    .env allaqachon bor — tegilmadi"
fi

echo "==> 4/6  Konteynerlarni ko'tarish"
docker compose -p jitsi up -d
sleep 12
docker compose -p jitsi ps --format "    {{.Service}}\t{{.Status}}" || true

echo "==> 5/6  nginx sayti"
AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
if [ ! -e "$AVAILABLE" ]; then
  cat > "$AVAILABLE" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${HTTP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Jitsi signalizatsiyasi WebSocket orqali yuradi.
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 900s;
    }
}
NGINX
  echo "    yaratildi: $AVAILABLE"
fi
[ -e "$ENABLED" ] || ln -s "$AVAILABLE" "$ENABLED"

if ! nginx -t; then
  echo "XATO: nginx sozlamasi noto'g'ri — qayta o'qilmadi, saytlar joyida."
  exit 1
fi
systemctl reload nginx
echo "    nginx qayta o'qildi (uzilishsiz)"

echo "==> 6/6  SSL"
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  echo "    sertifikat bor"
elif command -v certbot >/dev/null 2>&1; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect || \
    echo "OGOHLANTIRISH: sertifikat olinmadi, qo'lda: certbot --nginx -d $DOMAIN"
else
  echo "OGOHLANTIRISH: certbot yo'q."
fi

echo
echo "TAYYOR.  https://${DOMAIN}"
echo
echo "OXIRGI QADAM — iMentor'ni shu Jitsi'ga ulash:"
echo "  /home/imentor/.env fayliga qo'shing:"
echo "      ONLINE_JITSI_DOMAIN=${DOMAIN}"
echo "  so'ng:"
echo "      cd /home/imentor && docker compose -f docker-compose.prod.yml up -d --no-deps backend_fastapi"
echo
echo "Tekshirish:  https://${DOMAIN} ochilib, video ishlashi kerak."
echo "Video ishlamasa — routerda UDP 10000 yo'naltirilganini tekshiring."
