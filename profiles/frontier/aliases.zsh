# Public frontier-client shell entry points.
# These do not shadow raw claude/codex/opencode/pi commands.

_agent_stack_bondage_conf() {
  print -r -- "${AGENT_BONDAGE_CONF:-$HOME/.config/bondage/bondage.conf}"
}

claude-safe() {
  bondage exec claude "$(_agent_stack_bondage_conf)" -- "$@"
}

codex-safe() {
  bondage exec codex "$(_agent_stack_bondage_conf)" -- "$@"
}

opencode-safe() {
  bondage exec opencode "$(_agent_stack_bondage_conf)" -- "$@"
}

pi-safe() {
  bondage exec pi "$(_agent_stack_bondage_conf)" -- "$@"
}

frontier-safe-verify() {
  local conf
  conf="$(_agent_stack_bondage_conf)"
  bondage verify claude "$conf"
  bondage verify codex "$conf"
  bondage verify opencode "$conf"
  bondage verify pi "$conf"
}
