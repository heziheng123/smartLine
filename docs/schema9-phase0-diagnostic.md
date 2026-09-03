# Schema 9 phase 0: read-only entry diagnostic

Schema 9 writers, rooms, account bindings, migrations, and R2 operation
archives are intentionally absent from this phase. The only deliverable is a
deterministic preflight report that answers whether a schema 8 workspace may
create a **test-only** v9 room in a later, separately accepted phase.

## Current evidence

- Schema 8 is the current workspace schema and remains the only writer.
- Schema 8 repair, alternate history, and field-level queue confirmation are
  already present; this phase does not read, mutate, or clean any of them.
- The real Liveblocks transport test is not configured in this workspace, so
  the preflight must block until that evidence is supplied.
- No v9 IndexedDB stores, operation endpoint, entity room, or account-binding
  switch is created by this phase.

## Preflight blockers

The report blocks a test-room request when any of these is true:

1. The source backup is not schema 8.
2. The existing read-only workspace audit has blockers.
3. Schema 8 integrity issues, active conflicts, or a pending queue remain.
4. Real two-browser Liveblocks transport evidence is not confirmed.

The report contains only hashes, counts, IDs, and blocker codes; it does not
log user content. A `ready` result is permission to begin the next **test-room
implementation phase**, not permission to migrate users or switch bindings.
