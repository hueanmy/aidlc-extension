# Build your own workspace

Three building blocks, edited from the Builder or the command palette:

| | What it is | How to add |
|---|---|---|
| **Skill** | A markdown prompt that defines *how* an agent does a task | `AIDLC: Add Skill` — template / paste / upload / blank |
| **Agent** | A skill bound to a model (Sonnet / Opus / Haiku) | `AIDLC: Add Agent` |
| **Pipeline** | An ordered chain of agents with on-failure behavior | `AIDLC: Add Pipeline` |

When the workspace shape is what you want, save it as a reusable preset:

- **Save Workspace as Template** — names the current `workspace.yaml` and stores it in your global preset store
- **Load Template** — applies a saved preset (or a built-in: `code-review`, `release-notes`, `sdlc`) to any folder

> Built-in presets ship with the extension — try `AIDLC: Load Template` to see them.
