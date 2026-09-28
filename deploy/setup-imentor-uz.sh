#!/usr/bin/env bash
#
# iMentor'ni `imentor.uz` domeniga o'tkazadi.
#
# Ishlatish (serverda):
#     sudo bash /home/imentor/deploy/setup-imentor-uz.sh
#
# Keyin sayt tekshirilgach, eski domenni yangisiga yo'naltirish uchun:
#     sudo bash /home/imentor/deploy/setup-imentor-uz.sh --redirect-old
#
# Nima qiladi:
#   1. DNS va konteyner ishlayotganini tekshiradi
#   2. HTTP blokini yozadi (sertifikat tekshiruvi shu orqali o'tadi)
#   3. Sertifikatni oladi yoki mavjudini ishlatadi
#   4. YAKUNIY sozlamani o'zi yozadi: 80 -> 443 yo'naltirish va HTTPS bloki
#   5. Ichki tarmoq uchun dnsmasq yozuvini qo'shadi
#   6. Har bosqichda tekshiradi; xato bo'lsa zaxiradan qaytaradi
#
# MUHIM: eski `imentor.devflix.uz` TEGILMAYDI. Ikkala domen ham ishlaydi.
# Eski havolalar, yorliqlar va saqlangan parollar buzilmaydi. Yo'naltirish
# faqat siz `--redirect-old` bilan qayta ishga tushirganingizda qo'shiladi.
#
# Ma'lumotlarga umuman tegilmaydi: baza, yuklangan tarqatma materiallar,
# rasmlar va foydalanuvchilar Docker hajmlarida turadi va domenga bog'liq
# emas. Bu skript faqat nginx sozlamasini o'zgartiradi.

set -euo pipefail

DOMAIN="imentor.uz"
ALT="www.imentor.uz"
OLD_DOMAIN="imentor.devflix.uz"
UPSTREAM="127.0.0.1:9050"
AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
OLD_SITE="/etc/nginx/sites-available/${OLD_DOMAIN}"
LIVE="/etc/letsencrypt/live/${DOMAIN}"

REDIRECT_OLD="no"
[ "${1:-}" = "--redirect-old" ] && REDIRECT_OLD="yes"

if [ "$(id -u)" -ne 0 ]; then
  echo "XATO: skript root huquqi bilan ishlashi kerak."
  echo "      sudo bash $0"
  exit 1
fi

# Server NAT ortida: tashqi 80/443 router orqali LAN manziliga keladi.
# nginx bloklarni ULANISH KELGAN SOKET bo'yicha tanlaydi va aniq manzil
# umumiy `listen 443` dan ustun turadi. Boshqa saytlarda `listen
# 192.168.0.101:443` bor; faqat `listen 443` yozilgan blok o'sha soket uchun
# nomzodlar ro'yxatiga umuman tushmaydi va so'rov boshqa saytga ketadi.
LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -1)"

backup() {
  [ -e "$1" ] || return 0
  local dst="$1.bak-$(date +%Y%m%d-%H%M%S)"
  cp -a "$1" "$dst"
  echo "    zaxira: $dst"
}

# `nginx -t` dan o'tmasa — zaxiradan qaytaradi va to'xtaydi.
apply_or_restore() {
  local file="$1"
  if nginx -t 2>&1 | grep -q "successful"; then
    systemctl reload nginx
    return 0
  fi
  nginx -t || true
  local last
  last="$(ls -t "$file".bak-* 2>/dev/null | head -1 || true)"
  if [ -n "$last" ]; then
    cp -a "$last" "$file"
    echo "XATO: sozlama noto'g'ri — zaxiradan qaytarildi ($last)."
  else
    rm -f "$file" "$ENABLED"
    echo "XATO: sozlama noto'g'ri — yangi fayl olib tashlandi."
  fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  echo "      Barcha saytlar avvalgidek ishlayapti."
  exit 1
}

