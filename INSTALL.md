# Install

This repo installs public templates and creates private local config. It does
not publish or sync machine-specific paths, fingerprints, hosts, or tokens.

## Quick Start

```bash
git clone https://github.com/nvk/agent-stack-bootstrap.git
cd agent-stack-bootstrap
./install.sh
echo 'source "$HOME/.config/agent-stack/shell.zsh"' >> ~/.zshrc
```

Open a new shell, then check:

```bash
type claude-ds4
type codex-ds4
type pi-ds4
```

## Configure

The installer creates `profile.env` on first run. Edit it before or after
installation:

```bash
\$EDITOR profile.env
./install.sh
```

Important variables:

- `AGENT_WORKSPACE`: default repo/worktree root.
- `AGENT_PROFILE_ROOT`: where optional profile wrappers are installed.
- `AGENT_NONO_PROFILE_ROOT`: where `nono` profiles are installed.
- `AGENT_DS4_BASE_URL`: local ds4 server URL.
- `AGENT_DS4_MODEL`: local ds4 model slug.
- `AGENT_PI_DS4_CONTEXT_WINDOW`: Pi ds4 client window. Default: `16384`.
- `AGENT_PI_DS4_MAX_TOKENS`: Pi ds4 response cap. Default: `2048`.
- `AGENT_REMOTE_SSH_HOST`: optional remote accelerator host.

## Existing Local Setups

The installer is conservative by default. If a destination file already exists
and differs from the public template, it is preserved and reported instead of
being overwritten.

To intentionally refresh managed files:

```bash
AGENT_STACK_OVERWRITE=1 ./install.sh
```

Overwrite mode backs up changed files under:

```text
$AGENT_STATE_HOME/backups/
```

Private machine-specific support belongs in `local/`, which is ignored by git.
Supported overlay files:

- `local/profile.env`: private variables loaded after `profile.env`.
- `local/shell.zsh`: private aliases sourced after the public shell snippet.
- `local/nono/*.json`: private `nono` profiles.
- `local/profiles/`: private profile trees copied under `AGENT_PROFILE_ROOT`.
- `local/bondage.conf`: private bondage config staged as `bondage.conf.local`.

This lets maintainers keep working local profiles while publishing only the
generic setup.

## What Gets Installed

`./install.sh` creates:

- `$HOME/.config/agent-stack/profile.env`
- `$HOME/.config/agent-stack/shell.zsh`
- `$HOME/.config/agent-stack/bondage.conf.template`
- `$HOME/.config/nono/profiles/custom-coding-agent.json`
- `$HOME/.config/nono/profiles/custom-pi-ds4.json`
- `$HOME/.agent-profiles/.claude-profiles/ds4`
- `$HOME/.agent-profiles/.codex-profiles/ds4`
- `$HOME/.agent-profiles/.pi-profiles/ds4`
- `$HOME/.local/state/agent-stack/pi-ds4/models.json`
- `$HOME/.local/share/agent-stack/pi/extensions/ds4-tools.ts`

The exact paths can be changed in `profile.env`.

## Bondage

`bondage` requires literal local paths and pinned fingerprints. The installer
therefore stages `bondage.conf.template`, but does not install it as a live
`~/.config/bondage/bondage.conf`.

Render and pin that file locally once the target tools are installed. Do not
commit the rendered file.

## Local ds4

The ds4 wrappers assume a local OpenAI/Anthropic-compatible ds4 server is
running at `AGENT_DS4_BASE_URL`, defaulting to:

```text
http://127.0.0.1:8000
```

The wrappers expose:

- `claude-ds4`, alias `cds4`
- `codex-ds4`, alias `xds4`
- `pi-ds4`
- `pi-ds4-rawdog`, alias `pi-ds4-direct`, for benchmark runs without `nono`
- `pi-ds4-bench` for a quick non-interactive smoke test

## Safety Check

Before publishing changes, run:

```bash
bash audit.sh
```
