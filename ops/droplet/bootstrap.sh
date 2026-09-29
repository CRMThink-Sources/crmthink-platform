#!/usr/bin/env bash
# Prepara um droplet Ubuntu (22.04/24.04) para o deploy do CI: usuário `deploy`, Docker,
# firewall, swap, rede `crmthink` e a infraestrutura compartilhada (MySQL, Redis, Caddy).
#
# Uso, como root, com a pasta ops/droplet copiada para o droplet
# (`scp -r ops/droplet root@<ip>:/root/`; DEPLOY_PUBKEY é opcional):
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions" \
#   STAGING_HOST=platform-staging.crmthink.com.br \
#   PRODUCTION_HOST=platform.crmthink.com.br \
#   ACME_EMAIL=infra@crmthink.com.br \
#   bash /root/droplet/bootstrap.sh
#
# Idempotente: rodar de novo atualiza hosts/arquivos e não troca senhas já geradas
# (ficam em /opt/crmthink-infra/.env).
set -euo pipefail

# DEPLOY_PUBKEY é opcional: sem ela, a chave do CI entra depois em
# /home/deploy/.ssh/authorized_keys (o deploy falha no SSH até lá).
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-}"
: "${STAGING_HOST:?informe STAGING_HOST}"
: "${PRODUCTION_HOST:?informe PRODUCTION_HOST}"
: "${ACME_EMAIL:?informe ACME_EMAIL (avisos de certificado)}"

INFRA_DIR=/opt/crmthink-infra
ENV_FILE="$INFRA_DIR/.env"
DEPLOY_USER=deploy
NETWORK=crmthink
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" = 0 ] || { echo "rode como root" >&2; exit 1; }
for f in docker-compose.infra.yml Caddyfile; do
  [ -f "$HERE/$f" ] || { echo "$HERE/$f não encontrado: copie a pasta ops/droplet inteira" >&2; exit 1; }
done

log() { printf '\n==> %s\n' "$*"; }

log "Pacotes base e Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl openssl ufw unattended-upgrades
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

log "Usuário $DEPLOY_USER"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
AUTH_KEYS="/home/$DEPLOY_USER/.ssh/authorized_keys"
touch "$AUTH_KEYS"
if [ -n "$DEPLOY_PUBKEY" ]; then
  grep -qxF "$DEPLOY_PUBKEY" "$AUTH_KEYS" || echo "$DEPLOY_PUBKEY" >> "$AUTH_KEYS"
fi
chmod 600 "$AUTH_KEYS"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH_KEYS"
for env in staging production; do
  install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/crmthink-platform-$env"
done

# Só desliga login por senha se o root já entra por chave (evita se trancar fora).
if [ -s /root/.ssh/authorized_keys ]; then
  log "SSH só por chave"
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/10-crmthink.conf
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
fi

log "Firewall (22, 80, 443)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

if ! swapon --show | grep -q .; then
  log "Swap de 2G"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Infraestrutura em $INFRA_DIR"
install -d -m 750 "$INFRA_DIR"
install -m 644 "$HERE/docker-compose.infra.yml" "$HERE/Caddyfile" "$INFRA_DIR/"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

set_var() {
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
ensure_secret() { grep -q "^$1=" "$ENV_FILE" || echo "$1=$(openssl rand -hex 24)" >> "$ENV_FILE"; }
get_var() { grep "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2-; }

set_var STAGING_HOST "$STAGING_HOST"
set_var PRODUCTION_HOST "$PRODUCTION_HOST"
set_var ACME_EMAIL "$ACME_EMAIL"
grep -q '^ADMIN_ALLOWED_IPS=' "$ENV_FILE" || echo 'ADMIN_ALLOWED_IPS="0.0.0.0/0 ::/0"' >> "$ENV_FILE"
ensure_secret MYSQL_ROOT_PASSWORD
ensure_secret STAGING_DB_PASSWORD
ensure_secret PRODUCTION_DB_PASSWORD
ensure_secret REDIS_PASSWORD

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

cd "$INFRA_DIR"
docker compose -f docker-compose.infra.yml up -d
# `restart` recarrega o Caddyfile atualizado.
docker compose -f docker-compose.infra.yml restart caddy >/dev/null

log "Aguardando o MySQL"
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' crmthink-mysql)" = healthy ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' crmthink-mysql)" = healthy ] || { echo "MySQL não ficou saudável" >&2; exit 1; }

STAGING_DB_PASSWORD="$(get_var STAGING_DB_PASSWORD)"
PRODUCTION_DB_PASSWORD="$(get_var PRODUCTION_DB_PASSWORD)"
REDIS_PASSWORD="$(get_var REDIS_PASSWORD)"

log "Databases e usuários (DDL liberado: as migrações rodam no deploy)"
docker compose -f docker-compose.infra.yml exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' <<SQL
CREATE DATABASE IF NOT EXISTS crmthink_platform_staging;
CREATE DATABASE IF NOT EXISTS crmthink_platform;
CREATE USER IF NOT EXISTS 'platform_staging'@'%' IDENTIFIED BY '$STAGING_DB_PASSWORD';
CREATE USER IF NOT EXISTS 'platform'@'%' IDENTIFIED BY '$PRODUCTION_DB_PASSWORD';
GRANT ALL PRIVILEGES ON crmthink_platform_staging.* TO 'platform_staging'@'%';
GRANT ALL PRIVILEGES ON crmthink_platform.* TO 'platform'@'%';
FLUSH PRIVILEGES;
SQL

cat <<EOF

Pronto. Aponte o DNS (registro A) de $STAGING_HOST e $PRODUCTION_HOST para este droplet;
o Caddy emite os certificados assim que o DNS resolver.

Valores para as Variables/Secrets de cada GitHub Environment (docs/operations/runbook.md):

  staging:
    DATABASE_URL=mysql://platform_staging:$STAGING_DB_PASSWORD@mysql:3306/crmthink_platform_staging?allowPublicKeyRetrieval=true
    REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379/1
    QUEUE_PREFIX=crmthink-platform-staging
    PUBLIC_BASE_URL=https://$STAGING_HOST

  production:
    DATABASE_URL=mysql://platform:$PRODUCTION_DB_PASSWORD@mysql:3306/crmthink_platform?allowPublicKeyRetrieval=true
    REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379/0
    QUEUE_PREFIX=crmthink-platform-production
    PUBLIC_BASE_URL=https://$PRODUCTION_HOST
EOF

if [ ! -s "$AUTH_KEYS" ]; then
  cat <<EOF2

ATENÇÃO: $AUTH_KEYS está vazio. O deploy do CI falha no SSH até a chave pública
entrar lá (a privada vai no secret DEPLOY_SSH_KEY):
  echo 'ssh-ed25519 AAAA... github-actions-deploy' >> $AUTH_KEYS
EOF2
fi
