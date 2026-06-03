#!/usr/bin/env bash
set -euo pipefail

mode="warn"
quiet=0

usage() {
  cat <<'EOU'
usage: version-check.sh [--warn|--strict] [--quiet]

Checks installed external tool versions against agent-stack requirements.
Default mode is --warn. Use --strict in launch/CI paths to fail on drift.
EOU
}

while (($#)); do
  case "$1" in
    --warn) mode="warn" ;;
    --strict) mode="strict" ;;
    --quiet) quiet=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "version-check: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

msg() {
  if [[ "$quiet" != "1" ]]; then
    printf '%s\n' "$*"
  fi
}

failures=0
warns=0

note_fail() {
  printf 'version-check: %s\n' "$*" >&2
  failures=$((failures + 1))
}

note_warn() {
  printf 'version-check: %s\n' "$*" >&2
  warns=$((warns + 1))
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_home="${AGENT_CONFIG_HOME:-$HOME/.config/agent-stack}"
requirements_file="${AGENT_STACK_REQUIREMENTS:-$config_home/requirements.env}"

if [[ -r "$requirements_file" ]]; then
  # shellcheck source=/dev/null
  source "$requirements_file"
elif [[ -r "$script_dir/requirements.env" ]]; then
  # shellcheck source=/dev/null
  source "$script_dir/requirements.env"
else
  note_fail "requirements file not found (looked for $requirements_file and $script_dir/requirements.env)"
fi

AGENT_STACK_CHECK_TOOLS="${AGENT_STACK_CHECK_TOOLS:-nono bondage envchain-xtra node codex claude-code opencode}"

first_semver() {
  sed -E 's/[^0-9]*([0-9]+([.][0-9]+){0,3}).*/\1/' | awk 'NF {print; exit}'
}

version_key() {
  local version="$1"
  local IFS=.
  local -a parts
  read -r -a parts <<<"$version"
  printf '%06d.%06d.%06d.%06d' \
    "${parts[0]:-0}" "${parts[1]:-0}" "${parts[2]:-0}" "${parts[3]:-0}"
}

version_satisfies() {
  local version="$1"
  local constraints="$2"
  local term op want vkey wkey

  [[ -z "$constraints" ]] && return 0
  vkey="$(version_key "$version")"

  for term in $constraints; do
    if [[ "$term" =~ ^(>=|<=|>|<|=)?([0-9]+([.][0-9]+){0,3})$ ]]; then
      op="${BASH_REMATCH[1]:-=}"
      want="${BASH_REMATCH[2]}"
      wkey="$(version_key "$want")"
      case "$op" in
        '=') [[ "$vkey" == "$wkey" ]] || return 1 ;;
        '>=') [[ "$vkey" > "$wkey" || "$vkey" == "$wkey" ]] || return 1 ;;
        '<=') [[ "$vkey" < "$wkey" || "$vkey" == "$wkey" ]] || return 1 ;;
        '>') [[ "$vkey" > "$wkey" ]] || return 1 ;;
        '<') [[ "$vkey" < "$wkey" ]] || return 1 ;;
        *) return 1 ;;
      esac
    else
      note_fail "unsupported version constraint token: $term"
      return 1
    fi
  done

  return 0
}

brew_version() {
  local formula="$1"
  if command -v brew >/dev/null 2>&1; then
    brew list --versions "$formula" 2>/dev/null | awk 'NF >= 2 {print $2; exit}'
  fi
}

