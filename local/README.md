# Local Overlay

This directory is for private machine-specific support files. Everything here
is ignored by git except this README and sample files.

Supported overlay files:

- `profile.env`: private install variables loaded after `profile.env`.
- `shell.zsh`: private shell aliases sourced after the public shell snippet.
- `nono/*.json`: private `nono` profiles copied into the configured profile root.
- `profiles/`: private profile trees copied under `AGENT_PROFILE_ROOT`.
- `bondage.conf`: private rendered or hand-maintained bondage config staged as
  `bondage.conf.local`.

Use overlays for personal hostnames, LAN addresses, exact workspace paths,
private model aliases, and already-working local profiles. Do not move those
values into public templates.

By default the installer preserves existing destination files if they differ.
To update managed files intentionally:

```bash
AGENT_STACK_OVERWRITE=1 ./install.sh
```
