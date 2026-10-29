# One container: builds the React app, then serves it and the API from FastAPI.
FROM node:22-alpine AS web
WORKDIR /srv/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /srv/frontend/dist /srv/frontend/dist
RUN useradd --create-home app && mkdir -p /data && chown app /data
USER app
ENV DATABASE_URL=sqlite:////data/kumbuka.db
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
