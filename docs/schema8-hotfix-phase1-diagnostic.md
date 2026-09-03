# Schema 8 hotfix phase 1: read-only diagnosis

Date: 2026-09-03

Scope: mutation-origin isolation, complete pre-repair snapshots, a persistent
`timeline.blocks` RepairPlan, non-blocking three-way merge, alternate history,
and exact queue acknowledgement. This phase does not change account bindings,
delete conflict records, delete schema 8 rooms, or add schema 9 writers.

## Current data flow

1. Store actions use `createWorkspaceTrackedSet`; external hydration and
   convergence use raw store setters plus queue-suppression counters.
2. A coalesced schema 8 queue stores field values and base snapshots in
   `workspace_sync_queue` and keeps an emergency localStorage mirror.
3. `flushWorkspaceQueueInternal` reads the Liveblocks root, performs a
   three-way merge, and either writes every merged field or persists one active
   conflict and stops the whole queue.
4. Entity sidecar writes are generated alongside top-level field writes.

## Gate failures found

- Mutation origin is implicit. The system/user decision ultimately depends on
  process-global counters that remain set across asynchronous connection and
  restore flows. Queue APIs accept no origin and cannot reject a system write.
- `timeline.blocks` validation detects missing/duplicate IDs but has no
  persistent, source-hashed RepairPlan. Normalization may therefore run before
  a recoverable repair decision exists.
- Local snapshots cover workspace data only. They do not atomically manifest
  the pending queue, emergency queue, conflict records, raw remote root, and
  entity sidecar with individual SHA-256 hashes.
- A true leaf conflict returns the local value, records an active conflict,
  clears the pending queue, and blocks unrelated safe paths.
- Resolved conflict records are capped at 50 even when they are the only local
  recovery copy.
- Queue acknowledgement checks submitted values and queue revision, but has no
  required proof that alternates were persisted before cloud confirmation and
  dequeue.
- The ordinary sync dialog still exposes manual local/cloud conflict choices.

## Phase-1 implementation boundary

- Add an explicit origin to every queue attempt; only `user` and explicit
  `restore` may enqueue. Keep the old counters only as a compatibility guard.
- Add pure read-only integrity reporting and a complete hashed repair bundle.
- Persist the RepairPlan before applying it. Different duplicate objects stay
  current under distinct IDs; identical extra copies move intact to repair
  history. Retry reuses assignments for the same `sourceHash`.
- Make merge conflicts resolve to the freshly read remote value while safe
  paths continue into the submitted field. Persist full base/local/remote
  alternates before the Liveblocks batch.
- Dequeue only after synchronized storage, exact remote readback hash,
  queue-version equality, and readable alternate recovery IDs.
- Do not delete or cap schema 8 recovery history in this phase. Manual restore
  remains an advanced recovery action, not a blocking sync decision.

## Stop conditions

Any snapshot/hash write failure, source-hash drift, invalid RepairPlan,
alternate persistence/readback failure, cloud readback mismatch, or queue
revision drift stops the affected write and retains the queue. A
`timeline.blocks` repair failure must not block unrelated schema 8 fields.
