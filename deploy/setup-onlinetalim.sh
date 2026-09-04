#!/usr/bin/env bash
#
# onlinetalim.fermi.uz domenini yo'lga qo'yadi.
#
# Ishlatish (serverda):
#     sudo bash /home/imentor/deploy/setup-onlinetalim.sh
#
# Nima qiladi:
#   1. Domen serverga ko'rsatayotganini tekshiradi
#   2. nginx faylini yaratadi YOKI mavjudini to'g'rilaydi
#   3. Sozlamani tekshiradi (`nginx -t`) — xato bo'lsa TO'XTAYDI
#   4. nginx'ni `reload` qiladi ("restart" emas: boshqa domenlar uzilmaydi)
#   5. Let's Encrypt sertifikatini oladi va 443 blokini to'g'rilaydi
#
# Xavfsiz: qayta ishga tushirish mumkin, boshqa saytlarga tegilmaydi.

set -euo pipefail

DOMAIN="onlinetalim.fermi.uz"
UPSTREAM="127.0.0.1:9060"     # online portalning o'z gateway'i
AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

if [ "$(id -u)" -ne 0 ]; then
  echo "XATO: skript root huquqi bilan ishlashi kerak."
  echo "      sudo bash $0"
  exit 1
fi

# --- LAN manzili ---------------------------------------------------------
#
# Server NAT ortida turadi: tashqi 80/443 router orqali LAN manziliga
# (192.168.0.101) yo'naltirilgan.
#
# nginx ulanish kelgan SOKET bo'yicha bloklarni tanlaydi va aniqroq manzil
# ustun keladi. Boshqa saytlarda `listen 192.168.0.101:80` bor; faqat
# `listen 80` yozilgan blok esa o'sha soket uchun nomzodlar ro'yxatiga
# umuman tushmaydi — natijada so'rov boshqa saytga ketadi.
#
# Aynan shu sabab: sertifikat tekshiruvi `aishifokor.uz` ga tushib
# muvaffaqiyatsiz bo'lgan, HTTPS so'rovlar esa `agromix.uz` ga tushib
# 502 bergan.
LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -1)"

echo "==> 1/5  Oldindan tekshiruv"
resolved="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ -z "$resolved" ]; then
  echo "OGOHLANTIRISH: $DOMAIN uchun DNS yozuvi topilmadi."
  echo "               Sertifikat bosqichi yiqilishi mumkin."
else
  echo "    DNS : $DOMAIN -> $resolved"
fi
if [ -n "$LAN_IP" ]; then
  echo "    LAN : $LAN_IP"
else
  echo "OGOHLANTIRISH: LAN manzili aniqlanmadi — faqat umumiy listen yoziladi."
fi

echo "==> 2/5  nginx sozlamasi"
{
  echo "server {"
  echo "    listen 80;"
  [ -n "$LAN_IP" ] && echo "    listen ${LAN_IP}:80;"
  echo "    server_name ${DOMAIN};"
  echo ""
  echo "    # Taqdimot va video fayllari uchun."
  echo "    client_max_body_size 100m;"
  echo ""
  echo "    location / {"
  echo "        proxy_pass http://${UPSTREAM};"
  echo "        proxy_http_version 1.1;"
  echo "        proxy_set_header Host              \$host;"
  echo "        proxy_set_header X-Real-IP         \$remote_addr;"
  echo "        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;"
  echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
  echo "        proxy_read_timeout 300s;"
  echo ""
  echo "        # WebSocket — Jitsi va jonli yangilanishlar uchun."
  echo "        proxy_set_header Upgrade    \$http_upgrade;"
  echo "        proxy_set_header Connection \"upgrade\";"
  echo "    }"
  echo "}"
} > "$AVAILABLE.new"

if [ -e "$AVAILABLE" ] && grep -q "listen ${LAN_IP}:443" "$AVAILABLE" 2>/dev/null; then
  # Sertifikat allaqachon olingan va 443 bloki bor — faylni qayta yozmaymiz,
  # aks holda certbot qo'shgan sozlamalar yo'qoladi.
  rm -f "$AVAILABLE.new"
  echo "    443 bloki mavjud — fayl tegilmadi."