cmd_version() {
  local tool="$1"
  local out version

  case "$tool" in
    nono)
      command -v nono >/dev/null 2>&1 || return 10
      nono --version 2>/dev/null | first_semver
      ;;
    bondage)
      version="$(brew_version agent-bondage || true)"
      if [[ -n "$version" ]]; then printf '%s\n' "$version"; return 0; fi
      command -v bondage >/dev/null 2>&1 || return 10
      out="$(bondage --version 2>/dev/null || true)"
      printf '%s\n' "$out" | first_semver
      ;;
    envchain-xtra)
      version="$(brew_version envchain-xtra || true)"
      if [[ -n "$version" ]]; then printf '%s\n' "$version"; return 0; fi
      command -v envchain >/dev/null 2>&1 || return 10
      out="$(envchain --version 2>/dev/null || true)"
      printf '%s\n' "$out" | first_semver
      ;;
    node)
      command -v node >/dev/null 2>&1 || return 10
      node --version 2>/dev/null | first_semver
      ;;
    codex)
      command -v codex >/dev/null 2>&1 || return 10
      codex --version 2>/dev/null | first_semver
      ;;
    claude-code)
      command -v claude >/dev/null 2>&1 || return 10
      claude --version 2>/dev/null | first_semver
      ;;
    opencode)
      command -v opencode >/dev/null 2>&1 || return 10
      opencode --version 2>/dev/null | first_semver
      ;;
    *)
      note_fail "unknown tool in AGENT_STACK_CHECK_TOOLS: $tool"
      return 11
      ;;
  esac
}

requirement_for_tool() {
  case "$1" in
    nono) printf '%s\n' "${AGENT_STACK_REQUIRE_NONO:-}" ;;
    bondage) printf '%s\n' "${AGENT_STACK_REQUIRE_BONDAGE:-}" ;;
    envchain-xtra) printf '%s\n' "${AGENT_STACK_REQUIRE_ENVCHAIN_XTRA:-}" ;;
    node) printf '%s\n' "${AGENT_STACK_REQUIRE_NODE:-}" ;;
    codex) printf '%s\n' "${AGENT_STACK_REQUIRE_CODEX:-}" ;;
    claude-code) printf '%s\n' "${AGENT_STACK_REQUIRE_CLAUDE_CODE:-}" ;;
    opencode) printf '%s\n' "${AGENT_STACK_REQUIRE_OPENCODE:-}" ;;
    *) printf '\n' ;;
  esac
}

check_tool() {
  local tool="$1"
  local req version
  req="$(requirement_for_tool "$tool")"
  [[ -z "$req" ]] && return 0

  if ! version="$(cmd_version "$tool")" || [[ -z "$version" ]]; then
    note_fail "$tool required $req but version could not be determined"
    return 0
  fi

  if version_satisfies "$version" "$req"; then
    msg "ok: $tool $version satisfies $req"
  else
    note_fail "$tool $version does not satisfy $req"
  fi
}

check_nono_packs() {
  local specs="${AGENT_STACK_REQUIRE_NONO_PACKS:-}"
  local spec pack want line have
  [[ -z "$specs" ]] && return 0

  if ! command -v nono >/dev/null 2>&1; then
    note_fail "nono packs required but nono is not installed"
    return 0
  fi

  for spec in $specs; do
    case "$spec" in
      *=*) pack="${spec%%=*}"; want="${spec#*=}" ;;
      *@*) pack="${spec%@*}"; want="${spec#*@}" ;;
      *) note_fail "bad nono pack requirement '$spec' (use pack=version)"; continue ;;
    esac
    line="$(nono list --installed 2>/dev/null | awk -v p="$pack" '$1 == p {print; exit}')"
    if [[ -z "$line" ]]; then
      note_fail "nono pack $pack required at $want but is not installed"
      continue
    fi
    have="$(awk '{print $2}' <<<"$line")"
    if [[ "$have" == "$want" ]]; then
      msg "ok: nono pack $pack $have"
    else
      note_fail "nono pack $pack $have does not match required $want"
    fi
  done
}

for tool in $AGENT_STACK_CHECK_TOOLS; do
  check_tool "$tool"
done
check_nono_packs

if (( failures )); then
  if [[ "$mode" == "strict" ]]; then
    exit 1
  fi
  note_warn "$failures compatibility issue(s); continuing because mode is --warn"
fi

if (( failures == 0 )); then
  msg "version-check: ok"
fi
