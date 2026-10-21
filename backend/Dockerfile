FROM python:3.11.16-slim-bookworm

WORKDIR /app

# Texterkennung für Ergebnis-Bilder (#1756): Tesseract (Apache-2.0) mit Englisch und Deutsch, feste Versionen aus
# Debian bookworm. Läuft nur im Container - kein externer Dienst.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    libglib2.0-0 \
    fonts-dejavu-core \
    tesseract-ocr=5.3.0-2 \
    tesseract-ocr-eng=1:4.1.0-2 \
    tesseract-ocr-deu=1:4.1.0-2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/backend/uploads /app/backend/uploads/public /app/backend/uploads/documents \
    && chown -R appuser:appuser /app \
    && chmod +x /app/docker-entrypoint.py

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER appuser

EXPOSE 8001

CMD ["python", "/app/docker-entrypoint.py"]
