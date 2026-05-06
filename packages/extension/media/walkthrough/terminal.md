# Claude CLI terminal

Opens an integrated zsh terminal in the bottom panel with `claude` auto-launched.

Useful flows:

- **Slash commands** declared in `workspace.yaml` are routed through Claude directly
- **Run a pipeline unattended** — `aidlc run exec <runId> --auto-approve`
- **Doctor check** — `aidlc doctor` verifies the `claude` binary, auth, and workspace schema

The CLI and the extension share state through `.aidlc/runs/*.json`, so changes show up live in the sidebar.

> Requires the `claude` binary on `PATH` and a valid Anthropic auth setup.
