---
description: Set up the Loom API key in a local browser; never pass the key as an argument
---

Use the `opened-api` skill. Start `node <skill-directory>/scripts/opened-init.mjs` and give the
user the returned local URL. Ask them to enter their Loom API key on that page, never in chat or
in a command argument. Do not read the key file or its contents into the conversation. The form
reports success directly to the user and closes after saving; it expires after ten minutes. If the
helper cannot start, report the error without asking the user to reveal the key.
