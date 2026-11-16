export const ANALYSIS_VERSION = 2;

export class WorkflowAnalysisError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'WorkflowAnalysisError';
    this.code = code;
    this.details = details;
  }
}

const PROMPT_FIELDS = new Set([
  'text',
  'prompt',
  'string',
  'positive',
  'negative',
  'text_g',
  'text_l',
  'instruction',
  'value',
  'negative_prompt',
]);

const IMAGE_FIELD_PATTERN = /^(?:image|image\d+|pixels|pixel_image)$/i;
const MASK_PATTERN = /(?:mask|遮罩|蒙版)/i;
const RESOURCE_INPUT_PATTERN =
  /(?:load|input|upload|loader|checkpoint|unet|clip|vae|model|resource)/i;
const OUTPUT_PATTERNS = [
  { type: 'image', patterns: ['saveimage', 'previewimage', 'imageoutput', 'save image', 'preview image'] },
  { type: 'video', patterns: ['savevideo', 'videocombine', 'videooutput', 'saveanimatedwebp', 'savegif', 'video output'] },
  { type: 'audio', patterns: ['saveaudio', 'previewaudio', 'audiooutput', 'audio output'] },
  { type: 'text', patterns: ['savetext', 'previewtext', 'showtext', 'textoutput', 'text output'] },
];

const CONTROL_ORDER = [
  'steps',
  'cfg',
  'denoise',
  'sampler_name',
  'scheduler',
  'aspect_ratio',
  'guidance',
  'shift',
  'start_at_step',
  'end_at_step',
  'pre_cfg',
  'add_noise',
  'strength_model',
  'strength_clip',
  'strength',
  'megapixels',
  'resolution_steps',
];

const SEMANTIC_SWITCH_TITLE =
  /(?:开关|启用|禁用|优化|自定义|尺寸)|(?:^|[^a-z])(?:enable|switch|toggle|optimi[sz]e|use|size|resolution)(?:[^a-z]|$)/i;

const CONTROL_DEFINITIONS = {
  steps: { label: '采样步数', group: '常用参数', preferredType: 'number_input' },
  cfg: { label: 'CFG', group: '常用参数', preferredType: 'slider' },
  denoise: { label: '降噪强度', group: '常用参数', preferredType: 'slider' },
  sampler_name: { label: '采样器', group: '常用参数', preferredType: 'dropdown' },
  scheduler: { label: '调度器', group: '常用参数', preferredType: 'dropdown' },
  aspect_ratio: { label: '输出比例', group: '尺寸参数', preferredType: 'dropdown' },
  guidance: { label: '引导强度', group: '常用参数', preferredType: 'slider' },
  shift: { label: '采样偏移', group: '常用参数', preferredType: 'slider' },
  start_at_step: { label: '起始步', group: '常用参数', preferredType: 'number_input' },
  end_at_step: { label: '结束步', group: '常用参数', preferredType: 'number_input' },
  pre_cfg: { label: 'CFG 预归一化', group: '常用参数', preferredType: 'switch' },
  add_noise: { label: '添加噪声', group: '常用参数', preferredType: 'switch' },
  strength_model: { label: '模型强度', group: '强度参数', preferredType: 'slider' },
  strength_clip: { label: 'CLIP 强度', group: '强度参数', preferredType: 'slider' },
  strength: { label: '强度', group: '强度参数', preferredType: 'slider' },
  megapixels: { label: '目标像素', group: '图像参数', preferredType: 'number_input' },
  resolution_steps: { label: '分辨率步长', group: '图像参数', default: false, preferredType: 'number_input' },
};

const RESOURCE_CONTROL_DEFINITIONS = {
  ckpt_name: { label: 'Checkpoint 模型' },
  unet_name: { label: 'UNet 模型' },
  diffusion_model_name: { label: 'UNet 模型' },
  clip_name: { label: 'CLIP 模型' },
  clip_name1: { label: 'CLIP 模型 1' },
  clip_name2: { label: 'CLIP 模型 2' },
  vae_name: { label: 'VAE 模型' },
  lora_name: { label: 'LoRA 模型' },
  control_net_name: { label: 'ControlNet 模型' },
  upscale_model_name: { label: '放大模型' },
  style_model_name: { label: '风格模型' },
  embedding_name: { label: 'Embedding' },
  ipadapter_file: { label: 'IPAdapter 模型' },
  ipadapter_name: { label: 'IPAdapter 模型' },
  video_model_name: { label: '视频模型' },
};

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
}

function compact(value) {
  return normalizeWords(value).replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function nodeText(node) {
  return [
    node?._meta?.title,
    node?.title,
    node?.class_type,
  ]
    .filter(value => typeof value === 'string')
    .join(' ');
}

function nodeLabel(nodeId, node) {
  const title = node?._meta?.title || node?.title || node?.class_type || 'Node';
  return `${String(title).trim()} (#${nodeId})`;
}

function isLinkValue(value, workflow) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const [sourceId, outputIndex] = value;
  return (
    (typeof sourceId === 'string' || typeof sourceId === 'number') &&
    typeof outputIndex === 'number' &&
    Object.prototype.hasOwnProperty.call(workflow, String(sourceId))
  );
}

function scalarEntries(node) {
  return Object.entries(node?.inputs || {}).filter(([, value]) => (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ));
}

function fieldValue(node, field) {
  return node?.inputs ? node.inputs[field] : undefined;
}

