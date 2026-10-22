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
# Modell-Liste von RapidOCR 3.10.0) fest im Image; zur Laufzeit wird nichts geladen. Die Quelle ist wählbar
# (Build-Argument OCR_MODEL_URL, in docker-compose.yml aus der .env - etwa eine Kopie im GitHub-Release); leer heißt
# die Vorgabe unten. Die Prüfsumme ist fest (ocr-model.sha256): eine andere Datei bricht den Bau ab.
ARG OCR_MODEL_URL=
COPY ocr-model.sha256 /opt/ocr-models/PP-OCRv6_rec_small.onnx.sha256
RUN url="${OCR_MODEL_URL:-https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx}" \
    && python -c "import hashlib, sys, urllib.request; data = urllib.request.urlopen(sys.argv[1], timeout=300).read(); \
expected = open(sys.argv[2], encoding='ascii').read().split()[0]; \
assert hashlib.sha256(data).hexdigest() == expected, 'SHA-256 des Modells passt nicht'; \
open(sys.argv[3], 'wb').write(data)" "$url" /opt/ocr-models/PP-OCRv6_rec_small.onnx.sha256 \
       /opt/ocr-models/PP-OCRv6_rec_small.onnx \
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
