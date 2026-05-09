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

By default, `./install.sh` installs all optional public profile groups. To
choose only specific groups:

```bash
./install.sh --profiles frontier
./install.sh --profiles spark
./install.sh --profiles ds4,pi-ds4
./install.sh --profiles none
```

Open a new shell, then check:

```bash
type claude-safe
type codex-safe
type opencode-safe
type pi-safe
type frontier-safe-verify
type claude-spark
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
- `AGENT_STACK_PROFILES`: optional profile groups. Default: `all`. Supported:
  `all`, `none`, `frontier`, `spark`, `ds4`, `pi-ds4`.
- `AGENT_PROFILE_ROOT`: where optional profile wrappers are installed.
- `AGENT_NONO_PROFILE_ROOT`: where `nono` profiles are installed.
- `AGENT_DS4_BASE_URL`: local ds4 server URL.
- `AGENT_DS4_MODEL`: local ds4 model slug.
- `AGENT_PI_DS4_CONTEXT_WINDOW`: Pi ds4 client window. Default: `16384`.
- `AGENT_PI_DS4_MAX_TOKENS`: Pi ds4 response cap. Default: `2048`.
- `AGENT_SPARK_HOST`: optional remote Spark host.
- `AGENT_SPARK_USER`: optional remote Spark SSH user.
- `AGENT_SPARK_MODEL`: remote Ollama model. Default: `qwen3-coder:30b`.
- `AGENT_SPARK_GATEWAY_PORT`: local Anthropic gateway port. Default: `4143`.

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

With the default `--profiles all`, `./install.sh` creates:

- `$HOME/.config/agent-stack/profile.env`
- `$HOME/.config/agent-stack/shell.zsh`
- `$HOME/.config/agent-stack/bondage.conf.template`
- `$HOME/.config/nono/profiles/custom-coding-agent.json`
- `$HOME/.config/nono/profiles/custom-claude.json`
- `$HOME/.config/nono/profiles/custom-codex.json`
- `$HOME/.config/nono/profiles/custom-opencode.json`
- `$HOME/.config/nono/profiles/custom-pi.json`
- `$HOME/.config/nono/profiles/custom-pi-ds4.json`
- `$HOME/.agent-profiles/.frontier-profiles`
- `$HOME/.agent-profiles/.claude-profiles/spark`
- `$HOME/.agent-profiles/.claude-profiles/ds4`
- `$HOME/.agent-profiles/.codex-profiles/ds4`
- `$HOME/.agent-profiles/.pi-profiles/ds4`
- `$HOME/.local/state/agent-stack/pi-ds4/models.json`
- `$HOME/.local/share/agent-stack/pi/extensions/ds4-tools.ts`

The exact paths can be changed in `profile.env`.

## Frontier Clients

The frontier profile group gives you explicit safe launchers for cloud-backed
coding agents without replacing the raw commands on your PATH.

The wrappers expose:

- `claude-safe`
- `codex-safe`
- `opencode-safe`
- `pi-safe`
- `frontier-safe-verify`

After rendering and pinning `~/.config/bondage/bondage.conf`, the safe aliases
run the matching `bondage` profile. If you later want the raw command names,
alias them yourself after verifying the generated config.

## Spark

The Spark profile assumes a private Ollama server reachable through SSH
tunnels. Configure the remote placeholders in `profile.env` or in
`profiles/spark/local.env` after installation.

The wrappers expose:

- `claude-spark`, alias `cspark`
- `spark-ssh`
- `spark-dashboard`
- `spark-ollama`
- `spark-tunnels`

`claude-spark` starts a local Anthropic-format gateway in front of the tunneled
Ollama endpoint and then runs Claude Code against `AGENT_SPARK_MODEL`.

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
