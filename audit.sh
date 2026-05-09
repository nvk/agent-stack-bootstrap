#!/usr/bin/env bash
set -euo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

if [[ ! -d "$root" ]]; then
  echo "audit: not a directory: $root" >&2
  exit 2
fi

patterns=(
  '/Users/[A-Za-z0-9._-]+'
  'Mobile Documents'
  'com~apple~CloudDocs'
  'claude-sandbox'
  'geo-prospects'
  '10\.10\.10\.[0-9]+'
  'spark-[A-Za-z0-9_-]+\.local'
  'DGX'
  'SERIAL'
  'openai-oc'
  'openai-geo'
  'gemini-a'
  'xai-n'
  'anthropic-a'
  'ahrefs'
  'git@[^[:space:]]+'
  'github\.com/nvk'
  'nvk/'
)

status=0
for pattern in "${patterns[@]}"; do
  matches="$(
    rg --hidden --line-number \
      --glob '!.git/**' \
      --glob '!audit.sh' \
      --glob '!*.log' \
      --glob '!responses-shim.log' \
      "$pattern" "$root" |
      grep -vF 'github.com/nvk/agent-stack-bootstrap.git' || true
  )"
  if [[ -n "$matches" ]]; then
    printf '%s\n' "$matches"
    status=1
  fi
done

if (( status )); then
  echo "audit: possible private profile data found under $root" >&2
  exit 1
fi

echo "audit: no private profile patterns found under $root"