function mapping(nodeId, field) {
  return { nodeId: String(nodeId), fieldPath: `inputs.${field}` };
}

function mappingIdentity(value) {
  return value?.nodeId && value?.fieldPath
    ? `${value.nodeId}:${value.fieldPath}`
    : '';
}

function sortNodeIds(a, b) {
  const numericA = /^\d+$/.test(a) ? Number(a) : Number.NaN;
  const numericB = /^\d+$/.test(b) ? Number(b) : Number.NaN;
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) {
    return numericA - numericB;
  }
  return a.localeCompare(b);
}

export function assertApiWorkflow(raw) {
  if (!isPlainObject(raw)) {
    throw new WorkflowAnalysisError(
      'E_WORKFLOW_FORMAT',
      'Workflow JSON must be a top-level object in ComfyUI API format.',
    );
  }
  if (Array.isArray(raw.nodes) || Array.isArray(raw.links)) {
    throw new WorkflowAnalysisError(
      'E_UI_WORKFLOW_FORMAT',
      'This is a ComfyUI UI workflow. Export it with ComfyUI\'s API format and try again.',
    );
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new WorkflowAnalysisError(
      'E_WORKFLOW_EMPTY',
      'Workflow JSON contains no nodes.',
    );
  }
  for (const [nodeId, node] of entries) {
    if (!isPlainObject(node)) {
      throw new WorkflowAnalysisError(
        'E_WORKFLOW_FORMAT',
        `Node ${nodeId} must be an object.`,
        { nodeId },
      );
    }
    if (typeof node.class_type !== 'string' || !node.class_type.trim()) {
      throw new WorkflowAnalysisError(
        'E_WORKFLOW_FORMAT',
        `Node ${nodeId} is missing class_type.`,
        { nodeId },
      );
    }
    if (!isPlainObject(node.inputs || {})) {
      throw new WorkflowAnalysisError(
        'E_WORKFLOW_FORMAT',
        `Node ${nodeId}.inputs must be an object.`,
        { nodeId },
      );
    }
  }
  return raw;
}

function buildGraph(workflow) {
  const incoming = new Map();
  const outgoing = new Map();
  const nodeIds = Object.keys(workflow);
  for (const nodeId of nodeIds) {
    incoming.set(nodeId, []);
    outgoing.set(nodeId, []);
  }
  for (const [targetId, node] of Object.entries(workflow)) {
    for (const [field, value] of Object.entries(node.inputs || {})) {
      if (!isLinkValue(value, workflow)) continue;
      const sourceId = String(value[0]);
      const edge = { sourceId, targetId, field, outputIndex: value[1] };
      incoming.get(targetId)?.push(edge);
      outgoing.get(sourceId)?.push(edge);
    }
  }
  return { incoming, outgoing, nodeIds };
}

function inferOutputCandidates(workflow) {
  return Object.entries(workflow)
    .flatMap(([nodeId, node]) => {
      const text = `${compact(node.class_type)} ${compact(node._meta?.title)} ${compact(node.title)}`;
      const words = `${normalizeWords(node.class_type)} ${normalizeWords(node._meta?.title)} ${normalizeWords(node.title)}`;
      if (
        RESOURCE_INPUT_PATTERN.test(compact(node.class_type)) &&
        !/(?:save|output|preview|show)/i.test(compact(node.class_type))
      ) {
        return [];
      }
      for (const definition of OUTPUT_PATTERNS) {
        if (
          definition.patterns.some(pattern => (
            text.includes(compact(pattern)) || words.includes(pattern)
          ))
        ) {
          return [{
            nodeId,
            label: nodeLabel(nodeId, node),
            type: definition.type,
          }];
        }
      }
      return [];
    })
    .sort((a, b) => sortNodeIds(a.nodeId, b.nodeId));
}

function distanceToOutputs(startNodeId, graph, outputIds) {
  if (outputIds.has(startNodeId)) return 0;
  const queue = [{ nodeId: startNodeId, distance: 0 }];
  const seen = new Set([startNodeId]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of graph.outgoing.get(current.nodeId) || []) {
      if (seen.has(edge.targetId)) continue;
      const distance = current.distance + 1;
      if (outputIds.has(edge.targetId)) return distance;
      seen.add(edge.targetId);
      queue.push({ nodeId: edge.targetId, distance });
    }
  }
  return null;
}

function collectUpstream(startIds, graph) {
  const distances = new Map();
  const queue = [];
  for (const startId of startIds) {
    if (!graph.incoming.has(String(startId))) continue;
    const nodeId = String(startId);
    distances.set(nodeId, 0);
    queue.push(nodeId);
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const nodeId = queue[cursor];
    cursor += 1;
    const distance = distances.get(nodeId) || 0;
    for (const edge of graph.incoming.get(nodeId) || []) {
      const existing = distances.get(edge.sourceId);
      const nextDistance = distance + 1;
      if (existing !== undefined && existing <= nextDistance) continue;
      distances.set(edge.sourceId, nextDistance);
      queue.push(edge.sourceId);
    }
  }
  return distances;
}

function linkSourceIds(workflow, node, fieldNames) {
  const result = [];
  for (const field of fieldNames) {
    const value = fieldValue(node, field);
    if (isLinkValue(value, workflow)) result.push(String(value[0]));
  }
  return result;
}

function publicCandidate(nodeId, node, extra = {}) {
  return {
    nodeId,
    label: nodeLabel(nodeId, node),
    classType: node.class_type || '',
    ...extra,
  };
}

