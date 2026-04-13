# Hermes repo rules

## Default coding path
- For any coding, debugging, refactoring, feature request, milestone work, or project implementation task, always use the `gsd2-autocode` workflow first.
- GSD is the default implementation engine in this repository.
- Preferred provider/model for GSD work: MiniMax-M2.7.
- Do not switch away from MiniMax unless it is unavailable or failing.

## Execution rule
- Route all coding tasks through: `~/.hermes/bin/gsd2-autocode.sh "<full request>" "$(pwd)"`
- Do not stop at planning.
- Continue through implementation and verification automatically.
- Only stop if GSD finishes or reaches a real blocker.

## GSD interface note
This repo uses `gsd --print` (single-shot natural language) for headless reliability. The `gsd auto` milestone workflow requires interactive discuss/plan phases and is not used for ad-hoc tasks.

## Completion standard
- "Done" means code changes were attempted, verification was run, and blockers are clearly stated.
- Always report: files changed, commands run, tests/lint run, GSD progress, blockers if any.

## Fallback
- Only fall back to native Hermes coding if GSD is unavailable or fails twice.
