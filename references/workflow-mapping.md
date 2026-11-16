# Workflow Mapping Rules

## Input format

Accept only ComfyUI API-format JSON: a top-level object whose values are nodes with `class_type` and `inputs`. Reject UI-format files with top-level `nodes` and `links`. Do not try to convert UI workflows in v1.

## Analyze the active graph

1. Build directed edges from each `[nodeId, outputIndex]` input link.
2. Find the primary sampler candidate and follow its `positive`, `negative`, `latent_image`, and seed-related links upstream.
3. Treat wrapper/conditioning/reference nodes as intermediate nodes; map a field only when it is a real scalar at a real node path.
4. Prefer nodes reachable from the primary sampler over unrelated nodes elsewhere in the file.
5. When two candidates have comparable confidence, report both. Do not pick one silently.

For advanced sampling graphs:

- Treat `SamplerCustomAdvanced` as the execution sampler and input-only nodes such as `KSamplerSelect` as sampler configuration, not as another primary sampler.
- Follow `guider` to `CFGGuider.positive` / `negative` when the execution sampler has no direct conditioning inputs.
- Prefer a unique scalar prompt primitive when conditional paths also pass through preview nodes or TextGenerate helpers.
- For IMG mode, honor ordered image links such as `image1`, `image_1`, `images.image_1`, and `images.image_2` before generic loader scoring.

## Core mapping

- `promptNode`: nearest unique scalar text/prompt field on the positive conditioning path. Common fields are `text`, `prompt`, `string`, and custom text-encoder prompts.
- `negativePromptNode`: same rule on the negative path. It is optional when the workflow has no usable negative prompt.
- `seedNode`: scalar `seed` or `noise_seed` on the primary sampler, or a uniquely reached upstream seed node.
- `widthNode`, `heightNode`, `batchSizeNode`: scalar fields on the active latent path. Omit them when the IMG workflow gets dimensions from the input image.
- `imageInputNode1`: for `IMG`, the main image loader reachable from the primary prompt or latent path. Prefer an explicit `image1` path, then the nearest active loader.
- `maskInputNode`: only a strong `LoadImageMask` or explicit mask node. Never treat a normal `LoadImage` as a mask.

## Controls

Propose a small set of common controls on the active generation path:

- numeric sampler controls such as `steps`, `cfg`, `denoise`, `guidance`, `shift`, `start_at_step`, `end_at_step`;
- Comfy resource dropdowns such as `sampler_name` and `scheduler` when the node class supports them;
- safe boolean controls such as `pre_cfg`;
- named boolean switches on active nodes, such as prompt-enhancement or custom-size toggles;
- extra reference-image fields for IMG workflows;
- output ratio and resolution enums as dropdowns;
- checkpoint, UNet, CLIP, VAE, ControlNet and LoRA resource controls when they are on the active graph;
- nested LoRA slot fields such as `lora_1.lora`, `lora_1.on`, and `lora_1.strength`;
- user-requested scalar fields by node ID and title/field.

Do not expose loader filesystem paths, secrets, or every scalar field. Model and LoRA names may be exposed as resource dropdowns, grouped separately from tuning controls. Add unusual extra controls only after the user asks, and keep the panel readable.

Control type policy:

- `dropdown`: Comfy combo inputs, ratios, samplers/schedulers, checkpoints, UNet, CLIP, VAE, ControlNet, LoRA names.
- `slider`: bounded continuous values such as denoise, CFG, guidance, shift, model strength and LoRA strength.
- `number_input`: discrete or unbounded values such as steps, seed, width, height, batch size and megapixels.
- `switch`: booleans such as enable flags and prompt-optimization toggles.
- uploads: image, mask, audio or video fields.
- `text_input`: prompts and free-form text.

ComfyUI may expose existing image/audio/video files as combo options. Keep these fields as upload controls; the file enum is a resource source, not a reason to replace the upload widget with a dropdown.

The workflow JSON contains only the current selected values, not the complete ComfyUI enum. The app therefore performs the authoritative `/object_info` lookup during installation and option sync. If metadata is unavailable, keep the semantic type and current value, mark the options as unsynced, and never fabricate model lists.

## Confirmation and ambiguity

Before preparing an intent, tell the user:

- the suggested mode and why;
- the exact core node/field choices;
- the optional common controls;
- the outputs;
- every ambiguity or missing required mapping.

The user must explicitly choose `TXT` or `IMG`. If they want extra parameters, incorporate only those requested fields. If a mapping cannot be decided safely, show node IDs, titles, classes, and candidate fields, then wait.

## Outputs

Use the compiler's inferred outputs unless the user specifies a subset. If no known output exists, list terminal nodes and ask for the intended output node. Never invent an output ID.