function chooseSampler(workflow, graph, outputs) {
  const outputIds = new Set(outputs.map(output => output.nodeId));
  const candidates = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    const className = compact(node.class_type);
    const title = compact(node._meta?.title || node.title);
    const allText = `${className} ${title}`;
    const hasPositive = isLinkValue(fieldValue(node, 'positive'), workflow);
    const hasNegative = isLinkValue(fieldValue(node, 'negative'), workflow);
    const hasLatent = isLinkValue(fieldValue(node, 'latent_image'), workflow);
    const hasSeed =
      typeof fieldValue(node, 'seed') === 'number' ||
      typeof fieldValue(node, 'noise_seed') === 'number';
    const hasSteps = typeof fieldValue(node, 'steps') === 'number';
    const hasCfg = typeof fieldValue(node, 'cfg') === 'number';
    const isSamplerSelector = (
      className.includes('samplerselect')
      && !hasPositive
      && !hasNegative
      && !hasLatent
      && !hasSeed
    );
    if (isSamplerSelector) continue;
    const distance = distanceToOutputs(nodeId, graph, outputIds);
    let score = 0;
    if (className.includes('ksampler')) score += 12;
    else if (className.includes('sampler')) score += 9;
    if (title.includes('采样器') || title.includes('sampler')) score += 5;
    if (hasPositive) score += 3;
    if (hasNegative) score += 3;
    if (hasLatent) score += 2;
    if (hasSeed) score += 3;
    if (hasSteps) score += 1;
    if (hasCfg) score += 1;
    if (distance !== null) score += Math.max(0, 8 - distance * 2);
    const samplerLike =
      allText.includes('sampler') ||
      allText.includes('采样') ||
      (hasPositive && hasNegative && (hasLatent || hasSeed));
    if (!samplerLike || score < 7) continue;
    candidates.push({
      nodeId,
      node,
      score,
      distance,
      hasPositive,
      hasNegative,
    });
  }
  candidates.sort((a, b) => (
    b.score - a.score ||
    (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER) ||
    sortNodeIds(a.nodeId, b.nodeId)
  ));
  if (candidates.length === 0) {
    return {
      selected: null,
      ambiguity: {
        kind: 'sampler',
        modes: ['txt', 'img'],
        message: 'No clear generation sampler was found.',
        candidates: [],
      },
    };
  }
  if (
    candidates.length > 1 &&
    candidates[0].score - candidates[1].score < 3
  ) {
    return {
      selected: null,
      ambiguity: {
        kind: 'sampler',
        modes: ['txt', 'img'],
        message: 'Multiple sampler candidates are equally plausible.',
        candidates: candidates.slice(0, 6).map(candidate => publicCandidate(
          candidate.nodeId,
          candidate.node,
          {
            score: candidate.score,
            distanceToOutput: candidate.distance,
          },
        )),
      },
    };
  }
  return { selected: candidates[0], ambiguity: null };
}

function conditioningLink(workflow, sampler, kind) {
  const direct = fieldValue(sampler.node, kind);
  if (isLinkValue(direct, workflow)) return direct;
  const guiderLink = fieldValue(sampler.node, 'guider');
  if (!isLinkValue(guiderLink, workflow)) return null;
  const guider = workflow[String(guiderLink[0])];
  const guided = fieldValue(guider, kind);
  return isLinkValue(guided, workflow) ? guided : null;
}

function findPromptCandidate(workflow, graph, sampler, kind) {
  const link = conditioningLink(workflow, sampler, kind);
  if (!link) {
    return { mapping: null, ambiguity: null, candidates: [] };
  }
  const distances = collectUpstream([String(link[0])], graph);
  const candidates = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!distances.has(nodeId)) continue;
    const className = compact(node.class_type);
    const title = compact(node._meta?.title || node.title);
    for (const [fieldName, value] of scalarEntries(node)) {
      const normalizedField = fieldName.toLowerCase();
      if (typeof value !== 'string') continue;
      if (!PROMPT_FIELDS.has(normalizedField)) continue;
      if (kind === 'positive' && normalizedField.includes('negative')) continue;
      if (kind === 'negative' && normalizedField.includes('positive')) continue;
      let score = 0;
      if (normalizedField === 'text' || normalizedField === 'prompt') score += 8;
      else if (normalizedField === 'negative_prompt') score += 6;
      else if (normalizedField === 'value') score += 4;
      else if (normalizedField === 'string') score += 5;
      else if (normalizedField === 'positive' || normalizedField === 'negative') score += 4;
      else score += 3;
      if (className.includes('textencode')) score += 6;
      if (className.includes('cliptext')) score += 5;
      if (className.includes('conditioning')) score += 3;
      if (title.includes('prompt') || title.includes('提示词')) score += 3;
      if (/(?:system|系统)/i.test(title) || /(?:system|系统)/i.test(className)) score -= 8;
      if (/(?:preview|show|display|预览|最终)/i.test(title)) score -= 10;
      if (normalizedField.includes('negative')) {
        score += kind === 'negative' ? 5 : -7;
      }
      if (kind === 'positive') {
        if (/(?:negative|bad|反向|负面)/i.test(title)) score -= 7;
        if (/(?:positive|正面)/i.test(title)) score += 4;
        if (value.trim()) score += 1;
      } else {
        if (/(?:negative|bad|反向|负面)/i.test(title)) score += 5;
        if (/(?:positive|正面)/i.test(title)) score -= 5;
      }
      score += Math.max(0, 5 - (distances.get(nodeId) || 0));
      candidates.push({
        nodeId,
        node,
        fieldName,
        score,
        distance: distances.get(nodeId) || 0,
      });
    }
  }
  candidates.sort((a, b) => (
    b.score - a.score ||
    a.distance - b.distance ||
    sortNodeIds(a.nodeId, b.nodeId) ||
    a.fieldName.localeCompare(b.fieldName)
  ));
  const publicCandidates = candidates.slice(0, 8).map(candidate => publicCandidate(
    candidate.nodeId,
    candidate.node,
    {
      fieldPath: `inputs.${candidate.fieldName}`,
      distance: candidate.distance,
      score: candidate.score,
    },
  ));
  if (candidates.length === 0) {
    return {
      mapping: null,
      candidates: publicCandidates,
      ambiguity: {
        kind: `${kind}_prompt`,
        modes: ['txt', 'img'],
        message: `The ${kind} conditioning path has no usable scalar text field.`,
        candidates: [],
      },
    };
  }
  if (
    candidates.length > 1 &&
    candidates[0].score - candidates[1].score < 2
  ) {
    return {
      mapping: null,
      candidates: publicCandidates,
      ambiguity: {
        kind: `${kind}_prompt`,
        modes: ['txt', 'img'],
        message: `Multiple ${kind} prompt fields are equally plausible.`,
        candidates: publicCandidates,
      },
    };
  }
  return {
    mapping: mapping(candidates[0].nodeId, candidates[0].fieldName),
    candidates: publicCandidates,
    ambiguity: null,
  };
}

