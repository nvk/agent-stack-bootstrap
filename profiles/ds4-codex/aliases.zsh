# Public ds4 Codex profile shell entry points.

typeset -g DS4_CODEX_PROFILE_DIR="${${(%):-%x}:A:h}"

codex-ds4() {
  "$DS4_CODEX_PROFILE_DIR/codex-ds4" "$@"
}

xds4() {
  codex-ds4 "$@"
}
