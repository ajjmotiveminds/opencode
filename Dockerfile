# Use multi-stage build to keep final image small
FROM oven/bun:1.2 AS builder

# Install build dependencies
RUN apt-get update && \
    apt-get install -y bash curl make python3 git && \
    rm -rf /var/lib/apt/lists/*

# Install Go
RUN bash <<'EOF'
set -euo pipefail
case "${TARGETARCH:-amd64}" in
  amd64) GOARCH=amd64 ;;
  arm64) GOARCH=arm64 ;;
  *) echo "Unsupported TARGETARCH: ${TARGETARCH}"; exit 1;;
esac
curl -fsSL "https://go.dev/dl/go1.21.5.linux-${GOARCH}.tar.gz" \
  | tar -C /usr/local -xzf -
echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile.d/go.sh
EOF
ENV PATH="/usr/local/go/bin:${PATH}"

# Copy source and build
RUN git clone https://github.com/ajjmotiveminds/opencode.git /app/opencode
# RUN mkdir -p /app/opencode && git clone https://github.com/ajjmotiveminds/opencode.git /app/opencode
WORKDIR /app/opencode
RUN bun install --ignore-scripts --no-progress
RUN export PATH=$PATH:/usr/local/go/bin && bun run packages/opencode/script/build.ts

# Final runtime stage - much smaller
FROM oven/bun:slim AS runtime

# Only copy the built binaries, not the source
COPY --from=builder /app/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/local/bin/opencode

# Set up PATH
ENV PATH="/usr/local/bin:$PATH"

# Create entrypoint
RUN echo '#!/bin/bash\n\
set -e\n\
if [ $# -eq 0 ]; then\n\
    echo "Starting opencode interactive session..."\n\
    echo "Use opencode commands like: opencode --help"\n\
    exec bash\n\
fi\n\
exec opencode "$@"' > /usr/local/bin/opencode-entrypoint.sh && \
    chmod +x /usr/local/bin/opencode-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint.sh"]
CMD []