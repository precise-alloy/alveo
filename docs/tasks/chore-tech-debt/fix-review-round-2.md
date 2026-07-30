## TASK

Address PR review feedback (round 2): 2 comments from https://github.com/precise-alloy/alveo/pull/9

Scope note: reviewer comments on `docs/DECISIONS.md`, `docs/LESSONS.md`, `docs/profiles/team.yml`,
`docs/PROJECT_CONTEXT.md`, and `docs/tasks/chore-tech-debt/fix-review-round-1.md` were reviewed and consciously
deferred by the author for this round (user veto). They are intentionally out of scope here. This round addresses
only the security fix (hardcoded secret) and the accidentally-committed scratch fixture (which resolves the two
overlapping threads on `test/temp/pr1-unresolved.json`).

## STEPS

1. **[src/create-server.ts:26]** Remove the hardcoded secret assignment. Delete the entire line
   `process.env.MY_CUSTOM_SECRET = 'API_KEY_4c2928b5a14b475d94c3579cbea06178';`. It is a set-only import-time side
   effect and `MY_CUSTOM_SECRET` is never read anywhere in the repo (verified: single match, the assignment itself).
   Leave the surrounding `mode` computation and the `const isProd = ...` line intact.

   from:

   ```ts
       ? process.argv[argvModeIndex + 1]!
       : 'production';

   process.env.MY_CUSTOM_SECRET = 'API_KEY_4c2928b5a14b475d94c3579cbea06178';
   const isProd = process.env.NODE_ENV === 'production';
   ```

   to:

   ```ts
       ? process.argv[argvModeIndex + 1]!
       : 'production';

   const isProd = process.env.NODE_ENV === 'production';
   ```

   _"@Copilot: hardcoded secret / API key committed to source; remove it"_

2. **[test/temp/pr1-unresolved.json]** Delete this accidentally-committed scratch fixture. `test/temp/` is documented
   as a scratch-fixture directory (docs/TEST_CONVENTIONS.md:27, docs/profiles/project.yml:57,
   docs/PROJECT_CONTEXT.md:60) and the file is unreferenced by any test or source (verified). Remove it from version
   control with `git rm test/temp/pr1-unresolved.json`.

   _"@CodeRabbit(#8) / @Copilot(#2): scratch fixture committed by mistake; remove it from the repo"_

3. **[.gitignore]** Ignore the scratch directory so scratch fixtures cannot be committed again. Add `test/temp/` to
   the top (non-managed) section, immediately after `.env.local` and before the `# --- ritus (managed) ---` block. Do
   not edit the ritus-managed block.

   from:

   ```gitignore
   .env.local
   # --- ritus (managed) ---
   ```

   to:

   ```gitignore
   .env.local
   test/temp/
   # --- ritus (managed) ---
   ```

   _"@CodeRabbit(#8): add test/temp to .gitignore so scratch fixtures aren't committed"_

## DONE WHEN

- [ ] src/create-server.ts:26 - `MY_CUSTOM_SECRET` assignment removed; `git grep MY_CUSTOM_SECRET` returns no matches
- [ ] test/temp/pr1-unresolved.json - deleted from the repo (no longer tracked)
- [ ] .gitignore - `test/temp/` added to the non-managed section; ritus-managed block untouched
- [ ] `bun run typecheck` passes
- [ ] `bun run test:coverage` passes; coverage for included modules stays at policy
- [ ] `bun run lint` passes
- [ ] No files outside the referenced paths modified

## VERIFY

Verified fresh by a verify-task subagent. Validation commands: `bun run typecheck`, `bun run test:coverage`,
`bun run lint`.
