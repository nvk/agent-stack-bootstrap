# Public ds4 Claude Code profile shell entry points.

typeset -g DS4_CLAUDE_PROFILE_DIR="${${(%):-%x}:A:h}"

claude-ds4() {
  "$DS4_CLAUDE_PROFILE_DIR/claude-ds4" "$@"
}

cds4() {
  claude-ds4 "$@"
}
