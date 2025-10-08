#!/usr/bin/env bash
#
# Docker entrypoint that initializes tmux before starting the app
#

set -e

# Initialize tmux if enabled
if [ "${TMUX_ENABLED:-false}" = "true" ]; then
    echo "🔧 Initializing tmux..."
    /usr/local/bin/init-tmux.sh
fi

# Execute the main command
exec "$@"
