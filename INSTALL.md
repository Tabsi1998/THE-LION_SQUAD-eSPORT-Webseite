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

## 2. Clone + Installieren

```bash
cd /root
sudo git clone <your-repo> THE-LION_SQUAD-eSPORT-Webseite
cd THE-LION_SQUAD-eSPORT-Webseite
sudo ./install.sh
```

Der Installer erzeugt `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, Mongo-Zugang und – sofern die
Dateirechte es erlauben – das separate Backup-Passwort. Er fragt URL und einmaliges
Adminpasswort ab. Provider wie Google, SMTP, Discord und Twitch werden danach ausschließlich mit
deinen eigenen Zugängen im Adminbereich konfiguriert; siehe [CONFIGURATION.md](CONFIGURATION.md).

## 3. Laufende Installation prüfen

```bash
sudo docker compose ps
sudo docker compose logs -f
```

The frontend is now at http://your-server:3000 and backend at http://your-server:8001.

## 4. Reverse Proxy (Nginx Proxy Manager)

Create two proxy hosts:
1. `lionsquad.at` -> frontend container / host port `3000`
2. `lionsquad.at/api/*` -> backend container / host port `8001`

Enable HTTPS (Let's Encrypt) inside NPM.
Enable HTTP-to-HTTPS redirection and preserve the public `Host`. NPM must set
`X-Forwarded-For` and `X-Forwarded-Proto`; the application accepts these headers
only from the IP networks configured in `TRUSTED_PROXY_CIDRS`.
Set the proxy body size to at least 1700 MB when direct gallery video uploads are enabled,
otherwise image/document/video uploads can fail with
`413 Request Entity Too Large` before the app receives the request.

For a proxy installed directly on the host, Loopback is sufficient:

```env
TRUST_PROXY_HEADERS=true
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

For a Docker-based proxy or when all traffic first reaches the frontend container,
add and then narrow the corresponding Docker network shown by
`docker network inspect`. Never configure `*`, `0.0.0.0/0`, or `::/0`.

### Proxy on another machine, Cloudflare in front

When Nginx Proxy Manager runs on a different host than the stack (and Cloudflare proxies the
domain), two settings decide whether the application sees the visitor or only the proxy:

1. Server `.env`: add the address of the proxy host to the trusted sources, then
   `docker compose up -d backend`:

   ```env
   TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128,172.16.0.0/12,<proxy-host-ip>/32
   ```

2. Nginx Proxy Manager -> proxy host -> Advanced, only when the Cloudflare record is proxied
   (orange cloud): `real_ip_header CF-Connecting-IP;` plus one `set_real_ip_from <network>;` line
   for each Cloudflare network listed at https://www.cloudflare.com/ips/. With a DNS-only record
   (grey cloud) this block is not needed.

Without them every session carries the proxy address, and every per-address limit (registration,
password reset, two-factor) is shared by all visitors. The admin shows this under
System -> Betrieb & Logs -> Checks -> "Besucher-Adresse".

Cloudflare caps a proxied request at 100 MB regardless of the body size configured in the proxy
manager; larger uploads need the DNS-only upload host described in `docs/BETRIEB.md`.

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