function chooseSeed(workflow, graph, sampler) {
  for (const field of ['seed', 'noise_seed', 'noise']) {
    const value = fieldValue(sampler.node, field);
    if (typeof value === 'number') {
      return { mapping: mapping(sampler.nodeId, field), candidates: [] };
    }
    if (isLinkValue(value, workflow)) {
      const distances = collectUpstream([String(value[0])], graph);
      const candidates = [];
      for (const [nodeId, node] of Object.entries(workflow)) {
        if (!distances.has(nodeId)) continue;
        for (const candidateField of ['seed', 'noise_seed']) {
          if (typeof fieldValue(node, candidateField) !== 'number') continue;
          candidates.push({
            nodeId,
            node,
            fieldName: candidateField,
            distance: distances.get(nodeId) || 0,
          });
        }
      }
      candidates.sort((a, b) => (
        a.distance - b.distance || sortNodeIds(a.nodeId, b.nodeId)
      ));
      if (candidates.length > 0) {
        return {
          mapping: mapping(candidates[0].nodeId, candidates[0].fieldName),
          candidates: candidates.map(candidate => publicCandidate(
            candidate.nodeId,
            candidate.node,
            { fieldPath: `inputs.${candidate.fieldName}` },
          )),
        };
      }
    }
  }
  return { mapping: null, candidates: [] };
}

function chooseDimension(workflow, graph, sampler, field, aliases = []) {
  const candidateFields = [field, ...aliases];
  for (const candidateField of candidateFields) {
    const direct = fieldValue(sampler.node, candidateField);
    if (typeof direct === 'number') {
      return { mapping: mapping(sampler.nodeId, candidateField), candidates: [] };
    }
  }
  const latentLink = fieldValue(sampler.node, 'latent_image');
  if (!isLinkValue(latentLink, workflow)) {
    return { mapping: null, candidates: [], ambiguity: null };
  }
  const distances = collectUpstream([String(latentLink[0])], graph);
  const candidates = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!distances.has(nodeId)) continue;
    for (const candidateField of candidateFields) {
      if (typeof fieldValue(node, candidateField) !== 'number') continue;
      candidates.push({
        nodeId,
        node,
        fieldName: candidateField,
        distance: distances.get(nodeId) || 0,
      });
    }
  }
  candidates.sort((a, b) => (
    a.distance - b.distance ||
    sortNodeIds(a.nodeId, b.nodeId) ||
    a.fieldName.localeCompare(b.fieldName)
  ));
  if (candidates.length === 0) {
    return { mapping: null, candidates: [], ambiguity: null };
  }
  if (
    candidates.length > 1 &&
    candidates[0].distance === candidates[1].distance &&
    candidates[0].nodeId !== candidates[1].nodeId
  ) {
    return {
      mapping: null,
      candidates: candidates.slice(0, 6).map(candidate => publicCandidate(
        candidate.nodeId,
        candidate.node,
        { fieldPath: `inputs.${candidate.fieldName}` },
      )),
      ambiguity: {
        kind: `dimension_${field}`,
        modes: ['txt', 'img'],
        message: `Multiple ${field} fields are equally close on the latent path.`,
        candidates: candidates.slice(0, 6).map(candidate => publicCandidate(
          candidate.nodeId,
          candidate.node,
          { fieldPath: `inputs.${candidate.fieldName}` },
        )),
      },
    };
  }
  return {
    mapping: mapping(candidates[0].nodeId, candidates[0].fieldName),
    candidates: candidates.map(candidate => publicCandidate(
      candidate.nodeId,
      candidate.node,
      { fieldPath: `inputs.${candidate.fieldName}` },
    )),
    ambiguity: null,
  };
}

function imageLoaderField(node) {
  for (const [field, value] of scalarEntries(node)) {
    if (typeof value === 'string' && IMAGE_FIELD_PATTERN.test(field)) {
      return field;
    }
  }
  return null;
}

