#!/bin/bash
set -euo pipefail

# Configuration
REPO_DIR="/home/haasie/owntube"
LOG_FILE="${REPO_DIR}/update.log"
LOCK_FILE="/tmp/owntube_update.lock"
BRANCH="main"

# Ensure log file exists and is writable
touch "$LOG_FILE"

# Logging helper
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$REPO_DIR" || {
    echo "Could not cd to $REPO_DIR" >&2
    exit 1
}

# Prevent overlapping executions
exec 200>"$LOCK_FILE"
flock -n 200 || {
    log "Error: Another instance of update.sh is already running."
    exit 1
}

FORCE_REBUILD=false
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -f|--force|--rebuild) FORCE_REBUILD=true ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

log "=== Starting OwnTube stack maintenance & update check ==="

# 1. Update Invidious & Companion container images from registry
log "Checking for new Invidious and Invidious Companion images..."
if docker compose pull --quiet invidious invidious-companion >> "$LOG_FILE" 2>&1; then
    log "Images checked/pulled. Recreating containers if updated..."
    docker compose up -d --remove-orphans invidious-companion invidious >> "$LOG_FILE" 2>&1
else
    log "Warning: Docker image pull encountered an issue. Keeping existing containers running."
fi

# 2. Check for upstream OwnTube git changes
log "Fetching latest git commits from origin..."
if git fetch origin "$BRANCH" --quiet >> "$LOG_FILE" 2>&1; then
    UPSTREAM_BEHIND=$(git rev-list --count HEAD..origin/"$BRANCH" 2>/dev/null || echo 0)
    if [ "$UPSTREAM_BEHIND" -gt 0 ]; then
        log "Let op: Upstream (origin/$BRANCH) heeft $UPSTREAM_BEHIND nieuwe commit(s):"
        git log --oneline -n 10 HEAD..origin/"$BRANCH" | while read -r line; do
            log "  * $line"
        done
        log "Om te mergen en te testen (bewuste handeling i.v.m. stabiliteit):"
        log "  cd $REPO_DIR && git merge origin/$BRANCH && pnpm test && docker compose build owntube && docker compose up -d"
    else
        log "OwnTube git repository is up-to-date met origin/$BRANCH."
    fi
else
    log "Warning: Git fetch failed; skipping git check."
fi

# 3. If force rebuild requested, rebuild local OwnTube image
if [ "$FORCE_REBUILD" = true ]; then
    log "Force rebuild requested. Building and restarting OwnTube..."
    docker compose build owntube >> "$LOG_FILE" 2>&1
    docker compose up -d --remove-orphans owntube owntube-cache-warmer >> "$LOG_FILE" 2>&1
    log "Rebuild complete."
fi

# 4. Verify stack health
log "Verifying container health..."
UNHEALTHY=0
for CONTAINER in invidious-db invidious-companion invidious owntube owntube-cache-warmer; do
    STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo "not_found")
    if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "running" ]; then
        log "  ✓ Container $CONTAINER is $STATUS"
    else
        log "  ✗ Container $CONTAINER status: $STATUS"
        UNHEALTHY=$((UNHEALTHY + 1))
    fi
done

if [ "$UNHEALTHY" -gt 0 ]; then
    log "Warning: $UNHEALTHY container(s) not healthy. Attempting safe recovery..."
    docker compose up -d >> "$LOG_FILE" 2>&1
fi

# 5. Clean up dangling images to keep host disk space tidy
docker image prune -f >> "$LOG_FILE" 2>&1 || true

log "=== OwnTube stack update check completed successfully ==="
