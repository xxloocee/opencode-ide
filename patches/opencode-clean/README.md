# OpenCode Clean Patches

This directory is reserved for source-level clean-build patches that are easier
to review as diffs than as JavaScript text rewrites.

Keep stable JSON/package rewrites in `tools/sanitize/apply.mjs`. Put fragile
workbench or service-boundary edits here when they need VSCodium-style replay
and conflict reporting.
