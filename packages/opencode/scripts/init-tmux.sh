#!/usr/bin/env bash
#
# Tmux initialization script for app container
# 
# Usage:
#   1. Add to Dockerfile: COPY init-tmux.sh /usr/local/bin/
#   2. Call in entrypoint before starting app
#   3. Ensure /shared volume is mounted
#

set -e

TMUX_SOCKET="${TMUX_SOCKET:-/shared/tmux.sock}"
TMUX_SESSION="${TMUX_SESSION:-agent}"
TMUX_GROUP="${TMUX_GROUP:-miniapp}"

echo "🔧 Initializing tmux for opencode..."

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "❌ Error: tmux is not installed"
    echo "   Please install: apt-get install -y tmux"
    exit 1
fi

# Create shared directory if it doesn't exist
SOCKET_DIR=$(dirname "$TMUX_SOCKET")
if [ ! -d "$SOCKET_DIR" ]; then
    echo "📁 Creating socket directory: $SOCKET_DIR"
    mkdir -p "$SOCKET_DIR"
fi

# Create group if it doesn't exist
if ! getent group "$TMUX_GROUP" > /dev/null 2>&1; then
    echo "👥 Creating group: $TMUX_GROUP"
    groupadd "$TMUX_GROUP"
fi

# Ensure current user is in the group
CURRENT_USER=$(whoami)
if [ "$CURRENT_USER" != "root" ]; then
    echo "👤 Adding $CURRENT_USER to group $TMUX_GROUP"
    usermod -aG "$TMUX_GROUP" "$CURRENT_USER" 2>/dev/null || true
fi

# Kill any existing session
if tmux -S "$TMUX_SOCKET" has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "🧹 Cleaning up existing session: $TMUX_SESSION"
    tmux -S "$TMUX_SOCKET" kill-session -t "$TMUX_SESSION" 2>/dev/null || true
fi

# Create new session
echo "🚀 Creating tmux session: $TMUX_SESSION"
tmux -S "$TMUX_SOCKET" new-session -d -s "$TMUX_SESSION" -c /workspace 'bash -l'

# Set socket permissions
echo "🔐 Setting socket permissions"
chgrp "$TMUX_GROUP" "$TMUX_SOCKET" 2>/dev/null || true
chmod 660 "$TMUX_SOCKET"

# Verify setup
if tmux -S "$TMUX_SOCKET" has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "✅ Tmux initialized successfully"
    echo "   Socket: $TMUX_SOCKET"
    echo "   Session: $TMUX_SESSION"
    echo "   Group: $TMUX_GROUP"
    echo ""
    echo "   To attach: tmux -S $TMUX_SOCKET attach -t $TMUX_SESSION"
else
    echo "❌ Error: Failed to create tmux session"
    exit 1
fi
