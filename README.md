# Opened Loom agent skills

Two portable agent skills work with a Loom account through its API:

- `opened-api` carries out requests within the API key's permissions.
- `opened-init` sets up or migrates the key without putting it in the agent conversation.

## Install

From the project where the agent will run, install both skills and choose your agent when prompted:

```sh
npx skills add https://gitlab.tfcp.ru/opened/loom-skill.git --skill opened-api opened-init
```

To select agents non-interactively, add for example `--agent codex claude-code opencode --yes`.
Use `--agent '*' --yes --copy` to install for every project-level agent supported by `npx skills`;
without `--copy`, the installer may skip agents whose project directories do not yet exist. Add
`--global` for agents that support user-level installation. The internal GitLab repository requires
Git credentials with read access; the `.git` suffix tells `npx skills` to treat its address as a
Git repository.

DSH is not an `npx skills` agent selector in version 1.7.6. Its filesystem skill provider can use
the shared project `.agents/skills` directory; install for an agent that uses this directory, such
as `codex`, and enable DSH's skill provider and UI. Agent-specific configuration can change these
locations.

## Set up the key

Use the `opened-init` skill. The way to invoke a skill depends on the agent: for example,
`/opened-init` in Claude Code or DSH, `$opened-init` in Codex, or select the skill in your agent.
You can also ask the agent to set up the Loom key using `opened-init`. Slash-command registration
is not part of `npx skills`; OpenCode users who specifically want `/opened-init` can
register the bundled command in their project:

```sh
mkdir -p .opencode/commands
cp -n .agents/skills/opened-api/commands/opened-init.md .opencode/commands/opened-init.md
```

The command is copied without replacing an existing file. The agent starts a temporary local
browser form; enter the key there, not in the chat or as a command argument. The agent must be able
to run local commands, and the form requires Node.js and a browser that can reach its loopback
interface. When the agent runs remotely, the form and key are on the remote machine; use a secure
tunnel rather than exposing the form publicly. File mode `600` is a POSIX permission. The helper
refuses to run on native Windows because it cannot guarantee equivalent ACLs; use it from WSL.

The key is shared by harnesses on the same machine and account at
`$XDG_CONFIG_HOME/opened/loom-api-key` when `XDG_CONFIG_HOME` is absolute. If it is empty, unset,
or relative, the key is stored at `~/.config/opened/loom-api-key`. To migrate a key from an
existing private file, ask the agent to use the `opened-init` migration with that file path, or run:

```sh
node .agents/skills/opened-init/scripts/opened-init.mjs --migrate /path/to/existing/key
```

Adjust the skill and source paths as needed. Migration refuses to overwrite a new key and retains
the old file. Once it is no longer needed, remove the old file yourself if desired.

Set `OPENED_BASE_URL` to the Loom service origin, without `/api`, or provide that address to the
agent. The API skill uses a POSIX shell and `curl` to send requests without exposing the key in
command arguments or output. API-key management and administrative operations are outside the
skill's scope; restrict the API key's permissions when enforcing access boundaries.

## Verify

```sh
node --test skills/opened-api/tests/opened-init.test.mjs
```