proxy_body() {
  echo "    client_max_body_size 25m;"
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
  echo "        # WebSocket va jonli oqim (SSE) uchun."
  echo "        proxy_set_header Upgrade    \$http_upgrade;"
  echo "        proxy_set_header Connection \"upgrade\";"
  echo "        proxy_buffering off;"
  echo "    }"
}

# ==========================================================================
# Eski domenni yangisiga yo'naltirish (alohida, ixtiyoriy qadam)
# ==========================================================================
if [ "$REDIRECT_OLD" = "yes" ]; then
  echo "==> Eski domenni ${DOMAIN} ga yo'naltirish"

  if [ ! -e "$OLD_SITE" ]; then
    echo "XATO: $OLD_SITE topilmadi."
    exit 1
  fi

  # Yangi domen haqiqatan ishlayaptimi — yo'naltirishdan OLDIN tekshiramiz.
  code="$(curl -sk -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" https://127.0.0.1/ || echo 000)"
  if [ "$code" != "200" ]; then
    echo "XATO: https://${DOMAIN} javob bermayapti (kod: $code)."
    echo "      Yo'naltirish qo'shilmadi — eski domen avvalgidek ishlayapti."
    echo "      Avval skriptni bayroqsiz ishga tushiring."
    exit 1
  fi
  echo "    ${DOMAIN} ishlayapti (200)."

  backup "$OLD_SITE"

  # Sertifikat eskisiniki bo'lib qoladi — busiz brauzer yo'naltirishdan
  # oldin ogohlantirish chiqaradi.
  {
    echo "# ${OLD_DOMAIN} -> ${DOMAIN} (301). Eski havolalar ishlashda davom etadi."
    echo "server {"
    echo "    listen 443 ssl;"
    [ -n "$LAN_IP" ] && echo "    listen ${LAN_IP}:443 ssl;"
    echo "    server_name ${OLD_DOMAIN};"
    echo ""
    echo "    ssl_certificate     /etc/letsencrypt/live/${OLD_DOMAIN}/fullchain.pem;"
    echo "    ssl_certificate_key /etc/letsencrypt/live/${OLD_DOMAIN}/privkey.pem;"
    echo "    include /etc/letsencrypt/options-ssl-nginx.conf;"
    echo "    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
    echo ""
    echo "    return 301 https://${DOMAIN}\$request_uri;"
    echo "}"
    echo "server {"
    echo "    listen 80;"
    [ -n "$LAN_IP" ] && echo "    listen ${LAN_IP}:80;"
    echo "    server_name ${OLD_DOMAIN};"
    echo "    return 301 https://${DOMAIN}\$request_uri;"
    echo "}"
  } > "${OLD_SITE}.new"
  mv "${OLD_SITE}.new" "$OLD_SITE"

  apply_or_restore "$OLD_SITE"
  echo "    yo'naltirish qo'shildi va nginx qayta o'qildi."
  echo
  echo "Tekshiruv:"
  printf "    %-26s %s\n" "$OLD_DOMAIN" \
    "$(curl -sk -o /dev/null -w '%{http_code}' -H "Host: ${OLD_DOMAIN}" https://127.0.0.1/)  (301 kutilgan)"
  printf "    %-26s %s\n" "$DOMAIN" \
    "$(curl -sk -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" https://127.0.0.1/)  (200 kutilgan)"
  echo
  echo "TAYYOR. Eski manzilga kirgan odam avtomatik https://${DOMAIN} ga o'tadi."
  exit 0
fi

# ==========================================================================
# Asosiy qadam: imentor.uz ni yo'lga qo'yish
# ==========================================================================
echo "==> 1/6  Oldindan tekshiruv"
for d in "$DOMAIN" "$ALT"; do
  resolved="$(getent hosts "$d" | awk '{print $1}' | head -1 || true)"
  if [ -z "$resolved" ]; then
    echo "XATO: $d uchun DNS yozuvi yo'q. Avval A yozuvini qo'shing."
    exit 1
  fi
  echo "    DNS : $d -> $resolved"
