FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/backend/uploads /app/backend/uploads/public /app/backend/uploads/documents \
    && chown -R appuser:appuser /app \
    && chmod +x /app/docker-entrypoint.py

USER root

EXPOSE 8001

CMD ["python", "/app/docker-entrypoint.py"]
