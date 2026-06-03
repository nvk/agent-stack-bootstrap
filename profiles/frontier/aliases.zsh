# Public frontier-client shell entry points.
# These do not shadow raw claude/codex/opencode/pi commands.

_agent_stack_bondage_conf() {
  print -r -- "${AGENT_BONDAGE_CONF:-$HOME/.config/bondage/bondage.conf}"
}

_agent_stack_require_versions() {
  local checker="${AGENT_STACK_VERSION_CHECK:-$HOME/.config/agent-stack/version-check.sh}"

  [[ "${AGENT_STACK_SKIP_VERSION_CHECK:-0}" = "1" ]] && return 0
  [[ -x "$checker" ]] || {
    print -u2 -- "agent-stack: version checker not executable: $checker"
    return 1
  }

  "$checker" --strict --quiet
}

claude-safe() {
  _agent_stack_require_versions || return $?
  bondage exec claude "$(_agent_stack_bondage_conf)" -- "$@"
}

codex-safe() {
  _agent_stack_require_versions || return $?
  bondage exec codex "$(_agent_stack_bondage_conf)" -- "$@"
}

opencode-safe() {
  _agent_stack_require_versions || return $?
  bondage exec opencode "$(_agent_stack_bondage_conf)" -- "$@"
}

pi-safe() {
  _agent_stack_require_versions || return $?
  bondage exec pi "$(_agent_stack_bondage_conf)" -- "$@"
}

frontier-safe-verify() {
  local conf
  _agent_stack_require_versions || return $?
  conf="$(_agent_stack_bondage_conf)"
  bondage verify claude "$conf"
  bondage verify codex "$conf"
  bondage verify opencode "$conf"
  bondage verify pi "$conf"
}