done
[ -n "$LAN_IP" ] && echo "    LAN : $LAN_IP" || echo "OGOHLANTIRISH: LAN manzili aniqlanmadi."

if ! curl -s -o /dev/null --max-time 5 "http://${UPSTREAM}/"; then
  echo "XATO: iMentor ${UPSTREAM} da javob bermayapti. Konteynerni tekshiring:"
  echo "      docker compose -f /home/imentor/docker-compose.prod.yml ps"
  exit 1
fi
echo "    iMentor ${UPSTREAM} da ishlayapti."

echo "==> 2/6  Vaqtinchalik HTTP bloki (sertifikat tekshiruvi uchun)"
backup "$AVAILABLE"
{
  echo "server {"
  echo "    listen 80;"
  [ -n "$LAN_IP" ] && echo "    listen ${LAN_IP}:80;"
  echo "    server_name ${DOMAIN} ${ALT};"
  echo ""
  proxy_body
  echo "}"
} > "$AVAILABLE"
[ -L "$ENABLED" ] || [ -e "$ENABLED" ] || ln -s "$AVAILABLE" "$ENABLED"
apply_or_restore "$AVAILABLE"
echo "    yozildi va qayta o'qildi."

echo "==> 3/6  Sertifikat"
if ! command -v certbot >/dev/null 2>&1; then
  echo "XATO: certbot topilmadi. HTTPS'siz domenni ishga tushirib bo'lmaydi."
  echo "      Sayt hozircha HTTP orqali ishlaydi: http://${DOMAIN}"
  exit 1
fi

if [ -d "$LIVE" ]; then
  echo "    mavjud sertifikat topildi:"
  openssl x509 -in "${LIVE}/fullchain.pem" -noout -enddate 2>/dev/null | sed 's/^/      /' || true
  openssl x509 -in "${LIVE}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
    tail -n +2 | tr -d ' ' | sed 's/^/      nomlar: /' || true
fi

# Serverda bir nechta Let's Encrypt hisobi bor va certbot avtomatik rejimda
# "Please choose an account" deb to'xtaydi. Mavjud sertifikatlarning
# ko'pchiligi qaysi hisobda bo'lsa — o'shani olamiz.
ACCOUNT="$(grep -hoE '^account = [0-9a-f]+' /etc/letsencrypt/renewal/*.conf 2>/dev/null |
  awk '{print $3}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')"
ACCOUNT_ARG=""
[ -n "$ACCOUNT" ] && ACCOUNT_ARG="--account $ACCOUNT" && echo "    hisob: $ACCOUNT"

# `certonly` — certbot nginx faylini O'ZI tahrirlamaydi. Yakuniy sozlamani
# 4-bosqichda o'zimiz yozamiz, shunda natija oldindan aniq bo'ladi.
# `--expand` mavjud sertifikatga yetishmayotgan nomni qo'shadi,
# `--keep-until-expiring` esa muddati yetmagan bo'lsa qayta so'ramaydi.
if certbot certonly --nginx --cert-name "$DOMAIN" -d "$DOMAIN" -d "$ALT" \
    --expand --keep-until-expiring --non-interactive --agree-tos \
    --register-unsafely-without-email $ACCOUNT_ARG; then
  echo "    sertifikat tayyor."
else
  echo
  echo "XATO: sertifikat olinmadi."
  if [ -d "$LIVE" ]; then
    echo "  Lekin mavjud sertifikat bor — u bilan davom etamiz."
  else
    echo "  Sayt HTTP orqali ISHLAYAPTI: http://${DOMAIN}"
    echo "  Qo'lda urinib ko'ring:"
    echo "      sudo certbot certonly --nginx -d $DOMAIN -d $ALT $ACCOUNT_ARG"
    exit 1
  fi
fi

if [ ! -d "$LIVE" ]; then
  echo "XATO: ${LIVE} topilmadi — HTTPS bloki yozilmaydi."
  exit 1
fi

