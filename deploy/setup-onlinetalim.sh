#!/usr/bin/env bash
#
# onlinetalim.fermi.uz domenini yo'lga qo'yadi.
#
# Ishlatish (serverda):
#     sudo bash /home/imentor/deploy/setup-onlinetalim.sh
#
# Nima qiladi:
#   1. Domen uchun YANGI nginx fayli yaratadi (mavjud saytlarga tegmaydi)
#   2. Sozlamani tekshiradi (`nginx -t`) — xato bo'lsa TO'XTAYDI
#   3. nginx'ni `reload` qiladi ("restart" emas: boshqa 40 ta domen uzilmaydi)
#   4. Let's Encrypt sertifikatini oladi
#
# Xavfsiz: qayta ishga tushirish mumkin, mavjud fayllar o'zgartirilmaydi.

set -euo pipefail

DOMAIN="onlinetalim.fermi.uz"
UPSTREAM="127.0.0.1:9050"     # iMentor frontend konteyneri
AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

if [ "$(id -u)" -ne 0 ]; then
  echo "XATO: skript root huquqi bilan ishlashi kerak."
  echo "      sudo bash $0"
  exit 1
fi

echo "==> 1/4  Domen serverga ko'rsatyaptimi"
resolved="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ -z "$resolved" ]; then
  echo "OGOHLANTIRISH: $DOMAIN uchun DNS yozuvi topilmadi."
  echo "               Sertifikat olish bosqichi yiqilishi mumkin."
else
  echo "    $DOMAIN -> $resolved"
fi

echo "==> 2/4  nginx sozlamasi"
if [ -e "$AVAILABLE" ]; then
  echo "    $AVAILABLE allaqachon bor — tegilmadi."
else
  cat > "$AVAILABLE" <<'NGINX'
server {
    listen 80;
    server_name onlinetalim.fermi.uz;

    # Taqdimot va video fayllari uchun — iMentor'dagi 25m bu yerda kamlik qiladi.
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:9050;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;

        # WebSocket — Jitsi va jonli yangilanishlar uchun.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
  echo "    yaratildi: $AVAILABLE"
fi

if [ -L "$ENABLED" ] || [ -e "$ENABLED" ]; then
  echo "    sayt allaqachon yoqilgan."
else
  ln -s "$AVAILABLE" "$ENABLED"
  echo "    yoqildi: $ENABLED"
fi

echo "==> 3/4  Sozlamani tekshirish va qayta o'qish"
if ! nginx -t; then
  echo
  echo "XATO: nginx sozlamasi noto'g'ri. Hech narsa qayta o'qilmadi —"
  echo "      barcha saytlar avvalgidek ishlayapti."
  echo "      Yangi faylni olib tashlash uchun:"
  echo "          rm -f $ENABLED $AVAILABLE"
  exit 1
fi
systemctl reload nginx
echo "    nginx qayta o'qildi (uzilishsiz)."

echo "==> 4/4  SSL sertifikati"
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  echo "    sertifikat allaqachon bor — tegilmadi."
else
  if command -v certbot >/dev/null 2>&1; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
      --register-unsafely-without-email --redirect || {
        echo
        echo "OGOHLANTIRISH: sertifikat olinmadi."
        echo "  Sayt HTTP orqali ishlayapti. Qo'lda urinib ko'ring:"
        echo "      sudo certbot --nginx -d $DOMAIN"
        exit 0
      }
    echo "    sertifikat olindi va HTTPS yo'naltirish qo'shildi."
  else
    echo "OGOHLANTIRISH: certbot topilmadi. Sayt HTTP orqali ishlayapti."
  fi
fi

echo
echo "TAYYOR.  https://${DOMAIN}"
echo "Tekshirish:  curl -sI https://${DOMAIN} | head -1"
