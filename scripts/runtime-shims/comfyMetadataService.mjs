const RESOURCE_KINDS = [
  'checkpoint',
  'lora',
  'vae',
  'controlnet',
  'sampler',
  'scheduler',
  'unet',
  'clip',
  'upscale_model',
  'style_model',
  'embedding',
  'ipadapter',
  'video_model',
];

const RESOURCE_COMBO_FIELDS = {
  checkpoint: ['ckpt_name'],
  lora: ['lora_name'],
  vae: ['vae_name'],
  controlnet: ['control_net_name'],
  sampler: ['sampler_name'],
  scheduler: ['scheduler'],
  unet: ['unet_name', 'diffusion_model_name'],
  clip: ['clip_name', 'clip_name1', 'clip_name2'],
  upscale_model: ['upscale_model_name'],
  style_model: ['style_model_name'],
  embedding: ['embedding_name'],
  ipadapter: ['ipadapter_file', 'ipadapter_name'],
  video_model: ['video_model_name'],
};

const NODE_CLASS_RESOURCE_FIELDS = [
  { nodeClass: /CheckpointLoader/i, inputName: /^(ckpt_name|checkpoint|checkpoint_name)$/i, kind: 'checkpoint' },
  { nodeClass: /(?:LoraLoader|Lora Loader|Power Lora)/i, inputName: /^(?:lora(?:_name)?|lora_\d+\.(?:lora|name))$/i, kind: 'lora' },
  { nodeClass: /VAELoader/i, inputName: /^vae_name$/i, kind: 'vae' },
  { nodeClass: /ControlNet/i, inputName: /^(control_net_name|controlnet_name)$/i, kind: 'controlnet' },
  { nodeClass: /KSampler|Sampler/i, inputName: /^sampler_name$/i, kind: 'sampler' },
  { nodeClass: /KSampler|Sampler/i, inputName: /^scheduler$/i, kind: 'scheduler' },
  { nodeClass: /UNET|Diffusion/i, inputName: /^(unet_name|diffusion_model_name|model_name)$/i, kind: 'unet' },
  { nodeClass: /CLIP/i, inputName: /^(clip_name|clip_name1|clip_name2|model_name)$/i, kind: 'clip' },
  { nodeClass: /Upscale/i, inputName: /^(model_name|upscale_model_name)$/i, kind: 'upscale_model' },
  { nodeClass: /StyleModel/i, inputName: /^(style_model_name|model_name)$/i, kind: 'style_model' },
  { nodeClass: /Embedding/i, inputName: /^(embedding_name|model_name)$/i, kind: 'embedding' },
  { nodeClass: /IPAdapter/i, inputName: /^(ipadapter_file|ipadapter_name|model_name)$/i, kind: 'ipadapter' },
  { nodeClass: /AnimateDiff|Wan|HunyuanVideo|Video|VHS/i, inputName: /^(video_model_name|model_name|unet_name)$/i, kind: 'video_model' },
];

export const inferComfyResourceKind = (inputName, nodeClass = '') => {
  const normalizedInputName = inputName.trim();
  const normalizedNodeClass = nodeClass.trim();
  if (/^lora_\d+\.(?:lora|name)$/i.test(normalizedInputName)) return 'lora';
  const exact = NODE_CLASS_RESOURCE_FIELDS.find(
    item => item.nodeClass.test(normalizedNodeClass) && item.inputName.test(normalizedInputName),
  );
  if (exact) return exact.kind;
  return RESOURCE_KINDS.find(
    kind => RESOURCE_COMBO_FIELDS[kind].includes(normalizedInputName),
  );
};

// The compiler only uses the pure inference function above. This placeholder
// keeps the unused metadata-aware export resolvable without pulling network or
// browser dependencies into the standalone runtime.
export const comfyMetadataService = {};
