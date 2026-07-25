#!/usr/bin/env bash
# Tek komutluk KALICI kurulum (Ubuntu/Debian sunucu; CRM + QR ile aynı makinede güvenli).
#
# Kullanım (repo klonlandıktan sonra):
#   cd okul-kayit-sistemi && sudo bash deploy.sh
# Alan adı + otomatik HTTPS de isteniyorsa (nginx kuruluysa):
#   sudo bash deploy.sh okul.topkapiokullari.com
#
# Yaptıkları: Docker kur -> .env üret -> derle & başlat (127.0.0.1:8090) ->
#             günlük yedek cron -> (alan adı verildiyse) nginx vhost + Let's Encrypt.
# Veri kalıcı Docker biriminde tutulur; sunucu/konteyner yeniden başlasa da SİLİNMEZ.
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:-}"
PORT="${PORT:-8090}"

echo ">> 1/5 Docker kontrolü..."
if ! command -v docker >/dev/null 2>&1; then
  echo "   Docker kuruluyor..."
  curl -fsSL https://get.docker.com | sh
fi

echo ">> 2/5 Yapılandırma (.env)..."
if [ ! -f .env ]; then
  {
    echo "OKUL_JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '=+/' | head -c 48)"
    echo "PORT=${PORT}"
    echo "OKUL_BIND=127.0.0.1"
    echo "OKUL_KAMPUSLER=MRK:İkitelli OSB,IST:İstanbul OSB,ESN:Esenyurt,KRC:Kıraç,CRL:Çorlu"
  } > .env
  chmod 600 .env
  echo "   .env oluşturuldu (kampüsleri gerekirse .env içinde düzenleyin)."
else
  echo "   Mevcut .env korunuyor."
fi

echo ">> 3/5 Derleniyor ve başlatılıyor..."
docker compose up -d --build

echo ">> 4/5 Günlük otomatik yedek (02:00) kuruluyor..."
cat > /etc/cron.d/okul-yedek <<'CRON'
0 2 * * * root docker exec okul-kayit-sistemi node backup.js >> /var/log/okul-yedek.log 2>&1
CRON
echo "   /etc/cron.d/okul-yedek yazıldı (yedekler kalıcı diskte backups/ altında)."

if [ -n "$DOMAIN" ]; then
  echo ">> 5/5 Alan adı + HTTPS: $DOMAIN"
  if command -v nginx >/dev/null 2>&1; then
    cat > "/etc/nginx/sites-available/okul" <<NGINX
server {
    server_name ${DOMAIN};
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
    ln -sf /etc/nginx/sites-available/okul /etc/nginx/sites-enabled/okul
    nginx -t && systemctl reload nginx
    if command -v certbot >/dev/null 2>&1; then
      certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || \
        echo "   (certbot otomatik çalışmadı; 'certbot --nginx -d $DOMAIN' komutunu elle çalıştırın.)"
    else
      echo "   certbot yok. HTTPS için: apt install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN"
    fi
  else
    echo "   nginx bulunamadı. Ters vekil örnekleri için KURULUM-SUNUCU.md (nginx/Caddy/Apache)."
  fi
else
  echo ">> 5/5 Alan adı verilmedi. Dışarı açmak için ters vekil kurun (KURULUM-SUNUCU.md)."
fi

echo ""
echo "================= KURULUM TAMAM ================="
sleep 3
docker logs okul-kayit-sistemi 2>&1 | sed -n '/Kurulum tamamlandı/,/önerilir/p' || true
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)"
if [ -n "$DOMAIN" ]; then echo ">> Adres:  https://${DOMAIN}"; else echo ">> Yerel:  http://127.0.0.1:${PORT}  (ters vekil ile dışarı açın)"; fi
echo ">> Yukarıdaki 'admin' şifresini kaydedin (bir daha gösterilmez)."
echo "================================================"
