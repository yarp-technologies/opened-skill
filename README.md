# Opened Loom API skill

An agent skill for working with a Loom account through its API. It respects the permissions of a
Loom API key and includes a local form for entering that key without putting it in the chat.

## Install

From the project where the agent will run:

```sh
npx skills add https://gitlab.tfcp.ru/opened/loom-skill.git --skill opened-api --agent opencode --yes
```

The GitLab repository is internal; Git must have credentials with read access. Use the `.git`
suffix with `npx skills` so the self-hosted GitLab address is treated as a Git repository.

To register `/opened-init` in OpenCode or EdHarness for this project, also run:

```sh
mkdir -p .opencode/commands
cp -n .agents/skills/opened-api/commands/opened-init.md .opencode/commands/opened-init.md
```

The second step is needed because `npx skills` installs skills, not slash-command files. The
command is copied without replacing an existing file. Run `/opened-init` without arguments and
enter the key only in the local browser form it provides. Alternatively, ask the agent to use the
`opened-api` skill to set up the key; it can start the same form without the slash command.

Set `OPENED_BASE_URL` to the Loom service origin, without `/api`, or provide that address to the
agent. The skill describes the key location, permissions, and API usage.

## Verify

```sh
node --test skills/opened-api/tests/opened-init.test.mjs
```