function isMaskCandidate(node) {
  const text = nodeText(node);
  return MASK_PATTERN.test(text) || compact(node.class_type).includes('loadimagemask');
}

function collectImageCandidates(workflow, graph, activeStartIds) {
  const distances = collectUpstream(activeStartIds, graph);
  const candidates = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!distances.has(nodeId)) continue;
    const fieldName = imageLoaderField(node);
    if (!fieldName) continue;
    if (isMaskCandidate(node)) continue;
    const className = compact(node.class_type);
    const title = compact(node._meta?.title || node.title);
    let score = 0;
    if (className.includes('loadimage')) score += 8;
    if (className.includes('inputimage')) score += 8;
    if (title.includes('加载图像') || title.includes('图片')) score += 5;
    if (fieldName.toLowerCase() === 'image') score += 4;
    score += Math.max(0, 5 - (distances.get(nodeId) || 0));
    if (score < 6) continue;
    candidates.push({
      nodeId,
      node,
      fieldName,
      distance: distances.get(nodeId) || 0,
      score,
    });
  }
  return candidates.sort((a, b) => (
    b.score - a.score ||
    a.distance - b.distance ||
    sortNodeIds(a.nodeId, b.nodeId)
  ));
}

function traceImageFieldToLoader(workflow, graph, promptNode, fieldName) {
  const value = fieldValue(promptNode, fieldName);
  if (!isLinkValue(value, workflow)) return null;
  const distances = collectUpstream([String(value[0])], graph);
  const candidates = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!distances.has(nodeId) || isMaskCandidate(node)) continue;
    const loaderField = imageLoaderField(node);
    if (!loaderField) continue;
    candidates.push({
      nodeId,
      node,
      fieldName: loaderField,
      distance: distances.get(nodeId) || 0,
    });
  }
  candidates.sort((a, b) => (
    a.distance - b.distance || sortNodeIds(a.nodeId, b.nodeId)
  ));
  return candidates[0] || null;
}

function imageLinkIndex(fieldName) {
  const normalized = fieldName.toLowerCase();
  if (normalized === 'image') return 1;
  const match = normalized.match(/^(?:images\.)?image[._]?(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]);
  return index > 0 ? index : null;
}

function traceLinkedImageCandidates(workflow, graph, activeStartIds) {
  const distances = collectUpstream(activeStartIds, graph);
  const candidates = [];
  const seenLoaders = new Set();
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!distances.has(nodeId)) continue;
    for (const [fieldName, value] of Object.entries(node.inputs || {})) {
      if (!isLinkValue(value, workflow)) continue;
      const index = imageLinkIndex(fieldName);
      if (!index) continue;
      const traced = traceImageFieldToLoader(workflow, graph, node, fieldName);
      if (!traced || seenLoaders.has(traced.nodeId) || isMaskCandidate(traced.node)) continue;
      seenLoaders.add(traced.nodeId);
      candidates.push({
        ...traced,
        index,
        linkDistance: distances.get(nodeId) || 0,
      });
    }
  }
  return candidates.sort((a, b) => (
    a.index - b.index ||
    a.linkDistance - b.linkDistance ||
    a.distance - b.distance ||
    sortNodeIds(a.nodeId, b.nodeId)
  ));
}

function chooseImageInput(workflow, graph, positivePrompt, activeStartIds) {
  const linked = traceLinkedImageCandidates(workflow, graph, activeStartIds);
  if (linked.length > 0) {
    const [main, ...extras] = linked;
    return {
      main: {
        mapping: mapping(main.nodeId, main.fieldName),
        nodeId: main.nodeId,
        node: main.node,
        fieldName: main.fieldName,
      },
      extras,
      ambiguity: null,
    };
  }
  const candidates = collectImageCandidates(workflow, graph, activeStartIds);
  if (candidates.length === 0) {
    return {
      main: null,
      extras: [],
      ambiguity: {
        kind: 'image_input',
        modes: ['img'],
        message: 'IMG mode needs a main image input, but no scalar image loader was found.',
        candidates: [],
      },
    };
  }

  let main = null;
  if (positivePrompt?.nodeId) {
    const promptNode = workflow[positivePrompt.nodeId];
    const directImageFields = Object.keys(promptNode?.inputs || {})
      .filter(field => IMAGE_FIELD_PATTERN.test(field))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const field of directImageFields) {
      const traced = traceImageFieldToLoader(
        workflow,
        graph,
        promptNode,
        field,
      );
      if (traced) {
        main = traced;
        break;
      }
    }
  }
  if (!main && candidates.length === 1) main = candidates[0];
  if (!main) {
    const latentLink = candidates.find(candidate => candidate.fieldName === 'image');
    if (latentLink) main = latentLink;
  }
  if (!main) {
    const topCandidates = candidates.filter(
      candidate => candidate.score === candidates[0].score,
    );
    if (topCandidates.length > 1) {
      return {
        main: null,
        extras: [],
        ambiguity: {
          kind: 'image_input',
          modes: ['img'],
          message: 'Multiple image loaders are equally plausible as the main image.',
          candidates: topCandidates.map(candidate => publicCandidate(
            candidate.nodeId,
            candidate.node,
            { fieldPath: `inputs.${candidate.fieldName}` },
          )),
        },
      };
    }
    main = candidates[0];
  }

  const extras = candidates
    .filter(candidate => candidate.nodeId !== main.nodeId)
    .sort((a, b) => (
      a.distance - b.distance ||
      sortNodeIds(a.nodeId, b.nodeId)
    ));
  return {
    main: {
      mapping: mapping(main.nodeId, main.fieldName),
      nodeId: main.nodeId,
      node: main.node,
      fieldName: main.fieldName,
    },
    extras,
    ambiguity: null,
  };
}

