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

# Zweiter Leser für Ergebnis-Bilder (#2018): das Erkennungsmodell PP-OCRv6 small (ONNX, Apache-2.0, aus der
# Modell-Liste von RapidOCR 3.10.0) fest im Image - Version und SHA-256 gepinnt; zur Laufzeit wird nichts geladen.
ARG OCR_MODEL_URL=https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx
ARG OCR_MODEL_SHA256=6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884
RUN mkdir -p /opt/ocr-models \
    && python -c "import hashlib, sys, urllib.request; data = urllib.request.urlopen(sys.argv[1], timeout=300).read(); \
assert hashlib.sha256(data).hexdigest() == sys.argv[2], 'SHA-256 des Modells passt nicht'; \
open(sys.argv[3], 'wb').write(data)" "$OCR_MODEL_URL" "$OCR_MODEL_SHA256" /opt/ocr-models/PP-OCRv6_rec_small.onnx \
    && chmod -R a+rX /opt/ocr-models

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
