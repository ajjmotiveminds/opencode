# Build stage
FROM oven/bun:latest AS builder

WORKDIR /app

# Install git for cloning dependencies
# RUN apk add --no-cache git
RUN apt-get update && apt-get install -y git python3 make libvips curl build-essential nodejs tmux npm && rm -rf /var/lib/apt/lists/*

# Set Go version
ENV GO_VERSION=1.24.0

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl tar xz-utils; \
    rm -rf /var/lib/apt/lists/*; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) goarch=amd64 ;; \
      arm64) goarch=arm64 ;; \
      *) echo "Unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    url="https://go.dev/dl/go${GO_VERSION}.linux-${goarch}.tar.gz"; \
    curl -fsSL "${url}" -o /tmp/go.tgz; \
    rm -rf /usr/local/go; \
    tar -C /usr/local -xzf /tmp/go.tgz; \
    rm /tmp/go.tgz

# Minimal env; append GOPATH/bin to PATH
ENV GOROOT=/usr/local/go \
    GOPATH=/root/go \
    PATH=/usr/local/go/bin:/root/go/bin:$PATH



COPY . .


ENV BUN_JOBS=1 \
    npm_config_loglevel=silly \
    npm_config_jobs=1 \
    MAKEFLAGS=-j1 \
    PYTHONUNBUFFERED=1




RUN  npm install -g node-gyp
RUN bun install --ci --no-progress  --verbose

RUN /bin/bash -c "cd packages/opencode && bun run build"

 

# --- Production (POC) ---
FROM oven/bun:1.1.30-alpine AS runtime

# Tools we actually use
RUN apk add --no-cache bash tmux tini ca-certificates

# App dir
WORKDIR /app

# Arch-specific binary (buildx sets TARGETARCH = amd64|arm64)
ARG TARGETARCH
RUN echo "Target architecture: ${TARGETARCH}"

# Copy your built binary
RUN mkdir -p /app/bin
COPY --from=builder /app/packages/opencode/dist/opencode-linux-${TARGETARCH}/bin/opencode /app/bin/opencode
COPY --from=builder /app/packages/opencode/package.json /app/

# PATH
ENV PATH="/app/bin:${PATH}"

# Shared dir for tmux socket (mounted from host). Go wide-open (POC).
RUN mkdir -p /shared && chmod 0777 /shared

# tmux/env defaults
ENV TMUX_SOCKET=/shared/tmux.sock \
    TMUX_SESSION=agent \
    TMUX_ENABLED=true \
    NODE_ENV=production

# tini as PID1 so Ctrl-C & signals work
ENTRYPOINT ["/sbin/tini","--","/app/bin/opencode"]
CMD ["serve","--port","4096","--host","0.0.0.0"]

# optional (clean shutdowns)
STOPSIGNAL SIGTERM
