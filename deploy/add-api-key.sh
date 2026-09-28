#!/bin/bash
# FerMI integratsiyasi uchun yangi tashqi API kaliti qo'shadi.
#
# Eski kalitlar OLIB TASHLANMAYDI: `IMENTOR_EXTERNAL_API_KEYS` vergul bilan
# ajratilgan ro'yxatni qabul qiladi, ya'ni yangi kalit qo'shilganda eskisi
# ham ishlayveradi. Shu tufayli fermi.uz yangi kalitga o'tguncha uzilmaydi.
# Ular o'tgach, soxta kalitlar alohida olib tashlanadi.
#
# Kalit hech qayerda chop etilmaydi — faqat `.env` ga yoziladi.
set -euo pipefail
cd /home/imentor

cp .env ".env.bak-apikey-$(date +%Y%m%d-%H%M%S)"

OLD=$(grep -E '^IMENTOR_EXTERNAL_API_KEYS=' .env | cut -d= -f2-)
echo "eski kalitlar soni: $(echo "$OLD" | awk -F, '{print NF}')"

# 24 bayt tasodifiy = 48 belgi. `fermi_` prefiksi kalit kimniki ekanini
# aytadi — keyinchalik qaysi birini bekor qilishni bilish uchun.
NEWKEY="fermi_$(openssl rand -hex 24)"

# `sed` ishlatilmadi: kalit ichida sed uchun maxsus belgilar chiqib qolishi
# mumkin. Qator butunlay qayta yoziladi.
grep -v -E '^IMENTOR_EXTERNAL_API_KEYS=' .env > .env.tmp
printf 'IMENTOR_EXTERNAL_API_KEYS=%s,%s\n' "$OLD" "$NEWKEY" >> .env.tmp
mv .env.tmp .env
chmod 600 .env

echo "yangi kalit qoshildi: uzunlik ${#NEWKEY} belgi, prefiks fermi_"
grep -E '^IMENTOR_EXTERNAL_API_KEYS=' .env | awk -F= '{n=split($2,a,","); print "endi kalitlar soni: " n}'
