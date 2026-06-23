# Git Hooks

This directory contains git hooks that run automatically before commits.

## Setup

Run once after cloning the repo:

```bash
bun install
```

This triggers the `prepare` script in `package.json`, which sets `core.hooksPath` to `.git-hooks/`.

If you skipped `bun install`, activate manually:

```bash
git config core.hooksPath .git-hooks
```

## Hooks

| Hook         | Runs                                                | Blocks commit on failure |
|--------------|-----------------------------------------------------|--------------------------|
| `pre-commit` | `bun run lint`, `bun run test`, `bun run typecheck` | Yes (if any fails)       |

## Troubleshooting

**Hook not running:** Verify the hooks path is set:

```bash
git config core.hooksPath
```

Should output `.git-hooks`. If not, re-run `bun install` or the manual command above.

**Permission denied (macOS/Linux):** Make the hook executable:

```bash
chmod +x .git-hooks/pre-commit
```

**Skipping hooks (emergency only):**

```bash
git commit --no-verify -m "message"
```
