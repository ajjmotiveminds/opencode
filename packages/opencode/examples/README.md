# Tmux Examples

This directory contains examples and configuration templates for setting up tmux-backed command execution with OpenCode.

## Files

### Configuration Examples

- **`Dockerfile.tmux`** - Example Dockerfile with tmux support
- **`docker-compose.tmux.yml`** - Complete docker-compose setup
- **`docker-entrypoint.sh`** - Entrypoint script that initializes tmux

### Code Examples

- **`tmux-example.ts`** - Programmatic usage of TmuxExecutor

## Quick Test

### 1. Set up tmux locally

```bash
# Create socket directory
sudo mkdir -p /shared
sudo chmod 755 /shared

# Start tmux session
tmux -S /shared/tmux.sock new-session -d -s agent 'cd /workspace && bash -l'
sudo chmod 666 /shared/tmux.sock  # For testing only, use proper group in production
```

### 2. Run the example

```bash
cd packages/opencode
export TMUX_SOCKET=/shared/tmux.sock
export TMUX_SESSION=agent
bun run examples/tmux-example.ts
```

Expected output:
```
🔍 Checking tmux health...
✅ Tmux is healthy

🚀 Executing command...
📡 Execution ready: { transport: 'tmux', session: 'agent', windowName: 'cs:examp1', paneId: '%0', jobId: '...' }
$ echo 'Hello from tmux!' && sleep 1 && echo 'Done'
Hello from tmux!
Done
🏁 Exit code: 0

✅ Execution completed
📊 Result: { exitCode: 0, outputLength: 42 }
```

### 3. Watch in tmux

In another terminal:
```bash
tmux -S /shared/tmux.sock attach -t agent
# Press Ctrl-b w to see windows
# Navigate to cs:examp1 to see the command
```

## Docker Test

### Build and run

```bash
cd packages/opencode/examples

# Build image
docker build -f Dockerfile.tmux -t app-with-tmux ../..

# Run with docker-compose
docker-compose -f docker-compose.tmux.yml up -d

# Check logs
docker-compose -f docker-compose.tmux.yml logs -f

# Attach to tmux
docker-compose -f docker-compose.tmux.yml exec app \
  tmux -S /shared/tmux.sock attach -t agent
```

### Test command execution

```bash
# From opencode container
docker-compose -f docker-compose.tmux.yml exec opencode bash

# Inside container
export TMUX_ENABLED=true
export TMUX_SOCKET=/shared/tmux.sock
export TMUX_SESSION=agent

# Run example
bun run /workspace/examples/tmux-example.ts
```

## Kubernetes Test

Apply the example deployment:

```bash
# Create namespace
kubectl create namespace opencode-test

# Create ConfigMap with init script
kubectl create configmap tmux-init \
  --from-file=init-tmux.sh=../scripts/init-tmux.sh \
  -n opencode-test

# Apply deployment (create your own based on TMUX_SETUP.md)
kubectl apply -f k8s-deployment.yaml -n opencode-test

# Check logs
kubectl logs -n opencode-test -l app=opencode -c opencode -f

# Attach to tmux
kubectl exec -n opencode-test -it deployment/app -- \
  tmux -S /shared/tmux.sock attach -t agent
```

## Troubleshooting Examples

See parent directory's `TMUX_SETUP.md` for comprehensive troubleshooting guide.

### Quick checks

```bash
# Check socket
ls -la /shared/tmux.sock

# Check session
tmux -S /shared/tmux.sock ls

# Check windows
tmux -S /shared/tmux.sock list-windows -t agent

# Manual test
tmux -S /shared/tmux.sock attach -t agent
```
