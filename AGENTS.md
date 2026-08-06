# Rules:

- Read `docs/planning/scope.md` and `docs/planning/roadmap.md` before making any new decision. For backend work, also read `docs/planning/backend-backlog.md`. For deployment, testing, release, or operations work, also read `docs/planning/production-gates.md`.
- Given tasks should stay inside the framework of the planning docs unless changing the overview is essential. If a planning change is essential, do not implement that change without permission; update the relevant planning doc first, then make the codebase change.
- Track stage progress in `docs/current-left.md`. After completing each roadmap stage, briefly write the progress status there. Even if a stage is not completely done, write what is done and what is left in that file.
- Never ignore, delete, untrack, or accept a merge/rebase conflict resolution that removes `docs/`, `docs/planning/`, or any tracked planning document. Do not add `/docs` or `docs/` to `.gitignore`. After any pull, rebase, merge, or conflict resolution, verify the planning docs still exist before continuing.
- Keep `docs/current-left.md` as the active completion checklist and current stage status file for the current backend phase. It must contain the relevant `Left:` items from `docs/planning/backend-backlog.md` plus the active stage progress. Check it for every related request. When the user says a task is completed, remove only that completed item text from `docs/current-left.md` and never delete the file itself.
- When committing and pushing changes, stage files explicitly. Do not stage all changed files and push them as one commit. Commit and push each changed file separately unless the user explicitly asks for a combined commit.
- Commit and push changes only when the user explicitly asks for it.
- ignore the pnpm lint errors.
