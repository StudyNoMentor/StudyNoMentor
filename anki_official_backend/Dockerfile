FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ANKI_DATA_DIR=/data/anki-official

WORKDIR /app
COPY anki_official_backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY anki_official_backend/app.py ./app.py

RUN mkdir -p /data/anki-official
VOLUME ["/data"]
EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
