# Security boundary

`pulse` is a `trusted-worker` plugin. Orca’s HTML panel cannot inspect project files,
so a Node worker is needed. This profile runs with the user account’s access; it is not a
read-only filesystem sandbox. The restrictions below are implemented by this plugin’s code.

The manifest requests only:

- `workspace:read`: list workspaces and read the focused workspace’s name, branch, and terminal IDs.
- `agent:read`: read focused agent status and observe agent work locations to match project roots and step branches.
  An event identifies focus only through a terminal ID present in the focused context.
  Events for other terminals cannot establish or change focus. Agent state,
  output, prompts, and messages are not used to complete steps.

The worker reads:

1. `workspace.list`, `workspace.readContext` and `agents.list` from Orca’s documented host API.
   Focused agent status is matched to context terminal IDs; other activity is mapped from event workspace IDs.
   Activity supplies indicators, never plan completion.
2. Filesystem metadata for local workspace roots and `.git` entries. A `.git` file’s text
   identifies a standard `<main>/.git/worktrees/<name>` directory; metadata verifies that
   directory and the main root. For `doneWhen.gitTag`, the same safe reader reads the named
   `.git/refs/tags/<name>` and `.git/packed-refs`. It checks `.git/reftable` metadata and reads
   the local `.git/config` only to detect unsupported reference storage. Config text is never
   returned or logged; includes and external backend paths are not followed. Objects, commits,
   credential APIs and unrelated files are not accessed.
3. Directory names in `<main-project-root>/plans/` and contents of its regular `*.plan.json`
   files. Other extensions are ignored. Plan errors are isolated into individual error rows.
4. Metadata only for the project-relative `doneWhen.file` path and its ancestors. It does
   not read the evidence file’s contents. A directory is not file evidence.

5. The `orca` command line tool that ships inside the Orca app, with fixed arguments:
   `terminal list --json`, `orchestration run-list --limit 50 --json --full`,
   `orchestration task-list --run <id> --json`, `orchestration worker-list --run <id> --limit 100 --json --full`
   and `automations list --json`. Run ids come from Orca's own `run-list` answer. From these answers
   the worker keeps titles, states, counts, terminal handles, folder paths and schedule times.
   Prompts, task specifications, task results and terminal output are not kept, shown or logged.
6. Optionally `~/.config/orca-pulse/resources.json`. If the user created it, the worker runs the
   command it names every 30 seconds and reads three values from its output. Without the file
   nothing is run.

The worker acts in one way only: when the user clicks a row that leads to a chat, it runs
`orca terminal switch --terminal <handle>`, and only for a handle the panel was showing
in its last answer. It never sends text to a terminal, starts an agent, or changes an orchestration,
an automation, a file or a setting.

The panel loads the plugin’s own modules and bundled JSON translation catalogs. Every text that
comes from a plan file or from Orca (titles, objectives, names, handles) is escaped before
insertion into the DOM; no such content becomes code. The worker keeps in memory only: temporary
pane-to-terminal/workspace mappings, the last successful-read time, at most 2,048 parsed plan
files, and the last answer of each read above. Non-focused activity states expire after 30
minutes or workspace disappearance. Cached plan files still pass path, permission,
modification-time and identity checks; evidence metadata is evaluated anew on every snapshot.
Neither surface writes files, stores preferences, accesses secrets or uses the network. Every
process it starts has a 2 second timeout and a 4 MB output limit.

Remote workspace paths are not interpreted on the local machine. The worker rejects
traversal, absolute evidence paths, Windows drive/backslash paths, and symlinks in project or
evidence paths. It checks each path component with `lstat`, verifies canonical paths, and opens
plan and `.git` files with `O_NOFOLLOW`. Missing files remain open; unsafe/unreadable evidence
remains to verify. Unknown completion rules are data only, never executable or interpreted as
filesystem paths.

These checks protect ordinary plan reads; they are not an OS sandbox against a malicious
process changing parent directories between checks. A trusted worker must be installed only
from code you trust and used in local checkouts you trust.

To report a security problem, open an issue on this repository without the exploit details and
ask for a private channel.