function chooseMaskInput(workflow, graph, activeStartIds) {
  const distances = collectUpstream(activeStartIds, graph);
  const candidates = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!distances.has(nodeId) || !isMaskCandidate(node)) continue;
    for (const fieldName of ['mask', 'image']) {
      if (typeof fieldValue(node, fieldName) !== 'string') continue;
      candidates.push({ nodeId, node, fieldName });
      break;
    }
  }
  candidates.sort((a, b) => sortNodeIds(a.nodeId, b.nodeId));
  if (candidates.length === 0) {
    return { mapping: null, ambiguity: null };
  }
  if (candidates.length > 1) {
    return {
      mapping: null,
      ambiguity: {
        kind: 'mask_input',
        modes: ['img'],
        message: 'Multiple mask input candidates were found.',
        candidates: candidates.map(candidate => publicCandidate(
          candidate.nodeId,
          candidate.node,
          { fieldPath: `inputs.${candidate.fieldName}` },
        )),
      },
    };
  }
  return {
    mapping: mapping(candidates[0].nodeId, candidates[0].fieldName),
    ambiguity: null,
  };
}

function resourceControlCandidates(nodeId, node) {
  const controls = [];
  const add = (fieldPath, label, group, preferredType, order) => {
    controls.push({
      nodeId: String(nodeId),
      fieldPath,
      label,
      group,
      preferredType,
      order,
    });
  };
  const inputs = node?.inputs || {};
  for (const [fieldName, value] of scalarEntries(node)) {
    const definition = RESOURCE_CONTROL_DEFINITIONS[fieldName];
    if (!definition || typeof value !== 'string') continue;
    add(
      `inputs.${fieldName}`,
      `${definition.label} (#${nodeId})`,
      '模型资源',
      'dropdown',
      300 + controls.length,
    );
  }
  for (const [groupKey, groupValue] of Object.entries(inputs)) {
    const match = /^lora_(\d+)$/i.exec(groupKey);
    if (!match || !isPlainObject(groupValue)) continue;
    const slot = Number(match[1]);
    const loraName = groupValue.lora ?? groupValue.name;
    if (typeof loraName === 'string') {
      add(
        `inputs.${groupKey}.${Object.prototype.hasOwnProperty.call(groupValue, 'lora') ? 'lora' : 'name'}`,
        `LoRA ${slot} 名称`,
        '模型资源',
        'dropdown',
        300 + controls.length,
      );
    }
    if (typeof groupValue.on === 'boolean') {
      add(
        `inputs.${groupKey}.on`,
        `LoRA ${slot} 启用`,
        '模型资源',
        'switch',
        300 + controls.length,
      );
    }
    if (typeof groupValue.strength === 'number') {
      add(
        `inputs.${groupKey}.strength`,
        `LoRA ${slot} 强度`,
        '模型资源',
        'slider',
        300 + controls.length,
      );
    }
  }
  return controls;
}

function semanticSwitchControlCandidates(nodeId, node) {
  const title = node?._meta?.title || node?.title || '';
  if (!title || !SEMANTIC_SWITCH_TITLE.test(title)) return [];
  const label = title
    .replace(/\s*[（(]\s*(?:开关|switch|toggle)\s*[）)]\s*$/i, '')
    .replace(/开关\s*$/i, '')
    .trim() || title;
  return scalarEntries(node)
    .filter(([, value]) => typeof value === 'boolean')
    .map(([fieldName]) => ({
      nodeId: String(nodeId),
      fieldPath: `inputs.${fieldName}`,
      label,
      group: /(?:尺寸|size|resolution|ratio)/i.test(title) ? '尺寸参数' : '常用参数',
      preferredType: 'switch',
      order: 200,
    }));
}

function buildControls(workflow, activeNodes, core, imageExtras) {
  const coreIdentities = new Set(
    Object.values(core)
      .map(mappingIdentity)
      .filter(Boolean),
  );
  const controls = [];
  const seen = new Set();
  const order = new Map(CONTROL_ORDER.map((field, index) => [field, index]));

  for (const nodeId of activeNodes) {
    const node = workflow[nodeId];
    if (!node) continue;
    for (const [fieldName, value] of scalarEntries(node)) {
      const definition = CONTROL_DEFINITIONS[fieldName];
      if (!definition) continue;
      if (definition.default === false) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
      const identity = `${nodeId}:inputs.${fieldName}`;
      if (coreIdentities.has(identity) || seen.has(identity)) continue;
      seen.add(identity);
      controls.push({
        nodeId,
        fieldPath: `inputs.${fieldName}`,
        label: definition.label,
        group: definition.group,
        ...(definition.preferredType ? { preferredType: definition.preferredType } : {}),
        order: order.get(fieldName) ?? CONTROL_ORDER.length,
      });
    }
  }

  for (const nodeId of activeNodes) {
    const node = workflow[nodeId];
    if (!node) continue;
    for (const candidate of resourceControlCandidates(nodeId, node)) {
      const identity = `${candidate.nodeId}:${candidate.fieldPath}`;
      if (coreIdentities.has(identity) || seen.has(identity)) continue;
      seen.add(identity);
      controls.push(candidate);
    }
  }

  for (const nodeId of activeNodes) {
    const node = workflow[nodeId];
    if (!node) continue;
    for (const candidate of semanticSwitchControlCandidates(nodeId, node)) {
      const identity = `${candidate.nodeId}:${candidate.fieldPath}`;
      if (coreIdentities.has(identity) || seen.has(identity)) continue;
      seen.add(identity);
      controls.push(candidate);
    }
  }

  imageExtras.forEach((candidate, index) => {
    const identity = `${candidate.nodeId}:inputs.${candidate.fieldName}`;
    if (coreIdentities.has(identity) || seen.has(identity)) return;
    seen.add(identity);
    controls.push({
      nodeId: candidate.nodeId,
      fieldPath: `inputs.${candidate.fieldName}`,
      label: `参考图 ${index + 2}`,
      group: '图像输入',
      preferredType: 'image_upload',
      order: CONTROL_ORDER.length + index,
    });
  });

  controls.sort((a, b) => (
    a.order - b.order ||
    sortNodeIds(a.nodeId, b.nodeId) ||
    a.fieldPath.localeCompare(b.fieldPath)
  ));
  return controls.map(({ order: _order, ...control }) => control);
}

