# Development Notes

Initial scope:
- ship sanitized templates only
- keep generated configs private
- preserve existing local files by default
- support ignored `local/` overlays for maintainers
- add an installer later that renders local paths and fingerprints
- keep local model wrappers optional

First generator target:
- read `profile.env`
- resolve tool paths
- render `bondage.conf.template`
- install `nono` profiles
- install optional ds4 profile wrappers
- run `audit.sh`
