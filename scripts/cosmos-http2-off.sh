#!/usr/bin/env bash
# Turn HTTP/2 off in Cosmos, the reverse proxy in front of OwnTube.
#
#   sudo bash scripts/cosmos-http2-off.sh          # apply
#   sudo bash scripts/cosmos-http2-off.sh --undo   # back to HTTP/2
#
# Why: Cosmos is a Go server and negotiates HTTP/2 automatically. Safari's
# HTTP/2 connection stops receiving once a media request on it is aborted
# (seek, resume, quality switch), so the iPhone player hangs until a later
# seek happens to open a fresh connection. Go's GODEBUG=http2server=0 makes
# Cosmos speak HTTP/1.1 on every route. See README_COSMOS.md.
#
# Handles both installs:
#   - native (systemd unit CosmosCloud): a drop-in with the env var;
#     --undo removes it.
#   - Docker (container from azukaar/cosmos-server): the container is
#     recreated with the same image, name, hostname, network, binds, env,
#     ports, labels and privileges plus the env var. Editing Cosmos's own
#     container from its UI does not work: Cosmos recreates itself from the
#     old config. The old container is kept (stopped, renamed) and restored
#     automatically if the new one doesn't come up.
#
# Env: APP_URL (default https://youtube.haasie.nl) is checked afterwards;
# COSMOS_CONTAINER overrides the container lookup; WAIT_SECS (default 120)
# bounds the wait for Cosmos to answer again.
set -euo pipefail

