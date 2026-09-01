FROM oven/bun:1@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS frontend-builder

WORKDIR /build/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web ./
COPY VERSION /build/VERSION
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat /build/VERSION) bun run build

FROM debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a AS app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 nginx tzdata wget \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates \
    && install -d -o www-data -g www-data /var/cache/nginx

COPY --from=frontend-builder /build/web/dist /usr/share/nginx/html
COPY deploy/server/app-nginx.conf /etc/nginx/nginx.conf
COPY LICENSE NOTICE THIRD-PARTY-LICENSES.md /licenses/

EXPOSE 3000
WORKDIR /app
CMD ["nginx", "-g", "daemon off;"]
