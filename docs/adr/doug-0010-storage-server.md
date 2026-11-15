# doug-0010: a storage server this server hands out, a bucket and key per workspace

Status: accepted. This instance's own.

## Context

A workspace's files (the Drive, uploads, skills' files, voice recordings) stay on this server's storage, under
`orgs/{orgId}/`, unless the workspace brings a bucket of its own (ADR 0019: Settings › Storage, "Your own storage").
This server's disk has a rule of its own: it never goes past half full. What doesn't fit goes to a storage machine with
a large disk, beside it.

Bringing that machine to the Drive through "Your own storage" would mean, for every workspace, making a bucket and a
key on it by hand and pasting them into the form. And a key shared by several workspaces would let each read the
others' files.

## Decision

1. **The storage machine runs an S3 server, Garage**, behind HTTPS: its S3 API open to all, its admin API on its own
   port, which the firewall opens to this server alone.
2. **This server offers it**, when `STORAGE_HOST_ENDPOINT`, `STORAGE_HOST_ADMIN_URL` and `STORAGE_HOST_ADMIN_TOKEN` are
   set (`StorageHost` in `packages/adapters/src/storage-host.ts`, Garage's admin API v2; `STORAGE_HOST_NAME` is what
   people read). Settings › Storage shows it as a third option, between this server's storage and "Your own storage".
3. **Switching it on is one click** (`PUT …/storage` `{ kind: "provided" }`, `provideStorage` in
   `packages/engine/src/storage.ts`). The first time, the server makes the workspace's bucket there (`ws-{orgId}`) and
   a key allowed to read and write that bucket alone, never to own it; checks it as any bucket is checked (write, read,
   list, delete); and switches it on. The key is sealed like any bucket's (`storage_configs`, `options.provided`), and
   the app never sees it, not even as a hint. Switched off and on again, the same bucket and key come back.
4. **The machine's address is the operator's.** A row of the storage server reads the address and region from the
   server's settings at each use, so moving the machine to another name touches no workspace.
5. Everything else is a workspace's own bucket's: old files read from where they were written, "Copy existing files"
   moves them, "Switch back" returns new files to this server, and the storage limit counts this server's storage
   only.

## Consequences

- Each workspace's files are apart twice over: in a bucket of their own, and behind a key that opens no other.
- No admin types an endpoint or a key for it.
- A deleted workspace's bucket stays on the storage machine, as any bucket a workspace brought does (ADR 0088):
  emptying it is the operator's.
- A copy to the storage server leaves the old copies on this server's disk, as every copy between storages does.
