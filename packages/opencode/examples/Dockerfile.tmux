# Example Dockerfile for App Container with Tmux Support

FROM node:20-bookworm

# Install tmux and other dependencies
RUN apt-get update && \
    apt-get install -y \
    tmux \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Create miniapp group for socket sharing
RUN groupadd -g 1001 miniapp

# Copy tmux initialization script
COPY packages/opencode/scripts/init-tmux.sh /usr/local/bin/init-tmux.sh
RUN chmod +x /usr/local/bin/init-tmux.sh

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Copy your application
COPY . .
RUN npm install

# Environment defaults
ENV TMUX_SOCKET=/shared/tmux.sock \
    TMUX_SESSION=agent \
    TMUX_GROUP=miniapp

# Entrypoint that initializes tmux then starts app
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default command
CMD ["npm", "start"]