else
  mv "$AVAILABLE.new" "$AVAILABLE"
  echo "    yozildi: $AVAILABLE"
fi

if [ -L "$ENABLED" ] || [ -e "$ENABLED" ]; then
  echo "    sayt allaqachon yoqilgan."
else
  ln -s "$AVAILABLE" "$ENABLED"
  echo "    yoqildi: $ENABLED"
fi

echo "==> 3/5  Tekshirish va qayta o'qish"
if ! nginx -t 2>&1 | grep -q "successful"; then
  nginx -t || true
  echo
  echo "XATO: nginx sozlamasi noto'g'ri. Hech narsa qayta o'qilmadi —"
  echo "      barcha saytlar avvalgidek ishlayapti."
  exit 1
fi
systemctl reload nginx
echo "    nginx qayta o'qildi (uzilishsiz)."

echo "==> 4/5  SSL sertifikati"
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  echo "    sertifikat allaqachon bor."
elif ! command -v certbot >/dev/null 2>&1; then
  echo "OGOHLANTIRISH: certbot topilmadi. Sayt HTTP orqali ishlayapti."
else
  # Serverda bir nechta Let's Encrypt hisobi bor va certbot avtomatik
  # rejimda "Please choose an account" deb to'xtaydi. Mavjud
  # sertifikatlarning ko'pchiligi qaysi hisobda bo'lsa — o'shani olamiz,
  # aks holda yangilash vaqtida ikkita hisob aralashib ketadi.
  ACCOUNT="$(grep -hoE '^account = [0-9a-f]+' /etc/letsencrypt/renewal/*.conf 2>/dev/null |
    awk '{print $3}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')"
  ACCOUNT_ARG=""
  if [ -n "$ACCOUNT" ]; then
    ACCOUNT_ARG="--account $ACCOUNT"
    echo "    hisob: $ACCOUNT"
  fi

  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
      --register-unsafely-without-email --redirect $ACCOUNT_ARG; then
    echo "    sertifikat olindi."
  else
    echo
    echo "OGOHLANTIRISH: sertifikat olinmadi."
    echo "  Sayt HTTP orqali ISHLAYAPTI: http://${DOMAIN}"
    echo "  Qo'lda urinib ko'ring:"
    echo "      sudo certbot --nginx -d $DOMAIN $ACCOUNT_ARG"
    exit 0
  fi
fi

echo "==> 5/5  443 blokiga LAN manzilini qo'shish"
#
# certbot faqat `listen 443 ssl` yozadi. NAT ortida bu yetmaydi: LAN
# manziliga aniq bog'langan boshqa saytlar ustun keladi va HTTPS so'rov
# ularga tushib ketadi (aynan shu 502 ni keltirib chiqargan edi).
if [ -n "$LAN_IP" ] && grep -q "listen 443 ssl" "$AVAILABLE" 2>/dev/null; then
  if grep -q "listen ${LAN_IP}:443" "$AVAILABLE"; then
    echo "    allaqachon bor."
  else
    sed -i "0,/listen 443 ssl/s//listen 443 ssl;\n    listen ${LAN_IP}:443 ssl/" "$AVAILABLE"
    if nginx -t 2>&1 | grep -q "successful"; then
      systemctl reload nginx
      echo "    qo'shildi va qayta o'qildi."
    else
      echo "XATO: qo'shilgandan keyin sozlama buzildi — orqaga qaytaring:"
      echo "      sudo sed -i '/listen ${LAN_IP}:443/d' $AVAILABLE && sudo nginx -t && sudo systemctl reload nginx"
      exit 1
    fi
  fi
else
  echo "    443 bloki yo'q — o'tkazib yuborildi."
fi

echo
echo "TAYYOR."
echo "Tekshirish:"
echo "    curl -sI https://${DOMAIN} | head -1"
