# UNHEARD backend — Cloud Run image (same code as the desktop sidecar).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 \
    UNHEARD_DB_PATH=/tmp/unheard.db APPDATA=/tmp
WORKDIR /srv

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/app backend/app
COPY backend/run_backend.py backend/run_backend.py
COPY data/processed/districts.json data/processed/districts.json

WORKDIR /srv/backend
CMD ["sh", "-c", "python run_backend.py --host 0.0.0.0 --port ${PORT}"]
