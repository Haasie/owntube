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

# 1. Update the Invidious image from the registry. The companion is NOT pulled:
#    it is mdbraber's patched build (SABR live + Camoufox PO tokens), compiled
#    locally from github.com/mdbraber/invidious-companion — see step 2b.
log "Checking for a new Invidious image..."
if docker compose pull --quiet invidious >> "$LOG_FILE" 2>&1; then
    docker compose up -d --remove-orphans invidious >> "$LOG_FILE" 2>&1
    log "Invidious image checked/pulled."
else
    log "Warning: Invidious image pull failed. Keeping the running container."
fi

# 2a. New OwnTube commits from mdbraber (remote "upstream"; "origin" is our fork)
log "Fetching mdbraber/owntube (upstream)..."
if git fetch upstream "$BRANCH" --quiet >> "$LOG_FILE" 2>&1; then
    UPSTREAM_BEHIND=$(git rev-list --count HEAD..upstream/"$BRANCH" 2>/dev/null || echo 0)
    if [ "$UPSTREAM_BEHIND" -gt 0 ]; then
        log "Let op: mdbraber/owntube heeft $UPSTREAM_BEHIND nieuwe commit(s):"
        git log --oneline -n 10 HEAD..upstream/"$BRANCH" | while read -r line; do
            log "  * $line"
        done
        log "Mergen en testen (bewuste handeling i.v.m. stabiliteit):"
        log "  cd $REPO_DIR && git merge upstream/$BRANCH && pnpm test && git push origin $BRANCH"
        log "  (GitHub Actions bouwt daarna ghcr.io/haasie/owntube:latest en Cosmos rolt hem uit.)"
    else
        log "OwnTube is up-to-date met mdbraber/owntube."
    fi
else
    log "Warning: git fetch upstream failed; skipping OwnTube check."
fi

# 2b. New commits in mdbraber's patched companion
COMPANION_DIR="$(dirname "$REPO_DIR")/invidious-companion"
if [ -d "$COMPANION_DIR/.git" ] && git -C "$COMPANION_DIR" fetch origin master --quiet >> "$LOG_FILE" 2>&1; then
    C_BEHIND=$(git -C "$COMPANION_DIR" rev-list --count HEAD..origin/master 2>/dev/null || echo 0)
    if [ "$C_BEHIND" -gt 0 ]; then
        log "Let op: mdbraber/invidious-companion heeft $C_BEHIND nieuwe commit(s). Bouwen en testen volgens PATCHES.md:"
        log "  cd $COMPANION_DIR && git pull && docker build -t local/invidious-companion:\$(date +%Y.%m.%d)-master-\$(git rev-parse --short HEAD) ."
        log "  daarna image: in $REPO_DIR/docker-compose.yml bijwerken en: docker compose up -d invidious-companion"
    else
        log "Companion is up-to-date met mdbraber/invidious-companion."
    fi
fi

# 3. Forced update: pull the latest OwnTube image now instead of waiting for
#    Cosmos. The image is built by GitHub Actions (.github/workflows/deploy.yml)
#    and pushed to ghcr.io/haasie/owntube; nothing is built on this host.
if [ "$FORCE_REBUILD" = true ]; then
    log "Forced update requested. Pulling ghcr.io/haasie/owntube:latest and recreating OwnTube..."
    docker compose pull owntube owntube-cache-warmer >> "$LOG_FILE" 2>&1
    docker compose up -d --remove-orphans owntube owntube-cache-warmer >> "$LOG_FILE" 2>&1
    log "Update complete."
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
