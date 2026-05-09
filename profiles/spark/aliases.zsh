# Public Spark Claude Code profile shell entry points.

typeset -g SPARK_PROFILE_DIR="${${(%):-%x}:A:h}"

_spark_ssh_target() {
  local host="${SPARK_HOST:-${AGENT_SPARK_HOST:-${AGENT_REMOTE_SSH_HOST:-}}}"
  local user="${SPARK_USER:-${AGENT_SPARK_USER:-${AGENT_REMOTE_SSH_USER:-$USER}}}"

  if [[ -z "$host" ]]; then
    print -u2 "set SPARK_HOST or AGENT_SPARK_HOST before using this profile"
    return 2
  fi

  print -r -- "${user}@${host}"
}

claude-spark() {
  "$SPARK_PROFILE_DIR/claude-spark" "$@"
}

cspark() {
  claude-spark "$@"
}

spark-ssh() {
  local target
  target="$(_spark_ssh_target)" || return
  ssh -F "${SPARK_SSH_CONFIG:-${AGENT_SPARK_SSH_CONFIG:-none}}" "$target" "$@"
}

spark-dashboard() {
  local target
  target="$(_spark_ssh_target)" || return
  ssh -F "${SPARK_SSH_CONFIG:-${AGENT_SPARK_SSH_CONFIG:-none}}" \
    -L "${SPARK_DASHBOARD_LOCAL_PORT:-${AGENT_SPARK_DASHBOARD_LOCAL_PORT:-11000}}:localhost:${SPARK_DASHBOARD_PORT:-${AGENT_SPARK_DASHBOARD_PORT:-11000}}" \
    "$target" "$@"
}

spark-ollama() {
  local target
  target="$(_spark_ssh_target)" || return
  ssh -F "${SPARK_SSH_CONFIG:-${AGENT_SPARK_SSH_CONFIG:-none}}" \
    -L "${SPARK_OLLAMA_LOCAL_PORT:-${AGENT_SPARK_OLLAMA_LOCAL_PORT:-11434}}:localhost:${SPARK_OLLAMA_PORT:-${AGENT_SPARK_OLLAMA_PORT:-${AGENT_REMOTE_OLLAMA_PORT:-11434}}}" \
    "$target" "$@"
}

spark-tunnels() {
  local target
  target="$(_spark_ssh_target)" || return
  ssh -F "${SPARK_SSH_CONFIG:-${AGENT_SPARK_SSH_CONFIG:-none}}" \
    -L "${SPARK_DASHBOARD_LOCAL_PORT:-${AGENT_SPARK_DASHBOARD_LOCAL_PORT:-11000}}:localhost:${SPARK_DASHBOARD_PORT:-${AGENT_SPARK_DASHBOARD_PORT:-11000}}" \
    -L "${SPARK_OLLAMA_LOCAL_PORT:-${AGENT_SPARK_OLLAMA_LOCAL_PORT:-11434}}:localhost:${SPARK_OLLAMA_PORT:-${AGENT_SPARK_OLLAMA_PORT:-${AGENT_REMOTE_OLLAMA_PORT:-11434}}}" \
    "$target" "$@"
}
