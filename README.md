# Pulse

A sidebar panel for [Orca](https://github.com/stablyai/orca) that answers one question about the
project you are looking at: **what is happening here, and how far along is it?**

Pulse reads what Orca already knows. It needs no setup, no file format of its own and no
particular way of working.

## What it shows

For the focused project, from top to bottom. A section with nothing in it is not shown.

- **Orchestrations.** Each Orca orchestration run coordinated from this project: tasks done of
  total, and under it the tasks that matter now (in progress, blocked, failed, queued). Finished
  tasks fold into one row. A task with a live agent opens that agent's chat on click.
- **Chats.** One row per agent chat: working, waiting for you, blocked or idle, and for how long.
  Whoever waits for you comes first. A click opens the chat.
- **Automations.** Each scheduled automation that runs in this project: the outcome of its last
  run and when it runs next.
- **Plan** (optional). If the project keeps a `plans/<id>.plan.json` file, its phases and steps
  with their progress. See [Written plans](#written-plans).

Amber marks only what waits for a person. Green marks only what is done. The panel follows the
project you focus in Orca and updates by itself. It is available in English and Italian.

## Install

In Orca: Settings → Plugins → Install plugin → Git URL, and paste this repository's URL. Or:

```sh
orca plugin install matteoeusebi/orca-pulse
```

Orca asks you to approve the plugin before it starts: Pulse runs a small background worker that
calls the `orca` command line tool. [SECURITY.md](SECURITY.md) lists exactly what it reads and runs.
Requires Orca 1.4.257 or later.

## Limits

- Progress (done of total) exists only where something records steps: an Orca orchestration or a
  written plan. For a plain chat Pulse shows its state, not its progress.
- An orchestration is shown while the chat that coordinates it is open. A finished one disappears
  after 12 hours.
- Agents in a workspace other than the focused one are known from the status changes Orca reported
  since the plugin started.
- Only local workspaces are read.
- Orchestrations, automations and the jump into a chat use the `orca` command line tool inside the
  Orca app. Pulse finds it on macOS; elsewhere set the `ORCA_CLI` environment variable to its path.
  Chats and written plans work everywhere. Built and tested on macOS.

## Written plans

A plan is a JSON file in the project's `plans/` folder, described by
[schema/plan.v1.json](schema/plan.v1.json). A step is done when its `doneWhen` rule holds:
a file exists (`file`), a Git tag exists (`gitTag`), an approval is dated (`approval`), or it was
marked by hand (`manual`). A step may name the branch its work happens on (`work.branch`); the
agents on that branch are then shown on the step. Pulse never writes to a plan.

## Machine load (optional)

If `~/.config/orca-pulse/resources.json` exists and holds `{ "command": ["program", "arg", …] }`,
Pulse runs that command every 30 seconds and shows a footer when it prints
`{ "light": "green" | "yellow" | "red", "used": 2, "max": 4 }`. Without the file there is no footer.

## Develop

```sh
orca plugin validate .
orca plugin test .
orca plugin dev load .
```

No build step: Orca loads the TypeScript in `src/` directly.

## License

MIT
