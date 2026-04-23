---
name: publish
description: Bump version, update CHANGELOG, package the VSIX, publish to Open VSX and VS Code Marketplace, then commit and tag. Invoke via /publish [patch|minor|major] — default patch.
---

# /publish — release this extension to Open VSX + VS Code Marketplace

End-to-end release flow for this VSCode extension. Every step is mandatory; stop and report if any step fails — do NOT continue past a failure.

## 0. Parse args

- Argument may be `patch`, `minor`, or `major`. Default: `patch`.
- Reject anything else with a short error.

## 1. Preflight

Run these checks in parallel and abort on any failure:

- `git rev-parse --abbrev-ref HEAD` — must be `main`.
- `git status --porcelain` — must be empty (clean working tree). If dirty, stop and list the dirty files; do not stash.
- `test -n "$OVSX_PAT"` (via `printenv OVSX_PAT | head -c 4`) — must be non-empty. If missing, stop with:
  > `OVSX_PAT` not set. Create a token at https://open-vsx.org/user-settings/tokens then `export OVSX_PAT=<token>` and retry.
- `test -n "$VSCE_PAT"` (via `printenv VSCE_PAT | head -c 4`) — must be non-empty. If missing, stop with:
  > `VSCE_PAT` not set. Create an Azure DevOps PAT (scope: Marketplace → Manage, org: All accessible) at https://dev.azure.com → User settings → Personal access tokens, then `export VSCE_PAT=<token>` and retry.
- Read current `version` from [package.json](../../../package.json).

## 2. Compute new version

Semver bump based on arg:
- patch: `x.y.z` → `x.y.(z+1)`
- minor: `x.y.z` → `x.(y+1).0`
- major: `x.y.z` → `(x+1).0.0`

State the old → new version in one line before proceeding.

## 3. Collect release notes

Get commits since the last tag:

```
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  git log "$LAST_TAG"..HEAD --pretty=format:'- %s'
else
  git log --pretty=format:'- %s'
fi
```

Filter the output:
- Drop `Merge ...`, `Bump version ...`, `Release v...`, and any line matching the auto-generated commit from step 7.
- Keep the rest verbatim as bullet points.

If the list is empty, stop and report: "No commits since `$LAST_TAG` — nothing to release."

## 4. Update package.json + package-lock.json

Use npm to bump both files atomically without creating a git tag (we tag ourselves later):

```
npm version <patch|minor|major> --no-git-tag-version
```

Verify the new version in [package.json](../../../package.json) matches what you computed in step 2.

## 5. Update CHANGELOG.md

Prepend a new section to [CHANGELOG.md](../../../CHANGELOG.md) directly under the `# Changelog` heading. Format:

```
## <new-version>

<bullets from step 3>
```

Leave a blank line between the new section and the previous one. Preserve all existing content.

## 6. Build + package

Run sequentially — stop on first failure:

1. `npm run compile`
2. `npx -y @vscode/vsce package` — produces `aidlc-<new-version>.vsix` in the repo root.

Verify the `.vsix` file exists before moving on.

## 7. Commit + tag

```
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release v<new-version>"
git tag "v<new-version>"
```

Do NOT amend. Do NOT use `--no-verify`.

## 8. Publish to Open VSX

```
npx -y ovsx publish aidlc-<new-version>.vsix -p "$OVSX_PAT"
```

If this fails, the commit and tag already exist locally — report the failure clearly and tell the user:
> Local commit + tag `v<new-version>` created, but Open VSX publish failed. Fix the error, then retry with `npx -y ovsx publish aidlc-<new-version>.vsix -p "$OVSX_PAT"`. Do NOT re-run /publish.

## 8b. Publish to VS Code Marketplace

```
npx -y @vscode/vsce publish --packagePath aidlc-<new-version>.vsix -p "$VSCE_PAT"
```

If this fails, Open VSX already succeeded and the commit/tag exist locally — report the failure and tell the user:
> Open VSX published + local tag `v<new-version>` created, but VS Code Marketplace publish failed. Fix the error (usually a stale/invalid `VSCE_PAT`), then retry with `npx -y @vscode/vsce publish --packagePath aidlc-<new-version>.vsix -p "$VSCE_PAT"`. Do NOT re-run /publish.

## 9. Push

```
git push origin main
git push origin "v<new-version>"
```

## 10. Final report

One concise block:
- New version
- Open VSX: https://open-vsx.org/extension/hueanmy/aidlc
- VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=hueanmy.aidlc
- VSIX filename
- Commit SHA + tag

## Safety rules

- Never skip a failed step. Never retry a failed publish automatically — surface the error and let the user decide.
- Never run `git push --force`, `git reset --hard`, or delete tags without explicit user instruction.
- Never commit the `.vsix` file (it's gitignored — confirm by checking `.gitignore` has `*.vsix`).
- If the preflight clean-tree check fails, do NOT offer to stash or commit the dirty files; just report them.
