---
name: opened-init
description: Use when setting up, replacing, or migrating an Opened Loom API key for an agent.
compatibility: Requires local command execution, Node.js, a browser that can reach the agent's loopback interface, and POSIX file permissions.
---

# Set up an Opened Loom API key

Run `node <this-skill-directory>/scripts/opened-init.mjs` and give the user the returned temporary
`http://127.0.0.1` link. The user enters the key in the browser, outside the agent conversation.
Never ask for the key in chat or as a command argument, and never read the key file into a tool
result. The form closes after saving, cancellation, or ten minutes. Saving replaces the current key.

The helper saves the key with mode `600` at `$XDG_CONFIG_HOME/opened/loom-api-key` when
`XDG_CONFIG_HOME` is absolute, or `$HOME/.config/opened/loom-api-key` otherwise.
If the agent runs on a different machine, the form and file are on that machine; arrange access to
its loopback interface without exposing it publicly. Report startup errors without asking the user
to reveal the key. Native Windows cannot guarantee these POSIX permissions; use WSL there.

## Migrate an existing key

When restoring access to an existing key and the new key is missing, check for a previous key at
`${XGD_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}}/edharness/opened_key`. If it exists, run
`node <this-skill-directory>/scripts/opened-init.mjs --migrate` instead of opening a new form.
The helper copies a private legacy key to the new location without printing it, refuses to overwrite
an existing new key, and leaves the legacy file in place. Report a migration error without printing
the key or attempting to bypass its file permissions. When the user explicitly wants to replace a
key, use the browser form instead.
