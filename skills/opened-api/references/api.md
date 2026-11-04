# Loom API reference

All paths below are relative to the `/api` prefix. `opened_api` is defined in the skill's
`SKILL.md`. The deployed `/api/schema/openapi.json` is the authority for request and response
details; look up the relevant path and follow its schema references before a mutation.

## Permissions and route families

For these protected routes, `GET` and `HEAD` require the named `:read` permission and other methods
require `:write`. Read and write are independent. `/auth/me` specifically requires
`identity:read`. A key cannot exceed its owner's current role or access someone else's owned resources.

| Paths | Permission prefix | Typical work |
| --- | --- | --- |
| `/roadmaps` | `roadmaps` | List, read, revise, delete, or mark topic progress. |
| `/materials` | `materials` | List, read, revise, delete, download Markdown, or inspect citation evidence. |
| `/material-generations` | `generations` | Create, read, cancel, or stream material-generation requests. |
| `/roadmap-mentor/conversations` | `roadmap_mentor` | Work with roadmap conversations, messages, builds, edits, and tasks. |
| `/mentor/chat` | `mentor` | Read a conversation or artifact, submit and retry streamed turns, or clear a conversation. |
| `/examinator` | `examinator` | Work with interviews, exam sessions, and attempt history. |
| `/notifications` | `notifications` | List notifications, count unread items, and mark them read. |
| `/profile` | `profile` | Update the owner's profile. |

Session login, refresh, logout, and registration are not API-key operations. A separate Bifrost
virtual key is needed for inference.

## Common operations

```sh
opened_api '/auth/me'                         # requires identity:read
opened_api '/roadmaps'                        # requires roadmaps:read
opened_api "/roadmaps/$roadmap_id"            # read before editing
opened_api '/materials'                       # requires materials:read
opened_api "/materials/$material_id/markdown"  # Markdown, not JSON
```

Set resource IDs from user input or a prior response. To update progress with `roadmaps:write`:

```sh
opened_api "/roadmaps/$roadmap_id/topics/$topic_id/progress" \
  --request PUT --header 'Content-Type: application/json' --data-binary '{"state":"done"}'
```

The progress states are `not_started`, `in_progress`, and `done`. For full roadmap or material
edits, first read the current object, retain its `revision`, and construct the complete save body
according to `RoadmapSave` or `MaterialSave`. Material documents use the structured
`MaterialDocument` schema, not an arbitrary Markdown string. On a revision conflict, fetch the
latest version and reconcile the requested change; don't overwrite concurrent edits blindly.

## Generation and asynchronous work

`POST /material-generations` and `POST /material-generations/with-sources` require an
`Idempotency-Key` header containing a client-generated UUID. Use a new UUID for a new intent;
reuse the same UUID only to retry the same request. Follow the `GenerationCreate` schema for
`origin`, topic, goal, and language; do not invent omitted values. The result contains a request
`id`, not necessarily a finished material. Read `/material-generations/{id}` or stream
`/material-generations/{id}/events`; the terminal states are `succeeded`, `failed`, and
`cancelled`. A successful result exposes `material_id` when the material is available.

For sources, use the multipart endpoint with repeated `files` parts and the request fields from
`UploadRequest`. The current implementation accepts 1–5 files, each at most 10,000,000 bytes,
with `.txt`, `.md`, `.pdf`, or `.docx` extensions. This endpoint does not accept image files.
Upload only files the user intended to send.

To list only active generations, call `/material-generations?active=true&origin=library` or use
`origin=topic`; this is not a history endpoint. Roadmap Mentor submissions may return `202` and a
task ID: inspect that task or its events instead of treating acceptance as completion. Mentor
turns and several event endpoints use server-sent events. Other operations also require an
`Idempotency-Key`; check the deployed contract for the specific route and reuse a key only for a
retry of the same intent and payload.