function buildOptionalControls(workflow, activeNodes, core) {
  const coreIdentities = new Set(
    Object.values(core)
      .map(mappingIdentity)
      .filter(Boolean),
  );
  const optional = [];
  const seen = new Set();
  for (const nodeId of activeNodes) {
    const node = workflow[nodeId];
    if (!node) continue;
    for (const [fieldName, value] of scalarEntries(node)) {
      const definition = CONTROL_DEFINITIONS[fieldName];
      if (!definition || definition.default !== false) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
      const identity = `${nodeId}:inputs.${fieldName}`;
      if (coreIdentities.has(identity) || seen.has(identity)) continue;
      seen.add(identity);
      optional.push({
        nodeId,
        fieldPath: `inputs.${fieldName}`,
        label: definition.label,
        group: definition.group,
        ...(definition.preferredType ? { preferredType: definition.preferredType } : {}),
      });
    }
  }
  optional.sort((a, b) => (
    sortNodeIds(a.nodeId, b.nodeId) ||
    a.fieldPath.localeCompare(b.fieldPath)
  ));
  return optional;
}

function uniqueAmbiguities(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item) return false;
    const key = `${item.kind}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function proposalForMode({
  mode,
  prompt,
  negativePrompt,
  seed,
  width,
  height,
  batch,
  image,
  mask,
  outputs,
  controls,
}) {
  const core = {};
  if (prompt.mapping) core.promptNode = prompt.mapping;
  if (negativePrompt.mapping) core.negativePromptNode = negativePrompt.mapping;
  if (seed.mapping) core.seedNode = seed.mapping;
  if (width.mapping) core.widthNode = width.mapping;
  if (height.mapping) core.heightNode = height.mapping;
  if (batch.mapping) core.batchSizeNode = batch.mapping;
  if (mode === 'img' && image.main?.mapping) {
    core.imageInputNode1 = image.main.mapping;
  }
  if (mode === 'img' && mask.mapping) {
    core.maskInputNode = mask.mapping;
  }
  const warnings = [];
  if (!prompt.mapping) warnings.push('未找到唯一的正面提示词映射。');
  if (outputs.length === 0) warnings.push('未找到可识别的输出节点。');
  if (mode === 'img' && !image.main?.mapping) {
    warnings.push('IMG 模式未找到唯一的主图输入。');
  }
  return {
    ready: warnings.length === 0,
    core,
    controls,
    outputNodeIds: outputs.map(output => output.nodeId),
    warnings,
  };
}

export function analyzeWorkflow(rawWorkflow) {
  const workflow = assertApiWorkflow(rawWorkflow);
  const graph = buildGraph(workflow);
  const outputs = inferOutputCandidates(workflow);
  const sampler = chooseSampler(workflow, graph, outputs);
  const ambiguities = [];
  if (sampler.ambiguity) ambiguities.push(sampler.ambiguity);

  let prompt = {
    mapping: null,
    candidates: [],
    ambiguity: sampler.selected
      ? null
      : {
        kind: 'positive_prompt',
        modes: ['txt', 'img'],
        message: 'A sampler must be selected before prompt mapping can be resolved.',
        candidates: [],
      },
  };
  let negativePrompt = { mapping: null, candidates: [], ambiguity: null };
  let seed = { mapping: null, candidates: [] };
  let width = { mapping: null, candidates: [], ambiguity: null };
  let height = { mapping: null, candidates: [], ambiguity: null };
  let batch = { mapping: null, candidates: [], ambiguity: null };
  let image = {
    main: null,
    extras: [],
    ambiguity: {
      kind: 'image_input',
      modes: ['img'],
      message: 'A sampler must be selected before image inputs can be resolved.',
      candidates: [],
    },
  };
  let mask = { mapping: null, ambiguity: null };

  if (sampler.selected) {
    prompt = findPromptCandidate(workflow, graph, sampler.selected, 'positive');
    negativePrompt = findPromptCandidate(
      workflow,
      graph,
      sampler.selected,
      'negative',
    );
    seed = chooseSeed(workflow, graph, sampler.selected);
    width = chooseDimension(workflow, graph, sampler.selected, 'width');
    height = chooseDimension(workflow, graph, sampler.selected, 'height');
    batch = chooseDimension(
      workflow,
      graph,
      sampler.selected,
      'batch_size',
      ['batch'],
    );
    const activeStartIds = [
      String(sampler.selected.nodeId),
      ...linkSourceIds(workflow, sampler.selected.node, [
        'positive',
        'negative',
        'latent_image',
        'seed',
        'noise_seed',
      ]),
    ];
    image = chooseImageInput(
      workflow,
      graph,
      prompt.mapping,
      activeStartIds,
    );
    mask = chooseMaskInput(workflow, graph, activeStartIds);
  }

  for (const item of [
    prompt.ambiguity,
    negativePrompt.ambiguity,
    image.ambiguity,
    mask.ambiguity,
    width.ambiguity,
    height.ambiguity,
    batch.ambiguity,
  ]) {
    if (item) ambiguities.push(item);
  }
  if (outputs.length === 0) {
    const terminalCandidates = Object.entries(workflow)
      .filter(([nodeId, node]) => (
        (graph.outgoing.get(nodeId) || []).length === 0 &&
        !isMaskCandidate(node) &&
        !imageLoaderField(node) &&
        compact(node.class_type) !== 'ksampler'
      ))
      .slice(0, 8)
      .map(([nodeId, node]) => publicCandidate(nodeId, node));
    ambiguities.push({
      kind: 'output',
      modes: ['txt', 'img'],
      message: 'No supported output node was recognized.',
      candidates: terminalCandidates,
    });
  }

  const activeNodes = sampler.selected
    ? [...collectUpstream([
      String(sampler.selected.nodeId),
      ...linkSourceIds(workflow, sampler.selected.node, [
        'positive',
        'negative',
        'latent_image',
      ]),
    ], graph).entries()]
      .sort((a, b) => a[1] - b[1] || sortNodeIds(a[0], b[0]))
      .map(([nodeId]) => nodeId)
    : [];
  const txtControls = buildControls(workflow, activeNodes, {
    promptNode: prompt.mapping,
    negativePromptNode: negativePrompt.mapping,
    seedNode: seed.mapping,
    widthNode: width.mapping,
    heightNode: height.mapping,
    batchSizeNode: batch.mapping,
  }, []);
  const imgCore = {
    promptNode: prompt.mapping,
    negativePromptNode: negativePrompt.mapping,
    seedNode: seed.mapping,
    widthNode: width.mapping,
    heightNode: height.mapping,
    batchSizeNode: batch.mapping,
    imageInputNode1: image.main?.mapping,
    maskInputNode: mask.mapping,
  };
  const imgControls = buildControls(
    workflow,
    activeNodes,
    imgCore,
    image.extras,
  );
  const optionalControls = buildOptionalControls(
    workflow,
    activeNodes,
    imgCore,
  );

  const txt = proposalForMode({
    mode: 'txt',
    prompt,
    negativePrompt,
    seed,
    width,
    height,
    batch,
    image: { main: null, extras: [] },
    mask: { mapping: null, ambiguity: null },
    outputs,
    controls: txtControls,
  });
  const img = proposalForMode({
    mode: 'img',
    prompt,
    negativePrompt,
    seed,
    width,
    height,
    batch,
    image,
    mask,
    outputs,
    controls: imgControls,
  });

  const imagePresent = Boolean(image.main || image.extras.length > 0);
  const suggestedMode = imagePresent ? 'img' : 'txt';
  const suggestedCategory = suggestedMode === 'img' ? 'edit' : 'generate';
  const resolvedAmbiguities = uniqueAmbiguities(ambiguities);
  const readyModes = [
    ...(txt.ready ? ['txt'] : []),
    ...(img.ready ? ['img'] : []),
  ];
  const status = readyModes.length > 0
    ? 'needs_confirmation'
    : 'needs_input';

  return {
    version: ANALYSIS_VERSION,
    status,
    modeConfirmationRequired: true,
    readyModes,
    suggestedMode,
    suggestedCategory,
    proposals: { txt, img },
    ambiguities: resolvedAmbiguities,
    summary: {
      primarySampler: sampler.selected
        ? publicCandidate(
          sampler.selected.nodeId,
          sampler.selected.node,
          { distanceToOutput: sampler.selected.distance },
        )
        : null,
      prompt: prompt.mapping
        ? publicCandidate(
          prompt.mapping.nodeId,
          workflow[prompt.mapping.nodeId],
          { fieldPath: prompt.mapping.fieldPath },
        )
        : null,
      negativePrompt: negativePrompt.mapping
        ? publicCandidate(
          negativePrompt.mapping.nodeId,
          workflow[negativePrompt.mapping.nodeId],
          { fieldPath: negativePrompt.mapping.fieldPath },
        )
        : null,
      seed: seed.mapping,
      width: width.mapping,
      height: height.mapping,
      batchSize: batch.mapping,
      mainImage: image.main
        ? publicCandidate(
          image.main.nodeId,
          image.main.node,
          { fieldPath: `inputs.${image.main.fieldName}` },
        )
        : null,
      extraImages: image.extras.map(candidate => publicCandidate(
        candidate.nodeId,
        candidate.node,
        { fieldPath: `inputs.${candidate.fieldName}` },
      )),
      mask: mask.mapping,
      outputs,
      suggestedControlCount: {
        txt: txtControls.length,
        img: imgControls.length,
      },
      optionalControls,
    },
  };
}
