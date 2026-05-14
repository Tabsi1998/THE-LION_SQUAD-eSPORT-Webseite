FROM node:20-alpine AS build

WORKDIR /app

ARG REACT_APP_BACKEND_URL
ARG REACT_APP_MAX_IMAGE_UPLOAD_MB=50
ARG REACT_APP_MAX_DOCUMENT_UPLOAD_MB=50
ARG REACT_APP_PROXY_UPLOAD_LIMIT_MB=60
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}
ENV REACT_APP_MAX_IMAGE_UPLOAD_MB=${REACT_APP_MAX_IMAGE_UPLOAD_MB}
ENV REACT_APP_MAX_DOCUMENT_UPLOAD_MB=${REACT_APP_MAX_DOCUMENT_UPLOAD_MB}
ENV REACT_APP_PROXY_UPLOAD_LIMIT_MB=${REACT_APP_PROXY_UPLOAD_LIMIT_MB}

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
