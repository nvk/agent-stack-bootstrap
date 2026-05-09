#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${AGENT_STACK_PROFILE_ENV:-$repo_root/profile.env}"
local_dir="${AGENT_STACK_LOCAL_DIR:-$repo_root/local}"
overwrite="${AGENT_STACK_OVERWRITE:-0}"
installed_count=0
preserved_count=0
backup_dir=""

backup_file() {
  local path="$1"
  local rel

  if [[ ! -e "$path" ]]; then
    return 0
  fi

  if [[ -z "$backup_dir" ]]; then
    backup_dir="${AGENT_STATE_HOME:-$HOME/.local/state/agent-stack}/backups/$(date +%Y%m%d-%H%M%S)"
  fi

  rel="${path#/}"
  mkdir -p "$backup_dir/${rel%/*}"
  cp -p "$path" "$backup_dir/$rel"
}

install_file() {
  local src="$1"
  local dst="$2"
  local mode="${3:-}"

  mkdir -p "$(dirname "$dst")"

  if [[ -f "$dst" ]]; then
    if cmp -s "$src" "$dst"; then
      return 0
    fi

    if [[ "$overwrite" != "1" ]]; then
      echo "preserved existing file: $dst"
      preserved_count=$((preserved_count + 1))
      return 0
    fi

    backup_file "$dst"
  fi

  cp -p "$src" "$dst"
  if [[ -n "$mode" ]]; then
    chmod "$mode" "$dst"
  fi
  installed_count=$((installed_count + 1))
}

install_tree() {
  local src_dir="$1"
  local dst_dir="$2"
  local rel
  local src

  [[ -d "$src_dir" ]] || return 0
  while IFS= read -r -d '' src; do
    rel="${src#$src_dir/}"
    install_file "$src" "$dst_dir/$rel"
  done < <(find "$src_dir" -type f -print0)
}

if [[ ! -f "$env_file" ]]; then
  mkdir -p "$(dirname "$env_file")"
  cp "$repo_root/profile.env.sample" "$env_file"
  echo "created private env file: $env_file"
fi

set -a
# shellcheck source=/dev/null
source "$env_file"
if [[ -r "$local_dir/profile.env" ]]; then
  # shellcheck source=/dev/null
  source "$local_dir/profile.env"
fi
set +a

AGENT_CONFIG_HOME="${AGENT_CONFIG_HOME:-$HOME/.config/agent-stack}"
AGENT_STACK_HOME="${AGENT_STACK_HOME:-$HOME/.local/share/agent-stack}"
AGENT_STATE_HOME="${AGENT_STATE_HOME:-$HOME/.local/state/agent-stack}"
AGENT_CACHE_HOME="${AGENT_CACHE_HOME:-$HOME/.cache/agent-stack}"
AGENT_WORKSPACE="${AGENT_WORKSPACE:-$HOME/agent-workspace}"
AGENT_PROFILE_ROOT="${AGENT_PROFILE_ROOT:-$HOME/.agent-profiles}"
AGENT_NONO_PROFILE_ROOT="${AGENT_NONO_PROFILE_ROOT:-$HOME/.config/nono/profiles}"
AGENT_GITCONFIG_SANDBOX="${AGENT_GITCONFIG_SANDBOX:-$AGENT_CONFIG_HOME/gitconfig-sandbox}"
AGENT_DS4_BASE_URL="${AGENT_DS4_BASE_URL:-http://127.0.0.1:8000}"
AGENT_DS4_MODEL="${AGENT_DS4_MODEL:-deepseek-v4-flash}"
AGENT_PI_DS4_CONTEXT_WINDOW="${AGENT_PI_DS4_CONTEXT_WINDOW:-16384}"
AGENT_PI_DS4_MAX_TOKENS="${AGENT_PI_DS4_MAX_TOKENS:-2048}"

mkdir -p \
  "$AGENT_CONFIG_HOME" \
  "$AGENT_STATE_HOME" \
  "$AGENT_CACHE_HOME" \
  "$AGENT_WORKSPACE" \
  "$AGENT_STACK_HOME/pi/extensions" \
  "$AGENT_PROFILE_ROOT/.claude-profiles/ds4" \
  "$AGENT_PROFILE_ROOT/.codex-profiles/ds4" \
  "$AGENT_PROFILE_ROOT/.pi-profiles/ds4" \
  "$AGENT_NONO_PROFILE_ROOT" \
  "$(dirname "$AGENT_GITCONFIG_SANDBOX")"

install_file "$env_file" "$AGENT_CONFIG_HOME/profile.env"
for nono_profile in "$repo_root"/nono/*.json; do
  install_file "$nono_profile" "$AGENT_NONO_PROFILE_ROOT/${nono_profile##*/}"
done
install_tree "$repo_root/profiles/ds4-claude" "$AGENT_PROFILE_ROOT/.claude-profiles/ds4"
install_tree "$repo_root/profiles/ds4-codex" "$AGENT_PROFILE_ROOT/.codex-profiles/ds4"
install_tree "$repo_root/profiles/pi-ds4" "$AGENT_PROFILE_ROOT/.pi-profiles/ds4"
install_tree "$repo_root/pi" "$AGENT_STACK_HOME/pi"
install_file "$repo_root/bondage.conf.template" "$AGENT_CONFIG_HOME/bondage.conf.template"