APP_URL=${APP_URL:-https://youtube.haasie.nl}
WAIT_SECS=${WAIT_SECS:-120}
MODE=apply
[ "${1:-}" = "--undo" ] && MODE=undo
STAMP=$(date +%Y%m%d-%H%M%S)
UNIT=CosmosCloud

protocol() {
  local v
  v=$(curl -so /dev/null --http2 --max-time 15 -w '%{http_version}' "$APP_URL/" 2>/dev/null) || v=0
  if [ "$v" = 0 ]; then echo "? (unreachable)"; else echo "$v"; fi
}

wait_up() {
  local deadline=$((SECONDS + WAIT_SECS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    curl -so /dev/null --max-time 5 "$APP_URL/" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}

# GODEBUG value with http2server=0 added (apply) or removed (undo), keeping
# any other settings in it.
godebug_value() {
  local cur=${1:-} part out=()
  IFS=, read -ra parts <<<"$cur"
  for part in "${parts[@]:-}"; do
    [[ -z $part || $part == http2server=* ]] || out+=("$part")
  done
  [ "$MODE" = apply ] && out+=("http2server=0")
  (IFS=,; echo "${out[*]:-}")
}

report() {
  local proto
  proto=$(protocol)
  echo "== $APP_URL now negotiates HTTP/$proto"
  if [ "$MODE" = apply ] && [ "$proto" = 2 ]; then
    echo "   still HTTP/2: something in front of Cosmos (Cloudflare?) speaks it — check the"
    echo "   server/cf-ray headers in section 1 of scripts/diagnose-playback.sh"
    exit 1
  fi
}

echo "== Before: $APP_URL negotiates HTTP/$(protocol)"

# --- native install ---------------------------------------------------------
if systemctl cat "$UNIT" >/dev/null 2>&1; then
  dropin=/etc/systemd/system/$UNIT.service.d/http2-off.conf
  echo "== Native Cosmos ($UNIT.service)"
  if [ "$MODE" = apply ]; then
    mkdir -p "$(dirname "$dropin")"
    printf '[Service]\nEnvironment=GODEBUG=%s\n' "$(godebug_value "")" >"$dropin"
    echo "   wrote $dropin"
  else
    rm -f "$dropin"
    echo "   removed $dropin"
  fi
  systemctl daemon-reload
  systemctl restart "$UNIT"
  wait_up || { echo "   Cosmos did not answer within ${WAIT_SECS}s: journalctl -u $UNIT -n 50"; exit 1; }
  report
  exit 0
fi

# --- Docker install ---------------------------------------------------------
command -v docker >/dev/null || { echo "No CosmosCloud unit and no docker: where does Cosmos run?"; exit 1; }
name=${COSMOS_CONTAINER:-$(docker ps -a --format '{{.Names}} {{.Image}}' | awk '$2 ~ /cosmos-server/ {print $1; exit}')}
[ -n "$name" ] || { echo "No container from azukaar/cosmos-server found; set COSMOS_CONTAINER=<name>"; exit 1; }
echo "== Docker Cosmos (container $name)"

insp() { docker inspect -f "$1" "$name"; }
lines() { local l; while IFS= read -r l; do [ -n "$l" ] && printf '%s\n' "$l"; done < <(insp "$1"); }

image=$(insp '{{.Config.Image}}')
compose_dir=$(insp '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || true)
if [ -n "$compose_dir" ] && [ "$compose_dir" != "<no value>" ]; then
  echo "   $name is managed by docker compose ($compose_dir). Add to its service there:"
  echo "     environment:"
  echo "       GODEBUG: http2server=0"
  echo "   then: cd $compose_dir && docker compose up -d"
  exit 1
fi
if [ "$(insp '{{json .Config.Entrypoint}}')" != "$(docker image inspect -f '{{json .Config.Entrypoint}}' "$image" 2>/dev/null)" ]; then
  echo "   $name has a custom entrypoint; recreate it by hand with -e GODEBUG=http2server=0"
  exit 1
fi
if [ "$(insp '{{len .Mounts}}')" -gt "$(insp '{{len .HostConfig.Binds}}')" ]; then
  echo "   $name has --mount volumes this script doesn't copy; recreate it by hand"
  exit 1
fi

netmode=$(insp '{{.HostConfig.NetworkMode}}')
restart=$(insp '{{.HostConfig.RestartPolicy.Name}}')
args=(--name "$name" --detach --hostname "$(insp '{{.Config.Hostname}}')" --network "$netmode")
[ "$(insp '{{.HostConfig.Privileged}}')" = true ] && args+=(--privileged)
[ -n "$restart" ] && [ "$restart" != no ] && args+=(--restart "$restart")
while IFS= read -r v; do args+=(--volume "$v"); done < <(lines '{{range .HostConfig.Binds}}{{println .}}{{end}}')
while IFS= read -r c; do args+=(--cap-add "$c"); done < <(lines '{{range .HostConfig.CapAdd}}{{println .}}{{end}}')
while IFS= read -r s; do args+=(--security-opt "$s"); done < <(lines '{{range .HostConfig.SecurityOpt}}{{println .}}{{end}}')
while IFS= read -r d; do args+=(--device "$d"); done < <(lines '{{range .HostConfig.Devices}}{{.PathOnHost}}:{{.PathInContainer}}:{{.CgroupPermissions}}{{println}}{{end}}')
while IFS= read -r l; do args+=(--label "$l"); done < <(lines '{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}')
if [ "$netmode" != host ]; then
  while IFS= read -r p; do args+=(--publish "$p"); done < <(lines '{{range $port, $binds := .HostConfig.PortBindings}}{{range $binds}}{{if .HostIp}}{{.HostIp}}:{{end}}{{.HostPort}}:{{$port}}{{println}}{{end}}{{end}}')
fi
cur=""
while IFS= read -r e; do
  if [[ $e == GODEBUG=* ]]; then cur=${e#GODEBUG=}; else args+=(--env "$e"); fi
done < <(lines '{{range .Config.Env}}{{println .}}{{end}}')
new=$(godebug_value "$cur")
[ -n "$new" ] && args+=(--env "GODEBUG=$new")
if [ "$new" = "$cur" ]; then
  echo "   GODEBUG is already '${cur:-unset}' — nothing to change"
  report
  exit 0
fi
cmd=()
while IFS= read -r c; do cmd+=("$c"); done < <(lines '{{range .Config.Cmd}}{{println .}}{{end}}')
extra_nets=()
while IFS= read -r n; do [ "$n" != "$netmode" ] && extra_nets+=("$n"); done < <(lines '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}')

old="$name-pre-http2-$STAMP"
rollback() {
  echo "   rolling back to the old container"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker rename "$old" "$name"
  [ -n "$restart" ] && docker update --restart "$restart" "$name" >/dev/null
  docker start "$name" >/dev/null
  echo "   old container is back; nothing changed"
  exit 1
}

echo "   GODEBUG: '${cur:-unset}' -> '${new:-unset}'"
echo "   stopping $name (sites behind Cosmos are down until it's back, ~10-30 s)"
docker rename "$name" "$old"
docker update --restart no "$old" >/dev/null
docker stop "$old" >/dev/null
docker run "${args[@]}" "$image" ${cmd[@]+"${cmd[@]}"} >/dev/null || rollback
for n in ${extra_nets[@]+"${extra_nets[@]}"}; do docker network connect "$n" "$name" || rollback; done
wait_up || { echo "   new container didn't answer within ${WAIT_SECS}s"; docker logs --tail 30 "$name" || true; rollback; }
report
echo "   old container kept (stopped) as $old — remove it once all is well:"
echo "     docker rm $old"
