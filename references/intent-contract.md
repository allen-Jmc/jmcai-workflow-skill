# Intent Contract Quick Reference

The generated intent is `JMCAI_WORKFLOW_INTENT_V1`:

```json
{
  "type": "JMCAI_WORKFLOW_INTENT_V1",
  "jobId": "safe-file-name",
  "sourceHash": "64 lowercase hex characters",
  "workflow": {},
  "preset": {
    "name": "Preset name",
    "mode": "txt",
    "category": "generate"
  },
  "core": {},
  "controls": [],
  "outputNodeIds": []
}
```

- `sourceHash` is `SHA-256(canonicalStringify(workflow))`; do not compute it with ad-hoc JSON serialization.
- `preset.mode` is `txt` or `img`. `plugin` is rejected.
- `preset.category` is `generate` or `edit`.
- `core` keys are `promptNode`, `negativePromptNode`, `seedNode`, `widthNode`, `heightNode`, `batchSizeNode`, `imageInputNode1`, and `maskInputNode`.
- Every mapping is `{ "nodeId": "...", "fieldPath": "inputs...." }` and must point to an existing scalar field.
- `controls` entries contain a real `nodeId` and `inputs.*` scalar field path. Optional fields include `id`, `label`, `group`, `preferredType`, `min`, `max`, `step`, and `options`.
- `outputNodeIds` is optional. When omitted, the app compiles valid output nodes from the workflow.

The app recomputes the source hash, scans the workflow and metadata for secrets/local references, validates fields and types, compiles the preset, runs the preset validator and dry-run, then saves through its shared settings boundary. A failed job never produces a partial preset.

Use the `validate`, `compile`, and `install` commands from the Skill. Do not construct a separate full `AppSettings` object or write into the bridge by hand.
