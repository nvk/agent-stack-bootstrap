# Agent Instructions

This repo bootstraps a local coding-agent stack. Treat it as a public template
repo, not as a capture of one maintainer's workstation.

## Mental Model

The repo has two layers:

- Public templates: tracked files that are safe to share.
- Local overlays: ignored files under `local/` and generated files under the
  user's config/state directories.

Public templates should help people install and understand the stack. Local
overlays keep a maintainer's existing machine working without publishing private
paths, hosts, tokens, package hashes, or project names.

## Do Not Commit

Do not add any of these to tracked files:

- real absolute home-directory paths
- cloud-drive workspace names
- LAN IP addresses, hostnames, SSH usernames, or device serial numbers
- API keys, tokens, auth files, shell history, or key material
- rendered `bondage.conf` files with real paths or fingerprints
- trusted-project lists from Claude, Codex, or other agents
- unrelated private org or repo names
- private `local/` overlay payloads
- logs, caches, sessions, or generated runtime state

If a user needs local machine details, put them in ignored overlay files such as
`local/profile.env`, `local/shell.zsh`, `local/nono/*.json`, or
`local/profiles/`.

## Install Behavior

`install.sh` must be conservative:

- preserve changed destination files by default
- require `AGENT_STACK_OVERWRITE=1` to replace existing files
- back up replaced files under `$AGENT_STATE_HOME/backups/`
- stage `bondage.conf.template`, but do not install it as a live
  `~/.config/bondage/bondage.conf`
- keep private machine settings out of public templates

When changing install behavior, verify both first install and reinstall cases.

## Expected Commands

Common setup commands:

```bash
./install.sh
echo 'source "$HOME/.config/agent-stack/shell.zsh"' >> ~/.zshrc
```

Common profile checks:

```bash
type claude-spark
type claude-ds4
type codex-ds4
type pi-ds4
```

## Verification

Before finishing changes, run:

```bash
bash -n install.sh
bash -n audit.sh
bash -n profiles/spark/claude-spark
python3 -c 'from pathlib import Path; [compile(Path(p).read_text(), p, "exec") for p in ("profiles/spark/anthropic_ollama_gateway.py", "profiles/ds4-codex/openai_responses_to_ds4.py")]'
bash -n profiles/ds4-claude/claude-ds4
bash -n profiles/ds4-codex/codex-ds4
jq . nono/custom-coding-agent.json >/dev/null
jq . nono/custom-pi-ds4.json >/dev/null
jq . profiles/spark/settings.json >/dev/null
jq . profiles/ds4-claude/settings.json >/dev/null
jq . profiles/ds4-codex/model_catalog.json >/dev/null
/opt/homebrew/bin/node --check pi/extensions/ds4-tools.ts 2>/dev/null || node --check pi/extensions/ds4-tools.ts
bash audit.sh
git diff --check
```

For installer changes, also run a temp-root install so real local config is not
touched:

```bash
rm -rf /tmp/agent-stack-install-test
mkdir -p /tmp/agent-stack-install-test
AGENT_STACK_PROFILE_ENV=/tmp/agent-stack-install-test/profile.env \
AGENT_CONFIG_HOME=/tmp/agent-stack-install-test/config \
AGENT_STACK_HOME=/tmp/agent-stack-install-test/share \
AGENT_STATE_HOME=/tmp/agent-stack-install-test/state \
AGENT_CACHE_HOME=/tmp/agent-stack-install-test/cache \
AGENT_WORKSPACE=/tmp/agent-stack-install-test/workspace \
AGENT_PROFILE_ROOT=/tmp/agent-stack-install-test/profiles \
AGENT_NONO_PROFILE_ROOT=/tmp/agent-stack-install-test/nono \
AGENT_GITCONFIG_SANDBOX=/tmp/agent-stack-install-test/config/gitconfig-sandbox \
./install.sh
```

Then verify:

```bash
zsh -lc 'source /tmp/agent-stack-install-test/config/shell.zsh; whence -w claude-spark cspark spark-ssh spark-tunnels claude-ds4 codex-ds4 pi-ds4 cds4 xds4'
```

## Editing Guidance

Prefer small, explicit changes. Keep install docs synchronized with
`install.sh`. If a change introduces a new configurable path, host, model, or
port, add it to `profile.env.sample` and document it in `INSTALL.md`.

If a request involves supporting one maintainer's existing local setup, solve it
through the ignored `local/` overlay model unless the public template itself is
missing a general capability.
