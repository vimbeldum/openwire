# Hermes repo rules

## Default coding path
- For any coding, debugging, refactoring, feature request, milestone work, or project implementation task, always use the `gsd2-autocode` workflow first.
- GSD is the default implementation engine in this repository.
- Preferred execution model for GSD work remains MiniMax-M2.7 unless a phase-specific fallback is triggered.

## Execution rule
- Route all coding tasks through: `~/.hermes/bin/gsd2-autocode.sh "<full request>" "$(pwd)"`
- Allow long-running autonomous coding jobs up to 6 hours.
- Do not stop at planning.
- Continue through implementation and verification automatically.
- Only stop if GSD finishes or reaches a real blocker.
- For GPT-heavy GSD phases, use this fallback order: `openai-codex/gpt-5.4` → `openrouter/qwen/qwen3.5-plus-02-15` → `minimax/MiniMax-M2.7`.
- For status reporting, use the wrapper log/status artifacts rather than short blocking shell timeouts: `~/.hermes/logs/gsd2-autocode.log` and `~/.hermes/logs/gsd2-autocode.status`.

## GSD interface note
- This repo uses `gsd --print` (single-shot natural language) for headless reliability on ad-hoc natural-language coding requests.
- For real headless auto-mode from a natural-language request or specification, bootstrap milestone state first with: `gsd headless new-milestone --context-text "<request>" --auto`
- Do not pass raw natural-language requests directly to `gsd auto "<request>"` in this install. Here, that path is routed through headless `/gsd ...` command handling and treats the natural-language request as an unknown `/gsd` command.
- The `gsd auto` milestone workflow is for running the existing workflow state machine after milestone/bootstrap state exists; it is not the reliable entrypoint here for raw ad-hoc natural-language requests.

## Completion standard
- "Done" means code changes were attempted, verification was run, and blockers are clearly stated.
- Always report: files changed, commands run, tests/lint run, GSD progress, blockers if any.

## Fallback
- Do not fall back to native Hermes coding automatically.
- If GSD is unavailable, fails to start, or fails during execution, stop and tell the user exactly that GSD did not run or did not complete.
- Then ask whether Hermes should try to fix the GSD issue.
- Do not proceed via an alternate implementation path unless the user explicitly approves that change in approach.
- Do not bypass the wrapper by invoking `gsd` directly, using a full binary path, or substituting a different execution method unless the user explicitly approves that change.
- Do not kill processes, clean up zombie or duplicate GSD instances, restart in background mode, change execution mode, or retry with a different wrapper/binary invocation unless the user explicitly approves Hermes fixing the GSD issue.
- Treat PATH problems, wrapper recursion/looping, duplicate GSD processes, stale background jobs, and direct-binary retries as GSD execution issues to report first, not actions to take automatically.
