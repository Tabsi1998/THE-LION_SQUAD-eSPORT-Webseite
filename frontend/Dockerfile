FROM node:24.15.0-alpine3.23 AS build

WORKDIR /app

ARG VITE_BACKEND_URL
ARG VITE_UPLOAD_BACKEND_URL
ARG VITE_MAX_IMAGE_UPLOAD_MB=50
ARG VITE_MAX_VIDEO_UPLOAD_MB=1536
ARG VITE_MAX_DOCUMENT_UPLOAD_MB=50
ARG VITE_PROXY_UPLOAD_LIMIT_MB=1700
ARG VITE_CLIENT_LOGGING=false
ARG VITE_APP_VERSION
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_UPLOAD_BACKEND_URL=${VITE_UPLOAD_BACKEND_URL}
ENV VITE_MAX_IMAGE_UPLOAD_MB=${VITE_MAX_IMAGE_UPLOAD_MB}
ENV VITE_MAX_VIDEO_UPLOAD_MB=${VITE_MAX_VIDEO_UPLOAD_MB}
ENV VITE_MAX_DOCUMENT_UPLOAD_MB=${VITE_MAX_DOCUMENT_UPLOAD_MB}
ENV VITE_PROXY_UPLOAD_LIMIT_MB=${VITE_PROXY_UPLOAD_LIMIT_MB}
ENV VITE_CLIENT_LOGGING=${VITE_CLIENT_LOGGING}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM nginx:1.30.4-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Öffentliche Uploads liefert nginx direkt (#232): das Upload-Volume hängt
# nur lesend unter /srv/uploads, und /srv/static/api/static/uploads zeigt auf
# dessen Ordner "public", damit try_files mit root arbeiten kann.
RUN mkdir -p /srv/static/api/static /srv/uploads \
    && ln -s /srv/uploads/public /srv/static/api/static/uploads

ENTRYPOINT []
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
