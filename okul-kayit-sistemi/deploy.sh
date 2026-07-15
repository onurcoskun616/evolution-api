#!/usr/bin/env bash
# Tek komutluk üretim kurulumu (Ubuntu/Debian VPS için).
# Kullanım:  sunucuda repo klonlandıktan sonra
#   cd okul-kayit-sistemi && sudo bash deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

# 1) Docker yoksa kur
if ! command -v docker >/dev/null 2>&1; then
  echo ">> Docker kuruluyor..."
  curl -fsSL https://get.docker.com | sh
fi

# 2) .env dosyası yoksa güvenli bir JWT anahtarı üret
if [ ! -f .env ]; then
  echo ">> .env oluşturuluyor (rastgele OKUL_JWT_SECRET ile)..."
  echo "OKUL_JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '=+/' | head -c 48)" > .env
  echo "PORT=3000" >> .env
  chmod 600 .env
fi

# 3) Derle ve başlat
echo ">> Uygulama derleniyor ve başlatılıyor..."
docker compose up -d --build

echo ""
echo ">> Kurulum tamam. Yönetici şifresi için ilk açılış kaydına bakın:"
sleep 3
docker logs okul-kayit-sistemi 2>&1 | sed -n '/Kurulum tamamlandı/,/önerilir/p' || true
echo ""
echo ">> Uygulama:  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):3000"
echo ">> Alan adı + HTTPS için Caddy önerilir:  https://caddyserver.com  (Caddyfile örneği README'de)"
