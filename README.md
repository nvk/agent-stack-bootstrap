# Agent Stack Bootstrap

Bootstrap templates for a local coding-agent stack.

Read the broader guide at [learntoprompt.org](https://learntoprompt.org/guides/agent-stack.html).

This repo is template-first by design: public files describe the shape of the
setup, while machine-specific paths, fingerprints, project names, hosts, and
account details are generated or kept in untracked local files.

The installer is intentionally conservative: existing destination files are
preserved unless `AGENT_STACK_OVERWRITE=1` is set. Private local support files
can live under ignored `local/` overlays.

## Boundary

Public templates may include:
- generic profile names such as `claude`, `codex`, `pi`, `pi-ds4`, and `ds4`
- generic local endpoints such as `127.0.0.1`
- placeholder fingerprints such as `sha256:replace-me`
- placeholder envchain namespaces such as `openai`, `anthropic`, `gemini`, and `xai`
- default example roots such as `$HOME/agent-workspace`

Public templates must not include:
- real absolute user paths
- cloud-drive or local workspace names
- LAN IP addresses, hostnames, serial numbers, or SSH usernames
- real envchain namespace names if they identify accounts or projects
- trusted project lists from a workstation
- package fingerprints from a private machine
- Git identity, emails, API keys, tokens, or org-specific repo names

## Files

- `INSTALL.md`: clone and local install flow.
- `install.sh`: copies templates into local config/profile directories.
- `profile.env.sample`: variables a future installer can ask for or infer.
- `bondage.conf.template`: launcher profile matrix with placeholder values.
- `nono/*.json`: generic sandbox profiles that use `$HOME/agent-workspace`.
- `profiles/ds4-claude`: Claude Code wrapper for a local ds4 server.
- `profiles/ds4-codex`: Codex wrapper plus model catalog for a local ds4 server.
- `audit.sh`: a small public-surface leak check.
- `local/`: ignored private overlay location for maintainers.

## Install Shape

For the current bootstrap:

```bash
git clone https://github.com/nvk/agent-stack-bootstrap.git
cd agent-stack-bootstrap
./install.sh
echo 'source "$HOME/.config/agent-stack/shell.zsh"' >> ~/.zshrc
```

See `INSTALL.md` for the full local setup flow.

## Generator Shape

The eventual installer should:

1. Copy `profile.env.sample` to an untracked local env file.
2. Ask for local roots and optional remote accelerator settings.
3. Resolve exact tool paths with `command -v` or package-manager metadata.
4. Run `bondage repin` or equivalent verification locally.
5. Render `bondage.conf.template` into the user's private
   `~/.config/bondage/bondage.conf`.
6. Install `nono` profiles into `~/.config/nono/profiles`.
7. Install optional ds4 profile wrappers under a local profile root.

Generated configs are private artifacts. Do not commit them back into this repo.

## Local-Only Files

When importing from an existing private setup, treat live machine config as
private input, not source material to publish:

- real `bondage.conf`
- Claude or Codex settings with trusted-project paths
- Git sandbox config with identity
- local notes, host inventory, and private profile overlays

Before publishing a distribution, run:

```bash
bash audit.sh
```

## License

MIT. See `LICENSE`.

This project is provided as-is, without warranty. Review generated local config
before running agents against real repositories or private data.
