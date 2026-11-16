# Troubleshooting

## The bridge is not mounted

The default directory is `~/JMCAI/workflow-lab-agent-bridge`. On Web, open “算力中心 → 存储系统 → 挂载目录” and authorize the same directory. On desktop, choose it in the storage settings. The app must show the bridge as ready. A directory that exists only on the CLI side is not enough.

## WSL and Windows

The CLI and JMCAI must see the same files. If the app runs on Windows while the CLI runs in WSL, use a shared Windows directory and pass the exact path with `--bridge-dir`, or mount the appropriate `\\wsl$` path in the app. Do not assume `~` means the same home directory across both environments.

## Job stays queued

`queued` with a `queuedReason` is expected when:

- Workflow Lab is open;
- a dirty/deployed-preset draft exists.

Close the lab or resolve the draft, then run `verify <jobId>`. The app polls the queue and resumes automatically. `E_TIMEOUT` with no app-side queue reason usually means the app is not running, the bridge is not mounted, or the app version does not include the Agent bridge.

## Existing Agent preset was changed

`E_AGENT_PRESET_MODIFIED` means the user or another process changed an Agent-owned preset. Do not overwrite it. Ask whether to keep it and create a forked copy, then rerun `prepare --fork`.

## Version compatibility

The Skill bundles a snapshot of the JMCAI Agent contract/compiler. An older app without the bridge cannot install any workflow. If the app was updated with a newer contract, update the Skill runtime with `scripts/sync-core-runtime.mjs` and reinstall the Skill.
