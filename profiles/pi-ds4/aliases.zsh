# Public ds4 Pi profile shell entry points.

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
  local prompt="${*:-reply with exactly OK}"
  pi-ds4-rawdog -p "$prompt"
}
