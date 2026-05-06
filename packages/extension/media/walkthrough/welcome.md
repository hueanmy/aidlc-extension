# What is AIDLC?

A single `workspace.yaml` declares your **agents**, **skills**, and **pipelines** — AIDLC turns it into a runnable workflow you drive from VS Code or the terminal.

```
.aidlc/
├── workspace.yaml      # agents · skills · pipelines · sidebar layout
├── skills/             # markdown prompts for each skill
├── epics/              # work items bound to a pipeline
└── runs/               # state of every run, watched live
```

Both the extension and the `aidlc` CLI read and write the same files — switch between them mid-run.

---

This walkthrough takes ~2 minutes:

1. **Load the demo** — full pipeline + 6 sample epics, no YAML to write
2. **Open the Builder** — visual editor for the workspace
3. **Run an epic** — watch Claude work through the pipeline
4. **Open the Claude terminal** — drive runs from the CLI
5. **Build your own** — scaffold, add agents, save as a template

> Already know AIDLC? Skip ahead — each step has a button that runs the right command.
