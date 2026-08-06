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
cd /root
sudo git clone <your-repo> THE-LION_SQUAD-eSPORT-Webseite
cd THE-LION_SQUAD-eSPORT-Webseite
sudo cp .env.example .env
sudo nano .env
```

Set:
- `JWT_SECRET` — `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `ADMIN_PASSWORD` — strong one-time bootstrap password; `install.sh` removes it afterwards
- `FRONTEND_URL`, `CORS_ORIGINS`, `PUBLIC_BACKEND_URL` — your public URLs
- `PUBLIC_UPLOAD_BACKEND_URL` — optional DNS-only upload URL for large media behind Cloudflare
- optional `PUBLIC_BASE_URL` — public website URL for generated links and Discord webhook media
- `APP_ENV=production` (required; missing/unknown values fail closed)

## 3. Start

```bash
sudo docker compose up -d --build
sudo docker compose logs -f
```

The frontend is now at http://your-server:3000 and backend at http://your-server:8001.

## 4. Reverse Proxy (Nginx Proxy Manager)

Create two proxy hosts:
1. `lionsquad.at` -> frontend container / host port `3000`
2. `lionsquad.at/api/*` -> backend container / host port `8001`

Enable HTTPS (Let's Encrypt) inside NPM.
Set the proxy body size to at least 1700 MB when direct gallery video uploads are enabled,
otherwise image/document/video uploads can fail with
`413 Request Entity Too Large` before the app receives the request.

## 5. First admin and login

Prefer `./install.sh`, which creates the first superadmin once and then removes
`ADMIN_PASSWORD` from `.env`. The normal API startup never creates, promotes, unbans,
or reactivates an account.

For an explicit manual bootstrap, pass the secret only to the one-off container:

```bash
export BOOTSTRAP_ADMIN_EMAIL="admin@example.com"
read -rsp "Initial admin password: " BOOTSTRAP_ADMIN_PASSWORD; export BOOTSTRAP_ADMIN_PASSWORD
docker compose run --rm --no-deps \
  -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD \
  backend python bootstrap_admin.py
unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
```

The command exits without changing anything when a superadmin already exists. It refuses
to promote an existing non-admin account with the same email address.

## 6. Backups

See [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
