# Public ds4 Pi profile shell entry points.

pi-ds4-install() {
  local state_dir="${AGENT_PI_DS4_STATE_DIR:-$HOME/.local/state/agent-stack/pi-ds4}"
  local extension_url="${AGENT_PI_DS4_EXTENSION_URL:-https://github.com/mitsuhiko/pi-ds4}"
  PI_CODING_AGENT_DIR="$state_dir" pi install "$extension_url"
}

pi-ds4-list() {
  local state_dir="${AGENT_PI_DS4_STATE_DIR:-$HOME/.local/state/agent-stack/pi-ds4}"
  PI_CODING_AGENT_DIR="$state_dir" pi list "$@"
}

pi-ds4() {
  bondage exec pi-ds4 "${AGENT_BONDAGE_CONF:-$HOME/.config/bondage/bondage.conf}" -- "$@"
}

pi-ds4-rawdog() {
  bondage exec pi-ds4-rawdog "${AGENT_BONDAGE_CONF:-$HOME/.config/bondage/bondage.conf}" -- "$@"
}

pi-ds4-direct() {
  pi-ds4-rawdog "$@"
}

pi-ds4-bench() {
  local prompt="${*:-reply with OK}"
  pi-ds4-rawdog -p "$prompt"
}