ds4_openai_base="${AGENT_DS4_BASE_URL%/}"
if [[ "$ds4_openai_base" != */v1 ]]; then
  ds4_openai_base="$ds4_openai_base/v1"
fi

tmp_pi_ds4_models="$(mktemp)"
cat >"$tmp_pi_ds4_models" <<EOF
{
  "providers": {
    "ds4": {
      "baseUrl": "$ds4_openai_base",
      "apiKey": "local-ds4",
      "api": "openai-completions",
      "models": [
        {
          "id": "$AGENT_DS4_MODEL",
          "name": "DeepSeek V4 Flash (ds4)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": ${AGENT_PI_DS4_CONTEXT_WINDOW:-16384},
          "maxTokens": ${AGENT_PI_DS4_MAX_TOKENS:-2048},
          "compat": {
            "supportsStore": false,
            "supportsDeveloperRole": false,
            "supportsReasoningEffort": false,
            "supportsUsageInStreaming": false,
            "maxTokensField": "max_tokens",
            "supportsStrictMode": false
          }
        }
      ]
    }
  }
}
EOF
install_file "$tmp_pi_ds4_models" "$AGENT_STATE_HOME/pi-ds4/models.json"
rm -f "$tmp_pi_ds4_models"

if [[ -d "$local_dir" ]]; then
  install_tree "$local_dir/nono" "$AGENT_NONO_PROFILE_ROOT"
  install_tree "$local_dir/profiles" "$AGENT_PROFILE_ROOT"
  if [[ -r "$local_dir/shell.zsh" ]]; then
    install_file "$local_dir/shell.zsh" "$AGENT_CONFIG_HOME/local.zsh"
  fi
  if [[ -r "$local_dir/bondage.conf" ]]; then
    install_file "$local_dir/bondage.conf" "$AGENT_CONFIG_HOME/bondage.conf.local"
  fi
fi

if [[ ! -f "$AGENT_GITCONFIG_SANDBOX" ]]; then
  github_ssh_rewrite='git''@github.com:'
  tmp_gitconfig="$(mktemp)"
  cat >"$tmp_gitconfig" <<EOF
[url "https://github.com/"]
    insteadOf = $github_ssh_rewrite

[credential]
    helper =
    helper = !gh auth git-credential
EOF
  install_file "$tmp_gitconfig" "$AGENT_GITCONFIG_SANDBOX"
  rm -f "$tmp_gitconfig"
fi

tmp_shell="$(mktemp)"
cat >"$tmp_shell" <<EOF
# Agent Stack Bootstrap shell entry points.
# Source this from ~/.zshrc after running install.sh.

export AI_WORKSPACE="\${AI_WORKSPACE:-$AGENT_WORKSPACE}"
export AGENT_PROFILE_ROOT="\${AGENT_PROFILE_ROOT:-$AGENT_PROFILE_ROOT}"
export WIKI_SKILL="\${WIKI_SKILL:-\$AI_WORKSPACE/llm-wiki/plugins/llm-wiki-opencode/skills/wiki-manager/SKILL.md}"

for _agent_profile_aliases in \\
  "\$AGENT_PROFILE_ROOT/.claude-profiles/ds4/aliases.zsh" \\
  "\$AGENT_PROFILE_ROOT/.codex-profiles/ds4/aliases.zsh" \\
  "\$AGENT_PROFILE_ROOT/.pi-profiles/ds4/aliases.zsh"; do
  if [[ -r "\$_agent_profile_aliases" ]]; then
    source "\$_agent_profile_aliases"
  fi
done
unset _agent_profile_aliases

if [[ -r "$AGENT_CONFIG_HOME/local.zsh" ]]; then
  source "$AGENT_CONFIG_HOME/local.zsh"
fi
EOF
install_file "$tmp_shell" "$AGENT_CONFIG_HOME/shell.zsh"
rm -f "$tmp_shell"

bash "$repo_root/audit.sh" "$repo_root" >/dev/null

cat <<EOF
installed agent-stack-bootstrap

Installed files:
  env:              $AGENT_CONFIG_HOME/profile.env
  shell snippet:    $AGENT_CONFIG_HOME/shell.zsh
  nono profiles:    $AGENT_NONO_PROFILE_ROOT
  Claude ds4:       $AGENT_PROFILE_ROOT/.claude-profiles/ds4
  Codex ds4:        $AGENT_PROFILE_ROOT/.codex-profiles/ds4
  Pi ds4:           $AGENT_PROFILE_ROOT/.pi-profiles/ds4
  Pi ds4 metadata:  $AGENT_STATE_HOME/pi-ds4/models.json
  Pi ds4 extension: $AGENT_STACK_HOME/pi/extensions/ds4-tools.ts
  bondage template: $AGENT_CONFIG_HOME/bondage.conf.template

Install policy:
  installed/updated: $installed_count
  preserved:         $preserved_count
  overwrite mode:    $overwrite

Next step:
  echo 'source "$AGENT_CONFIG_HOME/shell.zsh"' >> ~/.zshrc

Then open a new shell and test:
  type claude-ds4
  type codex-ds4
  type pi-ds4

Bondage config is staged as a template only. Render and pin it locally before
using bondage-backed profiles.
EOF

if [[ -n "$backup_dir" ]]; then
  echo "backups: $backup_dir"
fi