echo "==> 4/6  Yakuniy sozlama (80 -> 443 va HTTPS bloki)"
backup "$AVAILABLE"
{
  echo "# iMentor — ${DOMAIN}. Bu faylni setup-imentor-uz.sh yozadi."
  echo "server {"
  echo "    listen 443 ssl;"
  # NAT ortida LAN manzili SHART: usiz HTTPS so'rov boshqa saytga tushadi.
  [ -n "$LAN_IP" ] && echo "    listen ${LAN_IP}:443 ssl;"
  echo "    server_name ${DOMAIN} ${ALT};"
  echo ""
  echo "    ssl_certificate     ${LIVE}/fullchain.pem;"
  echo "    ssl_certificate_key ${LIVE}/privkey.pem;"
  echo "    include /etc/letsencrypt/options-ssl-nginx.conf;"
  echo "    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  echo ""
  proxy_body
  echo "}"
  echo ""
  echo "server {"
  echo "    listen 80;"
  [ -n "$LAN_IP" ] && echo "    listen ${LAN_IP}:80;"
  echo "    server_name ${DOMAIN} ${ALT};"
  echo "    return 301 https://${DOMAIN}\$request_uri;"
  echo "}"
} > "$AVAILABLE"
apply_or_restore "$AVAILABLE"
echo "    yozildi va qayta o'qildi."

echo "==> 5/6  Ichki tarmoq DNS (dnsmasq)"
#
# Server NAT ortida turadi va router ichkaridan O'Z tashqi IP'siga qaytarib
# bermaydi (hairpin yo'q). Shuning uchun institut ichidagi kompyuterlar
# domenni tashqi IP orqali ocha olmaydi — ular uchun dnsmasq domenni LAN
# manziliga yo'naltiradi. `imentor.devflix.uz` va `fermi.uz` allaqachon shu
# ro'yxatda; `imentor.uz` esa yo'q edi va aynan shuning uchun ichkarida
# sayt ochilmasdi. Tashqarida (uyda, mobil internetda) hammasi ishlaydi.
DNS_FILE="/etc/dnsmasq.d/imentor-uz.conf"
dns_changed="no"

if ! systemctl is-active dnsmasq >/dev/null 2>&1; then
  echo "    dnsmasq ishlamayapti — o'tkazib yuborildi."
elif [ -z "$LAN_IP" ]; then
  echo "    LAN manzili aniqlanmadi — o'tkazib yuborildi."
else
  # --- 1) dnsmasq yozuvi ---
  if grep -rqs "address=/${DOMAIN}/" /etc/dnsmasq.d/ /etc/dnsmasq.conf 2>/dev/null; then
    echo "    dnsmasq yozuvi allaqachon bor."
  else
    {
      echo "# iMentor — institut ichki tarmog'i uchun."
      echo "#"
      echo "# Router ichkaridan tashqi IP'ga qaytarmaydi, shuning uchun LAN"
      echo "# ichidagi kompyuterlar domenni to'g'ridan-to'g'ri serverdan oladi."
      echo "# dnsmasq'da bu qoida quyi domenlarga ham tarqaladi, ya'ni"
      echo "# www.${DOMAIN} ham shu manzilga tushadi."
      echo "address=/${DOMAIN}/${LAN_IP}"
    } > "$DNS_FILE"
    dns_changed="yes"
    echo "    yozuv qo'shildi: ${DOMAIN} -> ${LAN_IP}"
  fi

  # --- 2) /etc/hosts dagi loopback yozuvi ---
  #
  # Bu tekshiruv yuqoridagidan MUSTAQIL bo'lishi kerak. dnsmasq `/etc/hosts`
  # ni ham butun tarmoqqa tarqatadi va aynan shu nom uchun u `address=`
  # yozuvidan ustun keladi: LAN'dagi brauzer 127.0.0.1 ni olib, O'Z
  # kompyuteriga ulanmoqchi bo'ladi va "ERR_CONNECTION_REFUSED" chiqadi.
  # Domen nomi o'sha qatordan olib tashlanadi; qolgan nomlar tegilmaydi.
  if grep -qE "^[[:space:]]*127\.[0-9.]+[[:space:]].*[[:space:]]${DOMAIN}([[:space:]]|$)" /etc/hosts; then
    backup /etc/hosts
    python3 - "$DOMAIN" <<'PYEOF'
