FROM oven/bun:1@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS builder

WORKDIR /build/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY ./web ./
COPY ./VERSION /build/VERSION
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat /build/VERSION) bun run build

FROM golang:1.26.1-alpine@sha256:2389ebfa5b7f43eeafbd6be0c3700cc46690ef842ad962f6c5bd6be49ed82039 AS builder2
ENV GO111MODULE=on CGO_ENABLED=0 GOWORK=off

ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

ADD go.mod go.sum ./
# relaykit is a local submodule referenced via replace; its go.mod must be
# present for go mod download to resolve the main module graph.
ADD relaykit/go.mod ./relaykit/go.mod
RUN go mod download

COPY . .
COPY --from=builder /build/web/dist ./web/dist
RUN go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

FROM debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a AS companion-builder

ARG TARGETARCH
ARG NODE_VERSION=24.18.0
ARG NODE_AMD64_SHA256=55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742
ARG NODE_ARM64_SHA256=58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH:-amd64}" in \
      amd64) node_arch=x64; node_sha256="${NODE_AMD64_SHA256}" ;; \
      arm64) node_arch=arm64; node_sha256="${NODE_ARM64_SHA256}" ;; \
      *) echo "unsupported Node.js architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && node_archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    && curl --fail --location --retry 3 --output "/tmp/${node_archive}" \
      "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}" \
    && printf '%s  %s\n' "${node_sha256}" "/tmp/${node_archive}" | sha256sum --check --strict \
    && tar -xJf "/tmp/${node_archive}" -C /usr/local --strip-components=1 --no-same-owner \
    && rm -f "/tmp/${node_archive}" \
    && node --version \
    && npm --version

WORKDIR /build/companion
COPY companion/package.json companion/package-lock.json ./
RUN npm ci --ignore-scripts
COPY companion/src ./src
COPY companion/public ./public
COPY companion/test ./test
RUN npm test

FROM debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a

ARG APP_GIT_COMMIT=""
ARG APP_DEPLOYED_AT="0"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 libatomic1 wget \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates \
    && groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --shell /usr/sbin/nologin --create-home node \
    && install -d -o 1000 -g 1000 /app/data

COPY --from=builder2 /build/new-api /
COPY --from=companion-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=companion-builder --chown=1000:1000 /build/companion/src /opt/new-api/companion/src
COPY --from=companion-builder --chown=1000:1000 /build/companion/public /opt/new-api/companion/public
COPY --from=companion-builder --chown=1000:1000 /build/companion/package.json /opt/new-api/companion/package.json
COPY LICENSE NOTICE THIRD-PARTY-LICENSES.md /licenses/
COPY --from=companion-builder /usr/local/LICENSE /licenses/NODE-LICENSE

ENV APP_GIT_COMMIT=${APP_GIT_COMMIT} \
    APP_DEPLOYED_AT=${APP_DEPLOYED_AT}

EXPOSE 3000 8787
WORKDIR /data
ENTRYPOINT ["/new-api"]
