# Git Hooks

This directory contains git hooks that run automatically before commits and pushes.

## Setup

Run once after cloning the repo:

```bash
bun install
```

This triggers the guarded `prepare` script, which sets the local `core.hooksPath` to `.git-hooks/` and makes both hooks executable in a maintainer checkout. Packed installations without their own Git metadata/hooks are skipped, so a consumer's repository configuration is not modified. Real setup errors fail explicitly rather than being silently ignored.

If you skipped `bun install`, activate manually:

```bash
git config core.hooksPath .git-hooks
```

## Hooks

| Hook         | Runs                                                | Blocks commit on failure |
| ------------ | --------------------------------------------------- | ------------------------ |
| `pre-commit` | `bun run lint`, `bun run test`, `bun run typecheck` | Yes (if any fails)       |
| `pre-push`   | `bun run typecheck`                                 | Blocks push on failure   |

## Troubleshooting

**Hook not running:** Verify the hooks path is set:

```bash
git config core.hooksPath
```

Should output `.git-hooks`. If not, re-run `bun install` or the manual command above.

**Permission denied (macOS/Linux):** Make the hook executable:

```bash
chmod +x .git-hooks/pre-commit .git-hooks/pre-push
```

**Skipping hooks (emergency only):**

```bash
git commit --no-verify -m "message"
```