import io, sys
domain = sys.argv[1]
path = "/etc/hosts"
out = []
for line in io.open(path, encoding="utf-8").read().splitlines(True):
    body = line.split("#", 1)[0]
    parts = body.split()
    if len(parts) >= 2 and parts[0].startswith("127.") and domain in parts[1:]:
        kept = [p for p in parts[1:] if p != domain]
        if kept:
            out.append(parts[0] + " " + " ".join(kept) + '\n')
        # Boshqa nom qolmasa — qator butunlay olib tashlanadi.
        continue
    out.append(line)
io.open(path, "w", encoding="utf-8", newline="").write("".join(out))
print(f"    /etc/hosts dan olib tashlandi: {domain} -> 127.0.0.1")
PYEOF
    dns_changed="yes"
  else
    echo "    /etc/hosts toza."
  fi

  # --- 3) Faqat biror narsa o'zgargan bo'lsa qayta ishga tushiramiz ---
  if [ "$dns_changed" = "no" ]; then
    echo "    o'zgarish yo'q — dnsmasq tegilmadi."
  elif ! dnsmasq --test >/dev/null 2>&1; then
    rm -f "$DNS_FILE"
    echo "XATO: dnsmasq sozlamasi noto'g'ri — yozuv olib tashlandi."
    echo "      Tarmoq DNS'i avvalgidek ishlayapti."
    exit 1
  elif systemctl restart dnsmasq; then
    sleep 2
    got="$(dig +short +time=3 +tries=1 "$DOMAIN" @"$LAN_IP" 2>/dev/null | head -1)"
    if [ "$got" = "$LAN_IP" ]; then
      echo "    tekshirildi: ${DOMAIN} -> ${got}"
    elif [ -z "$got" ]; then
      echo "    dnsmasq qayta o'qidi, lekin tekshiruvda javob kelmadi."
    else
      echo "OGOHLANTIRISH: ${DOMAIN} hamon ${got} ni qaytaryapti."
      echo "  Boshqa joyda ham shu nom bog'langan bo'lishi mumkin:"
      grep -rn "${DOMAIN}" /etc/hosts /etc/dnsmasq.conf /etc/dnsmasq.d/ 2>/dev/null | sed 's/^/    /'
    fi
  else
    # DNS butun institutga xizmat qiladi — ishga tushmasa darrov qaytaramiz.
    rm -f "$DNS_FILE"
    systemctl restart dnsmasq || true
    echo "XATO: dnsmasq qayta ishga tushmadi — yozuv olib tashlandi va qaytarildi."
    exit 1
  fi
fi

echo "==> 6/6  Tekshiruv"
new_code="$(curl -sk -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" https://127.0.0.1/ || echo 000)"
old_code="$(curl -sk -o /dev/null -w '%{http_code}' -H "Host: ${OLD_DOMAIN}" https://127.0.0.1/ || echo 000)"
printf "    %-26s %s\n" "https://${DOMAIN}"     "$new_code"
printf "    %-26s %s\n" "https://${OLD_DOMAIN}" "$old_code"

if [ "$new_code" != "200" ]; then
  echo
  echo "OGOHLANTIRISH: yangi domen 200 qaytarmadi."
  echo "  Eski domen tegilmagan va ishlayapti. Chiqqan matnni saqlab qo'ying."
  exit 1
fi

echo
echo "TAYYOR."
echo "  Yangi manzil : https://${DOMAIN}"
echo "  Eski manzil  : https://${OLD_DOMAIN}  (hamon ishlayapti, tegilmadi)"
echo
echo "Sayt to'g'ri ochilganiga ishonch hosil qilgach, eski domenni yangisiga"
echo "yo'naltirish uchun:"
echo "    sudo bash $0 --redirect-old"
