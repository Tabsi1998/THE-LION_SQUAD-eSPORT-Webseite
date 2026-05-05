# Installation Guide — TLS ARENA on Ubuntu 24.04

## Prerequisites
- Ubuntu Server 24.04 (fresh)
- A domain (e.g., `lionsquad.at`) pointed at the server
- Root / sudo access

## 1. Install Docker + Compose

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

## 2. Clone + Configure

```bash
cd /opt
sudo git clone <your-repo> tls-arena
cd tls-arena
sudo cp .env.example .env
sudo nano .env
```

Set:
- `JWT_SECRET` — `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `ADMIN_PASSWORD` — strong password
- `FRONTEND_URL`, `CORS_ORIGINS`, `PUBLIC_BACKEND_URL` — your public URLs
- `SEED_DEMO=false` (production)

## 3. Start

```bash
sudo docker compose up -d --build
sudo docker compose logs -f
```

The frontend is now at http://your-server:3000 and backend at http://your-server:8001.

## 4. Reverse Proxy (Nginx Proxy Manager)

Create two proxy hosts:
1. `lionsquad.at` → `tls-frontend:80`
2. `lionsquad.at/api/*` → `tls-backend:8001` (or run under a separate `api.` subdomain)

Enable HTTPS (Let's Encrypt) inside NPM.
Set the proxy body size to at least 60 MB, otherwise image/document uploads can fail with
`413 Request Entity Too Large` before the app receives the request.

## 5. First Login

- Open `https://lionsquad.at/`
- Login: `admin@lionsquad.at` / the password you set
- Navigate to **/profile** → change password
- Start creating games, tournaments, and F1 challenges.

## 6. Create production admin (if you used a weak default)

```bash
docker exec -it tls-backend python -c "
import asyncio
from seed import seed_admin
asyncio.run(seed_admin())
"
```

## 7. Backups

See [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
