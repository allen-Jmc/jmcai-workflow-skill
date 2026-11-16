// src/services/cloudSync/canonical.ts
var textEncoder = new TextEncoder();
function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item));
  const result = {};
  Object.keys(value).sort().forEach((key) => {
    const child = value[key];
    if (child !== void 0) result[key] = canonicalizeJson(child);
  });
  return result;
}
var canonicalStringify = (value) => JSON.stringify(canonicalizeJson(value));

// src/services/cloudSync/sanitizers.ts
var SECRET_KEY_RE = /(?:api.?key|authorization|access.?token|refresh.?token|password|secret|credential)/i;
var LOCAL_PATH_RE = /^(?:blob:|data:|idb:|file:|[a-z]:[\\/]|\\\\)/i;
var UNIX_LOCAL_PATH_RE = /^(?:~[\\/]|\/(?:Users|home|tmp|var\/tmp|private\/tmp)(?:\/|$))/i;
var URL_SCHEME_RE = /^(?:https?|wss?):\/\//i;
var SECRET_URL_PARAM_RE = /(?:^|[?#&])(?:api.?key|authorization|access.?token|refresh.?token|password|secret|credential)=/i;
var isPrivateIpv4 = (hostname) => {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first === 100 && second >= 64 && second <= 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
};
var isPrivateHostname = (rawHostname) => {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
  if (isPrivateIpv4(hostname)) return true;
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  if (/^fe[89ab]/i.test(hostname)) return true;
  if (hostname.startsWith("::ffff:")) return isPrivateIpv4(hostname.slice("::ffff:".length));
  return !hostname.includes(".") && !hostname.includes(":");
};
var getCloudSyncUnsafeStringReason = (value) => {
  const trimmed = value.trim();
  if (LOCAL_PATH_RE.test(trimmed) || UNIX_LOCAL_PATH_RE.test(trimmed)) return "local-reference";
  if (!URL_SCHEME_RE.test(trimmed) && !trimmed.startsWith("//")) return null;
  try {
    const url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    if (url.username || url.password || [...url.searchParams.keys()].some((key) => SECRET_KEY_RE.test(key)) || SECRET_URL_PARAM_RE.test(url.hash)) {
      return "sensitive-data";
    }
    return isPrivateHostname(url.hostname) ? "local-reference" : null;
  } catch {
    return SECRET_URL_PARAM_RE.test(trimmed) ? "sensitive-data" : null;
  }
};

// src/services/workflow/workflowLabAgentContract.ts
var WORKFLOW_LAB_AGENT_INTENT_TYPE = "JMCAI_WORKFLOW_INTENT_V1";
var WorkflowLabAgentError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "WorkflowLabAgentError";
    this.code = code;
    this.details = details;
  }
};
var WORKFLOW_LAB_AGENT_ERROR_CODES = /* @__PURE__ */ new Set([
  "E_SCHEMA_INVALID",
  "E_UNSUPPORTED_MODE",
  "E_ENUM_INVALID",
  "E_SOURCE_HASH_MISMATCH",
  "E_NODE_NOT_FOUND",
  "E_FIELD_PATH_NOT_FOUND",
  "E_FIELD_PATH_NOT_SCALAR",
  "E_SECRET_FIELD",
  "E_LOCAL_REFERENCE",
  "E_CONTROL_TYPE_CONFLICT",
  "E_NO_OUTPUT",
  "E_VALIDATION_FAILED",
  "E_DRY_RUN_FAILED",
  "E_AGENT_PRESET_MODIFIED",
  "E_PRESET_ID_CONFLICT",
  "E_BRIDGE_NOT_MOUNTED",
  "E_BRIDGE_PERMISSION",
  "E_BRIDGE_PATH_INVALID",
  "E_OUTBOX_WRITE_FAILED",
  "E_TIMEOUT",
  "E_JOB_ALREADY_PROCESSED"
]);
function isWorkflowLabAgentErrorCode(value) {
  return typeof value === "string" && WORKFLOW_LAB_AGENT_ERROR_CODES.has(value);
}
function asWorkflowLabAgentError(error, fallback = "E_SCHEMA_INVALID") {
  if (error instanceof WorkflowLabAgentError) return error;
  const candidate = error;
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  const messageCode = message.match(/^(E_[A-Z_]+)(?::|\b)/)?.[1];
  const permissionName = candidate?.name === "NotAllowedError" || candidate?.name === "SecurityError" || candidate?.code === "EACCES" || candidate?.code === "EPERM";
  const resolvedCode = isWorkflowLabAgentErrorCode(candidate?.code) ? candidate.code : isWorkflowLabAgentErrorCode(messageCode) ? messageCode : fallback;
  const code = permissionName ? "E_BRIDGE_PERMISSION" : resolvedCode;
  return new WorkflowLabAgentError(code, message, candidate?.details);
}
function normalizeWorkflowLabAgentBridgeWriteError(error) {
  const normalized = asWorkflowLabAgentError(error, "E_OUTBOX_WRITE_FAILED");
  if (normalized.code === "E_BRIDGE_PERMISSION") return normalized;
  return new WorkflowLabAgentError("E_OUTBOX_WRITE_FAILED", normalized.message, normalized.details);
}
var WORKFLOW_LAB_AGENT_JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
var WORKFLOW_LAB_AGENT_TERMINAL_JOB_STATUSES = ["applied", "unchanged", "failed"];
function isWorkflowLabAgentJobId(value) {
  return typeof value === "string" && WORKFLOW_LAB_AGENT_JOB_ID_PATTERN.test(value) && value !== "." && value !== ".." && value !== ".json" && !/[. ]$/.test(value);
}
function isWorkflowLabAgentTerminalJobResult(value, expectedIntentHash) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value;
  if (typeof record.status !== "string" || !WORKFLOW_LAB_AGENT_TERMINAL_JOB_STATUSES.includes(
    record.status
  )) return false;
  return !expectedIntentHash || record.intentHash === expectedIntentHash;
}
var SAFE_PRESET_NAME = /^[\p{L}\p{N} _.:/+()[\]-]{1,120}$/u;
var SECRET_KEY_PATTERN = /(?:api.?key|authorization|access.?token|refresh.?token|password|secret|credential|token)/i;
var SECRET_VALUE_PATTERN = /(?:\{\{(?:SECRET|PASSWORD|TOKEN|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|CREDENTIAL)_[A-Za-z0-9-]+\}\}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*|xox[baprs]-[A-Za-z0-9-]{8,}|(?:access_token|refresh_token|api_key|authorization)\s*[=:]\s*[^\s,;]+)/i;
var LOCAL_REFERENCE_KEY_PATTERN = /(?:file.?path|local.?path|asset.?id|asset.?storage.?key|storage.?key|browser.?profile|settings.?storage.?key)/i;
var LOCAL_REFERENCE_VALUE_PATTERN = /^(?:file:\/\/|idb:\/\/|blob:|data:|[A-Za-z]:[\\/]|\\\\|~[\\/]|\/(?:Users|home|tmp|var\/tmp|private\/tmp)(?:\/|$))/i;
var WORKFLOW_LAB_AGENT_INTENT_ROOT_KEYS = /* @__PURE__ */ new Set([
  "type",
  "jobId",
  "sourceHash",
  "workflow",
  "preset",
  "core",
  "controls",
  "outputNodeIds",
  "evidence"
]);
var CORE_KEYS = [
  "promptNode",
  "negativePromptNode",
  "seedNode",
  "widthNode",
  "heightNode",
  "batchSizeNode",
  "imageInputNode1",
  "maskInputNode"
];
var SHA256_INITIAL = [
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
];
var SHA256_CONSTANTS = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
function rotateRight(value, bits) {
  return value >>> bits | value << 32 - bits;
}
function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = [...SHA256_INITIAL];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const sigma0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ words[index - 15] >>> 3;
      const sigma1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ words[index - 2] >>> 10;
      words[index] = words[index - 16] + sigma0 + words[index - 7] + sigma1 >>> 0;
    }
    let workingA = hash[0];
    let workingB = hash[1];
    let workingC = hash[2];
    let workingD = hash[3];
    let workingE = hash[4];
    let workingF = hash[5];
    let workingG = hash[6];
    let workingH = hash[7];
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(workingE, 6) ^ rotateRight(workingE, 11) ^ rotateRight(workingE, 25);
      const choice = workingE & workingF ^ ~workingE & workingG;
      const temp1 = workingH + sigma1 + choice + SHA256_CONSTANTS[index] + words[index] >>> 0;
      const sigma0 = rotateRight(workingA, 2) ^ rotateRight(workingA, 13) ^ rotateRight(workingA, 22);
      const majority = workingA & workingB ^ workingA & workingC ^ workingB & workingC;
      const temp2 = sigma0 + majority >>> 0;
      workingH = workingG;
      workingG = workingF;
      workingF = workingE;
      workingE = workingD + temp1 >>> 0;
      workingD = workingC;
      workingC = workingB;
      workingB = workingA;
      workingA = temp1 + temp2 >>> 0;
    }
    hash[0] = hash[0] + workingA >>> 0;
    hash[1] = hash[1] + workingB >>> 0;
    hash[2] = hash[2] + workingC >>> 0;
    hash[3] = hash[3] + workingD >>> 0;
    hash[4] = hash[4] + workingE >>> 0;
    hash[5] = hash[5] + workingF >>> 0;
    hash[6] = hash[6] + workingG >>> 0;
    hash[7] = hash[7] + workingH >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}
function computeWorkflowSourceHash(workflow) {
  return sha256Hex(canonicalStringify(workflow));
}
function computeValidatedWorkflowLabAgentIntentHash(intent) {
  const controls = intent.controls.map((control) => ({
    id: control.id,
    label: control.label,
    group: control.group,
    nodeId: control.nodeId,
    fieldPath: control.fieldPath,
    preferredType: control.preferredType,
    min: control.min,
    max: control.max,
    step: control.step,
    options: control.options
  }));
  const core = CORE_KEYS.reduce((result, key) => {
    result[key] = intent.core[key];
    return result;
  }, {});
  return sha256Hex(canonicalStringify({
    sourceHash: intent.sourceHash,
    preset: {
      name: intent.preset.name,
      mode: intent.preset.mode,
      category: intent.preset.category,
      fork: intent.preset.fork === true
    },
    core,
    controls,
    outputNodeIds: [...intent.outputNodeIds || []].sort()
  }));
}
function computeWorkflowLabAgentIntentHash(raw) {
  return computeValidatedWorkflowLabAgentIntentHash(validateWorkflowLabAgentIntent(raw).intent);
}
function readWorkflowField(workflow, nodeId, fieldPath) {
  const node = workflow[nodeId];
  if (!node) return { exists: false, value: void 0 };
  const parts = fieldPath.split(".");
  if (parts[0] !== "inputs" || parts.length < 2) return { exists: false, value: void 0 };
  let current = node;
  for (const part of parts) {
    if (!part || typeof current !== "object" || current === null || Array.isArray(current)) {
      return { exists: false, value: void 0 };
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return { exists: false, value: void 0 };
    }
    current = current[part];
  }
  return { exists: true, value: current };
}
function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowLabAgentError("E_SCHEMA_INVALID", `${label} must be an object`);
  }
  return value;
}
function assertString(value, label, pattern) {
  if (typeof value !== "string" || !value.trim() || pattern && !pattern.test(value)) {
    throw new WorkflowLabAgentError("E_SCHEMA_INVALID", `${label} must be a valid string`);
  }
  return value.trim();
}
function assertEnum(value, values, label) {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new WorkflowLabAgentError("E_ENUM_INVALID", `${label} is not a supported enum value`);
  }
  return value;
}
function assertScalarField(workflow, nodeId, fieldPath) {
  const field = readWorkflowField(workflow, nodeId, fieldPath);
  if (!field.exists) {
    throw new WorkflowLabAgentError("E_FIELD_PATH_NOT_FOUND", `Field path ${fieldPath} is missing on node ${nodeId}`, { nodeId, fieldPath });
  }
  if (!["string", "number", "boolean"].includes(typeof field.value)) {
    throw new WorkflowLabAgentError("E_FIELD_PATH_NOT_SCALAR", `Field path ${fieldPath} on node ${nodeId} is not scalar`, { nodeId, fieldPath });
  }
}
function assertNodeMapping(workflow, value, label) {
  const mapping = assertPlainObject(value, label);
  const nodeId = assertString(mapping.nodeId, `${label}.nodeId`);
  const fieldPath = assertString(mapping.fieldPath, `${label}.fieldPath`);
  if (!Object.prototype.hasOwnProperty.call(workflow, nodeId)) {
    throw new WorkflowLabAgentError("E_NODE_NOT_FOUND", `Node ${nodeId} is missing`, { nodeId, fieldPath });
  }
  assertScalarField(workflow, nodeId, fieldPath);
  return { nodeId, fieldPath };
}
function assertMetadataSafe(value, key = "") {
  if (SECRET_KEY_PATTERN.test(key)) {
    throw new WorkflowLabAgentError("E_SECRET_FIELD", `Sensitive field ${key} is not allowed`);
  }
  if (LOCAL_REFERENCE_KEY_PATTERN.test(key)) {
    throw new WorkflowLabAgentError("E_LOCAL_REFERENCE", `Local reference field ${key} is not allowed`);
  }
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) {
      throw new WorkflowLabAgentError("E_SECRET_FIELD", `Sensitive value is not allowed in ${key || "metadata"}`);
    }
    if (LOCAL_REFERENCE_VALUE_PATTERN.test(value)) {
      throw new WorkflowLabAgentError("E_LOCAL_REFERENCE", `Local reference value is not allowed in ${key || "metadata"}`);
    }
    const unsafeReason = getCloudSyncUnsafeStringReason(value);
    if (unsafeReason === "sensitive-data") {
      throw new WorkflowLabAgentError("E_SECRET_FIELD", `Sensitive URL is not allowed in ${key || "metadata"}`);
    }
    if (unsafeReason === "local-reference") {
      throw new WorkflowLabAgentError("E_LOCAL_REFERENCE", `Local URL is not allowed in ${key || "metadata"}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertMetadataSafe(item, key));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, child]) => assertMetadataSafe(child, childKey));
  }
}
function normalizeWorkflow(value) {
  const workflow = assertPlainObject(value, "workflow");
  Object.entries(workflow).forEach(([nodeId, nodeValue]) => {
    const node = assertPlainObject(nodeValue, `workflow.${nodeId}`);
    if (typeof node.class_type !== "string" || !node.class_type.trim()) {
      throw new WorkflowLabAgentError("E_SCHEMA_INVALID", `workflow.${nodeId}.class_type is required`);
    }
    assertPlainObject(node.inputs || {}, `workflow.${nodeId}.inputs`);
  });
  return workflow;
}
function normalizeCore(value, workflow) {
  const core = assertPlainObject(value, "core");
  const result = {};
  CORE_KEYS.forEach((key) => {
    if (core[key] === void 0) return;
    result[key] = assertNodeMapping(workflow, core[key], `core.${key}`);
  });
  return result;
}
function normalizeControls(value, workflow, controlTypes) {
  if (!Array.isArray(value)) {
    throw new WorkflowLabAgentError("E_SCHEMA_INVALID", "controls must be an array");
  }
  return value.map((entry, index) => {
    const control = assertPlainObject(entry, `controls[${index}]`);
    const nodeId = assertString(control.nodeId, `controls[${index}].nodeId`);
    const fieldPath = assertString(control.fieldPath, `controls[${index}].fieldPath`);
    if (!Object.prototype.hasOwnProperty.call(workflow, nodeId)) {
      throw new WorkflowLabAgentError("E_NODE_NOT_FOUND", `Node ${nodeId} is missing`, { nodeId, fieldPath });
    }
    assertScalarField(workflow, nodeId, fieldPath);
    const preferredType = control.preferredType === void 0 ? void 0 : assertEnum(control.preferredType, controlTypes, `controls[${index}].preferredType`);
    const numeric = (name) => {
      if (control[name] === void 0) return void 0;
      if (typeof control[name] !== "number" || !Number.isFinite(control[name])) {
        throw new WorkflowLabAgentError("E_SCHEMA_INVALID", `controls[${index}].${name} must be a finite number`);
      }
      return control[name];
    };
    const options = control.options === void 0 ? void 0 : (() => {
      if (!Array.isArray(control.options) || control.options.some((option) => typeof option !== "string")) {
        throw new WorkflowLabAgentError("E_SCHEMA_INVALID", `controls[${index}].options must be a string array`);
      }
      return control.options;
    })();
    return {
      id: control.id === void 0 ? void 0 : assertString(control.id, `controls[${index}].id`),
      label: control.label === void 0 ? void 0 : assertString(control.label, `controls[${index}].label`),
      group: control.group === void 0 ? void 0 : assertString(control.group, `controls[${index}].group`),
      nodeId,
      fieldPath,
      preferredType,
      min: numeric("min"),
      max: numeric("max"),
      step: numeric("step"),
      options
    };
  });
}
function createWorkflowLabAgentValidatorOptions() {
  return {
    modes: ["txt", "img"],
    categories: ["generate", "edit"],
    controlTypes: [
      "slider",
      "number_input",
      "text_input",
      "switch",
      "dropdown",
      "color_picker",
      "image_upload",
      "audio_upload",
      "video_upload",
      "camera_pose",
      "camera_control"
    ]
  };
}
function validateWorkflowLabAgentIntent(raw) {
  const input = assertPlainObject(raw, "intent");
  if (input.type !== WORKFLOW_LAB_AGENT_INTENT_TYPE) {
    throw new WorkflowLabAgentError("E_SCHEMA_INVALID", "Unsupported intent type");
  }
  const unknownKeys = Object.keys(input).filter((key) => !WORKFLOW_LAB_AGENT_INTENT_ROOT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new WorkflowLabAgentError("E_SCHEMA_INVALID", `Unsupported intent field ${unknownKeys[0]}`);
  }
  const options = createWorkflowLabAgentValidatorOptions();
  const jobId = assertString(input.jobId, "jobId");
  if (!isWorkflowLabAgentJobId(jobId)) {
    throw new WorkflowLabAgentError("E_SCHEMA_INVALID", "jobId must be a safe bridge file name");
  }
  const workflow = normalizeWorkflow(input.workflow);
  assertMetadataSafe(workflow);
  const sourceHash = assertString(input.sourceHash, "sourceHash", /^[a-f0-9]{64}$/);
  const computedSourceHash = computeWorkflowSourceHash(workflow);
  if (sourceHash !== computedSourceHash) {
    throw new WorkflowLabAgentError("E_SOURCE_HASH_MISMATCH", "sourceHash does not match workflow", {
      expected: computedSourceHash,
      received: sourceHash
    });
  }
  const metadata = { ...input };
  delete metadata.workflow;
  assertMetadataSafe(metadata);
  const presetInput = assertPlainObject(input.preset, "preset");
  if (presetInput.mode === "plugin") {
    throw new WorkflowLabAgentError("E_UNSUPPORTED_MODE", "PLUGIN mode does not support Agent-generated presets", {
      mode: presetInput.mode
    });
  }
  const mode = assertEnum(presetInput.mode, options.modes, "preset.mode");
  const preset = {
    name: assertString(presetInput.name, "preset.name", SAFE_PRESET_NAME),
    mode,
    category: assertEnum(presetInput.category, options.categories, "preset.category"),
    ...presetInput.fork === true ? { fork: true } : {}
  };
  const core = normalizeCore(input.core, workflow);
  const controls = normalizeControls(input.controls, workflow, options.controlTypes);
  const outputNodeIds = input.outputNodeIds === void 0 ? void 0 : (() => {
    if (!Array.isArray(input.outputNodeIds) || input.outputNodeIds.some((nodeId) => typeof nodeId !== "string")) {
      throw new WorkflowLabAgentError("E_SCHEMA_INVALID", "outputNodeIds must be a string array");
    }
    const nodeIds = [...new Set(input.outputNodeIds.map((nodeId) => nodeId.trim()))];
    nodeIds.forEach((nodeId) => {
      if (!Object.prototype.hasOwnProperty.call(workflow, nodeId)) {
        throw new WorkflowLabAgentError("E_NODE_NOT_FOUND", `Output node ${nodeId} is missing`, { nodeId });
      }
    });
    return nodeIds;
  })();
  const evidence = input.evidence === void 0 ? void 0 : assertPlainObject(input.evidence, "evidence");
  const intent = {
    type: WORKFLOW_LAB_AGENT_INTENT_TYPE,
    jobId,
    sourceHash,
    workflow,
    preset,
    core,
    controls,
    ...outputNodeIds ? { outputNodeIds } : {},
    ...evidence ? { evidence } : {}
  };
  return { intent, sourceHash: computedSourceHash };
}

// src/types.ts
var AssetType = /* @__PURE__ */ ((AssetType2) => {
  AssetType2["IMAGE"] = "IMAGE";
  AssetType2["VIDEO"] = "VIDEO";
  AssetType2["AUDIO"] = "AUDIO";
  AssetType2["TEXT"] = "TEXT";
  AssetType2["REFERENCE"] = "REFERENCE";
  AssetType2["ARTBOARD"] = "ARTBOARD";
  return AssetType2;
})(AssetType || {});
var UIControlType = /* @__PURE__ */ ((UIControlType2) => {
  UIControlType2["SLIDER"] = "slider";
  UIControlType2["NUMBER_INPUT"] = "number_input";
  UIControlType2["TEXT_INPUT"] = "text_input";
  UIControlType2["SWITCH"] = "switch";
  UIControlType2["DROPDOWN"] = "dropdown";
  UIControlType2["COLOR_PICKER"] = "color_picker";
  UIControlType2["IMAGE_UPLOAD"] = "image_upload";
  UIControlType2["AUDIO_UPLOAD"] = "audio_upload";
  UIControlType2["VIDEO_UPLOAD"] = "video_upload";
  UIControlType2["CAMERA_POSE"] = "camera_pose";
  UIControlType2["CAMERA_CONTROL"] = "camera_control";
  return UIControlType2;
})(UIControlType || {});

// src/services/workflow/outputMapping.ts
var AUDIO_PATTERNS = ["saveaudio", "previewaudio", "audiooutput", "audiopreview", "save audio", "audio output", "export audio"];
var VIDEO_PATTERNS = ["savevideo", "vhsvideocombine", "videocombine", "videooutput", "saveanimatedwebp", "savegif", "save video", "video output", "export video"];
var IMAGE_PATTERNS = ["saveimage", "previewimage", "imageoutput", "save image", "preview image", "image output"];
var TEXT_PATTERNS = ["savetext", "previewtext", "showtext", "textoutput", "save text", "text output"];
var INPUT_NODE_PATTERNS = ["loadaudio", "loadvideo", "loadimage", "upload", "input"];
var normalize = (value) => typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
var normalizeWords = (value) => typeof value === "string" ? value.toLowerCase().replace(/[_-]+/g, " ") : "";
var includesAny = (haystack, patterns) => patterns.some((pattern) => haystack.includes(pattern));
function nodeLabel(id, node) {
  const title = node._meta?.title || node.title || node.class_type;
  return typeof title === "string" && title.trim() ? title.trim() : `Node ${id}`;
}
function normalizeAssetType(value) {
  const raw = typeof value === "string" ? value.toUpperCase().trim() : "";
  if (raw === "AUDIO" /* AUDIO */) return "AUDIO" /* AUDIO */;
  if (raw === "VIDEO" /* VIDEO */) return "VIDEO" /* VIDEO */;
  if (raw === "TEXT" /* TEXT */) return "TEXT" /* TEXT */;
  if (raw === "REFERENCE" /* REFERENCE */) return "REFERENCE" /* REFERENCE */;
  if (raw === "ARTBOARD" /* ARTBOARD */) return "ARTBOARD" /* ARTBOARD */;
  return "IMAGE" /* IMAGE */;
}
function inferNodeOutputType(node) {
  const compact = `${normalize(node.class_type)} ${normalize(node._meta?.title)} ${normalize(node.title)}`;
  const words = `${normalizeWords(node.class_type)} ${normalizeWords(node._meta?.title)} ${normalizeWords(node.title)}`;
  if (includesAny(compact, INPUT_NODE_PATTERNS)) return null;
  if (includesAny(compact, AUDIO_PATTERNS) || includesAny(words, AUDIO_PATTERNS)) return "AUDIO" /* AUDIO */;
  if (includesAny(compact, VIDEO_PATTERNS) || includesAny(words, VIDEO_PATTERNS)) return "VIDEO" /* VIDEO */;
  if (includesAny(compact, IMAGE_PATTERNS) || includesAny(words, IMAGE_PATTERNS)) return "IMAGE" /* IMAGE */;
  if (includesAny(compact, TEXT_PATTERNS) || includesAny(words, TEXT_PATTERNS)) return "TEXT" /* TEXT */;
  return null;
}
function legacyOutputFromNode(nodeId, workflow) {
  const node = workflow[nodeId];
  return {
    id: "legacy",
    nodeId,
    type: node ? inferNodeOutputType(node) ?? "IMAGE" /* IMAGE */ : "IMAGE" /* IMAGE */,
    label: node ? nodeLabel(nodeId, node) : "Main Output"
  };
}
function inferWorkflowOutputMappings(workflow) {
  return Object.entries(workflow).flatMap(([nodeId, node]) => {
    const type = inferNodeOutputType(node);
    if (!type) return [];
    return [{
      id: `out-${nodeId}`,
      nodeId,
      type,
      label: nodeLabel(nodeId, node)
    }];
  });
}
function normalizeConfiguredOutputMappings(outputs, inferredByNode) {
  return outputs.map((output) => {
    const inferred = inferredByNode.get(output.nodeId);
    return {
      ...output,
      type: inferred?.type ?? normalizeAssetType(output.type)
    };
  });
}
function withInferredOutputMappings(preset) {
  const explicitOutputs = preset.mapping?.outputs;
  const workflow = preset.workflow || {};
  const legacyOutputNodeId = preset.mapping?.outputNode?.nodeId;
  const inferredByNode = new Map(inferWorkflowOutputMappings(workflow).map((output) => [output.nodeId, output]));
  const outputs = explicitOutputs !== void 0 ? normalizeConfiguredOutputMappings(explicitOutputs, inferredByNode) : legacyOutputNodeId ? [legacyOutputFromNode(legacyOutputNodeId, workflow)] : [...inferredByNode.values()];
  const previousOutputs = explicitOutputs || [];
  const unchanged = outputs.length === previousOutputs.length && outputs.every((output, index) => output === previousOutputs[index] || output.id === previousOutputs[index]?.id && output.nodeId === previousOutputs[index]?.nodeId && output.type === previousOutputs[index]?.type && output.label === previousOutputs[index]?.label);
  const hasLegacyFallbackAlongsideExplicitOutputs = explicitOutputs !== void 0 && preset.mapping?.outputNode !== void 0;
  if (unchanged && !hasLegacyFallbackAlongsideExplicitOutputs) return preset;
  const { outputNode: _legacyOutputNode, ...mappingWithoutLegacyOutput } = preset.mapping || {};
  return {
    ...preset,
    mapping: {
      ...explicitOutputs !== void 0 ? mappingWithoutLegacyOutput : preset.mapping,
      outputs
    }
  };
}

// src/services/workflow/presetCompat.ts
var UI_CONTROL_TYPE_ALIASES = {
  SLIDER: "slider" /* SLIDER */,
  NUMBER_INPUT: "number_input" /* NUMBER_INPUT */,
  NUMBER: "number_input" /* NUMBER_INPUT */,
  TEXT_INPUT: "text_input" /* TEXT_INPUT */,
  TEXT: "text_input" /* TEXT_INPUT */,
  SWITCH: "switch" /* SWITCH */,
  DROPDOWN: "dropdown" /* DROPDOWN */,
  SELECT: "dropdown" /* DROPDOWN */,
  COLOR_PICKER: "color_picker" /* COLOR_PICKER */,
  IMAGE_UPLOAD: "image_upload" /* IMAGE_UPLOAD */,
  AUDIO_UPLOAD: "audio_upload" /* AUDIO_UPLOAD */,
  VIDEO_UPLOAD: "video_upload" /* VIDEO_UPLOAD */,
  CAMERA_POSE: "camera_pose" /* CAMERA_POSE */,
  CAMERA_CONTROL: "camera_control" /* CAMERA_CONTROL */
};
var ASSET_TYPE_ALIASES = {
  IMAGE: "IMAGE" /* IMAGE */,
  IMG: "IMAGE" /* IMAGE */,
  VIDEO: "VIDEO" /* VIDEO */,
  AUDIO: "AUDIO" /* AUDIO */,
  TEXT: "TEXT" /* TEXT */,
  REFERENCE: "REFERENCE" /* REFERENCE */,
  ARTBOARD: "ARTBOARD" /* ARTBOARD */
};
function normalizeMode(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "img" /* IMG */ || raw === "image" || raw === "img2img" || raw.includes("img")) return "img" /* IMG */;
  if (raw === "plugin" /* PLUGIN */ || raw === "tool") return "plugin" /* PLUGIN */;
  return "txt" /* TXT */;
}
function normalizeUIControlType(value) {
  const raw = String(value || "").trim();
  const directValues = new Set(Object.values(UIControlType));
  if (directValues.has(raw)) return raw;
  return UI_CONTROL_TYPE_ALIASES[raw.toUpperCase()] || "text_input" /* TEXT_INPUT */;
}
function normalizeAssetType2(value) {
  const raw = String(value || "").trim();
  const directValues = new Set(Object.values(AssetType));
  if (directValues.has(raw)) return raw;
  return ASSET_TYPE_ALIASES[raw.toUpperCase()] || "IMAGE" /* IMAGE */;
}
function normalizeUIConfig(fields) {
  return (fields || []).map((field) => {
    const normalizedField = {
      ...field,
      type: normalizeUIControlType(field.type)
    };
    if (!isUploadPruneConfig(field.uploadPrune)) {
      delete normalizedField.uploadPrune;
      return normalizedField;
    }
    const removeNodeIds = field.uploadPrune.removeNodeIds.filter((nodeId) => typeof nodeId === "string" || typeof nodeId === "number").map((nodeId) => String(nodeId).trim()).filter(Boolean);
    const removeInputs = Array.isArray(field.uploadPrune.removeInputs) ? field.uploadPrune.removeInputs.filter((item) => item && typeof item.nodeId === "string" && typeof item.fieldPath === "string" && item.nodeId.trim() && item.fieldPath.trim()).map((item) => ({
      nodeId: item.nodeId.trim(),
      fieldPath: item.fieldPath.trim()
    })) : [];
    normalizedField.uploadPrune = {
      ...typeof field.uploadPrune.order === "number" && Number.isFinite(field.uploadPrune.order) ? { order: Math.floor(field.uploadPrune.order) } : {},
      ...typeof field.uploadPrune.required === "boolean" ? { required: field.uploadPrune.required } : {},
      removeNodeIds,
      ...removeInputs.length > 0 ? { removeInputs } : {}
    };
    return normalizedField;
  });
}
function isUploadPruneConfig(value) {
  return Boolean(
    value && typeof value === "object" && Array.isArray(value.removeNodeIds)
  );
}
function normalizeMapping(mapping) {
  const nextMapping = { ...mapping || {} };
  if (nextMapping.outputs) {
    nextMapping.outputs = nextMapping.outputs.map((output) => ({
      ...output,
      type: normalizeAssetType2(output.type)
    }));
  }
  return nextMapping;
}
function normalizeWorkflowPreset(preset) {
  const normalizedPreset = {
    ...preset,
    mode: normalizeMode(preset.mode),
    mapping: normalizeMapping(preset.mapping),
    ui_config: normalizeUIConfig(preset.ui_config)
  };
  if (typeof normalizedPreset.ui_groups_default_expanded !== "boolean") {
    delete normalizedPreset.ui_groups_default_expanded;
  }
  return withInferredOutputMappings(normalizedPreset);
}

// ../jmcai-workflow-skill/scripts/runtime-shims/comfyMetadataService.mjs
var RESOURCE_KINDS = [
  "checkpoint",
  "lora",
  "vae",
  "controlnet",
  "sampler",
  "scheduler",
  "unet",
  "clip",
  "upscale_model",
  "style_model",
  "embedding",
  "ipadapter",
  "video_model"
];
var RESOURCE_COMBO_FIELDS = {
  checkpoint: ["ckpt_name"],
  lora: ["lora_name"],
  vae: ["vae_name"],
  controlnet: ["control_net_name"],
  sampler: ["sampler_name"],
  scheduler: ["scheduler"],
  unet: ["unet_name", "diffusion_model_name"],
  clip: ["clip_name", "clip_name1", "clip_name2"],
  upscale_model: ["upscale_model_name"],
  style_model: ["style_model_name"],
  embedding: ["embedding_name"],
  ipadapter: ["ipadapter_file", "ipadapter_name"],
  video_model: ["video_model_name"]
};
var NODE_CLASS_RESOURCE_FIELDS = [
  { nodeClass: /CheckpointLoader/i, inputName: /^(ckpt_name|checkpoint|checkpoint_name)$/i, kind: "checkpoint" },
  { nodeClass: /(?:LoraLoader|Lora Loader|Power Lora)/i, inputName: /^(?:lora(?:_name)?|lora_\d+\.(?:lora|name))$/i, kind: "lora" },
  { nodeClass: /VAELoader/i, inputName: /^vae_name$/i, kind: "vae" },
  { nodeClass: /ControlNet/i, inputName: /^(control_net_name|controlnet_name)$/i, kind: "controlnet" },
  { nodeClass: /KSampler|Sampler/i, inputName: /^sampler_name$/i, kind: "sampler" },
  { nodeClass: /KSampler|Sampler/i, inputName: /^scheduler$/i, kind: "scheduler" },
  { nodeClass: /UNET|Diffusion/i, inputName: /^(unet_name|diffusion_model_name|model_name)$/i, kind: "unet" },
  { nodeClass: /CLIP/i, inputName: /^(clip_name|clip_name1|clip_name2|model_name)$/i, kind: "clip" },
  { nodeClass: /Upscale/i, inputName: /^(model_name|upscale_model_name)$/i, kind: "upscale_model" },
  { nodeClass: /StyleModel/i, inputName: /^(style_model_name|model_name)$/i, kind: "style_model" },
  { nodeClass: /Embedding/i, inputName: /^(embedding_name|model_name)$/i, kind: "embedding" },
  { nodeClass: /IPAdapter/i, inputName: /^(ipadapter_file|ipadapter_name|model_name)$/i, kind: "ipadapter" },
  { nodeClass: /AnimateDiff|Wan|HunyuanVideo|Video|VHS/i, inputName: /^(video_model_name|model_name|unet_name)$/i, kind: "video_model" }
];
var inferComfyResourceKind = (inputName, nodeClass = "") => {
  const normalizedInputName = inputName.trim();
  const normalizedNodeClass = nodeClass.trim();
  if (/^lora_\d+\.(?:lora|name)$/i.test(normalizedInputName)) return "lora";
  const exact = NODE_CLASS_RESOURCE_FIELDS.find(
    (item) => item.nodeClass.test(normalizedNodeClass) && item.inputName.test(normalizedInputName)
  );
  if (exact) return exact.kind;
  return RESOURCE_KINDS.find(
    (kind) => RESOURCE_COMBO_FIELDS[kind].includes(normalizedInputName)
  );
};

// src/services/workflow/uiConfigInference.ts
var SEMANTIC_DROPDOWN_FIELD = /^(?:aspect_ratio|ratio|output_ratio|resolution_ratio|resolution_preset)$/i;
var SEMANTIC_IMAGE_FIELD = /^(?:image|image\d+|img|mask|pixels?|pixel_image|(?:input|source|reference|masked)_image)$/i;
var SEMANTIC_AUDIO_FIELD = /^(?:audio|sound|voice|audio_(?:file|path)|input_audio)$/i;
var SEMANTIC_VIDEO_FIELD = /^(?:video|movie|video_(?:file|path)|input_video|video_clip)$/i;
var SLIDER_FIELD_DEFAULTS = [
  { pattern: /^denoise$/i, min: 0, max: 1, step: 0.01 },
  { pattern: /^cfg$/i, min: 0, max: 30, step: 0.1 },
  { pattern: /^guidance$/i, min: 0, max: 30, step: 0.1 },
  { pattern: /^shift$/i, min: 0, max: 20, step: 0.1 },
  { pattern: /^strength_model$|^strength_clip$/i, min: -10, max: 10, step: 0.01 },
  { pattern: /^strength$/i, min: -10, max: 10, step: 0.01 }
];
function createUIConfigFromWorkflowField(input) {
  const resourceFieldName = input.fieldPath.replace(/^inputs\./, "");
  const resourceKind = inferComfyResourceKind(input.fieldName, input.nodeClass) || inferComfyResourceKind(resourceFieldName, input.nodeClass);
  const numericInference = inferNumericControl(input.fieldName, input.value, input.inputSchema);
  const type = inferControlType(
    input.fieldName,
    input.value,
    input.inputSchema,
    resourceKind,
    numericInference
  );
  const defaultValue = normalizeDefaultValue(input.value ?? input.inputSchema?.defaultValue);
  const labelBase = input.nodeTitle?.trim() || input.nodeClass || `Node ${input.nodeId}`;
  const options = input.inputSchema?.kind === "combo" ? input.inputSchema.options || [] : defaultValue === void 0 || defaultValue === null ? [] : [String(defaultValue)];
  return {
    id: input.id,
    nodeId: input.nodeId,
    fieldPath: input.fieldPath,
    label: `${labelBase} ${input.fieldName.replace(/_/g, " ")}`.trim(),
    type,
    group: resourceKind ? "ComfyUI Resources" : "GENERAL",
    defaultValue,
    workflowDefaultValue: defaultValue,
    ...numericInference ? {
      min: numericInference.min,
      max: numericInference.max,
      step: numericInference.step
    } : {},
    ...type === "dropdown" /* DROPDOWN */ ? {
      options,
      optionSource: {
        type: "comfy_object_info",
        scope: "default_node",
        nodeClass: input.nodeClass,
        inputName: input.fieldName,
        resourceKind
      }
    } : {}
  };
}
function inferControlType(fieldName, value, schema, resourceKind, numericInference) {
  if (resourceKind) return "dropdown" /* DROPDOWN */;
  const semanticMediaType = inferSemanticMediaControl(fieldName);
  if (semanticMediaType) return semanticMediaType;
  if (schema?.kind === "combo") return "dropdown" /* DROPDOWN */;
  if (schema?.kind === "number") return numericInference?.type || "number_input" /* NUMBER_INPUT */;
  if (schema?.kind === "boolean") return "switch" /* SWITCH */;
  if (schema?.kind === "string") return "text_input" /* TEXT_INPUT */;
  if (schema?.kind === "image") return "image_upload" /* IMAGE_UPLOAD */;
  if (schema?.kind === "audio") return "audio_upload" /* AUDIO_UPLOAD */;
  if (schema?.kind === "video") return "video_upload" /* VIDEO_UPLOAD */;
  const lowerName = fieldName.toLowerCase();
  if (SEMANTIC_DROPDOWN_FIELD.test(fieldName)) return "dropdown" /* DROPDOWN */;
  if (/image|img|mask/.test(lowerName)) return "image_upload" /* IMAGE_UPLOAD */;
  if (/audio|sound|voice/.test(lowerName)) return "audio_upload" /* AUDIO_UPLOAD */;
  if (/video|movie|clip/.test(lowerName)) return "video_upload" /* VIDEO_UPLOAD */;
  if (typeof value === "number") return numericInference?.type || "number_input" /* NUMBER_INPUT */;
  if (typeof value === "boolean") return "switch" /* SWITCH */;
  return "text_input" /* TEXT_INPUT */;
}
function inferSemanticMediaControl(fieldName) {
  if (SEMANTIC_IMAGE_FIELD.test(fieldName)) return "image_upload" /* IMAGE_UPLOAD */;
  if (SEMANTIC_AUDIO_FIELD.test(fieldName)) return "audio_upload" /* AUDIO_UPLOAD */;
  if (SEMANTIC_VIDEO_FIELD.test(fieldName)) return "video_upload" /* VIDEO_UPLOAD */;
  return void 0;
}
function inferNumericControl(fieldName, value, schema) {
  if (schema && schema.kind !== "number") return void 0;
  if (schema?.kind !== "number" && typeof value !== "number") return void 0;
  const fallback = SLIDER_FIELD_DEFAULTS.find((item) => item.pattern.test(fieldName));
  return {
    type: fallback ? "slider" /* SLIDER */ : "number_input" /* NUMBER_INPUT */,
    min: schema?.kind === "number" ? schema.min ?? fallback?.min : fallback?.min,
    max: schema?.kind === "number" ? schema.max ?? fallback?.max : fallback?.max,
    step: schema?.kind === "number" ? schema.step ?? fallback?.step : fallback?.step
  };
}
function normalizeDefaultValue(value) {
  if (value === void 0 || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return void 0;
}

// src/services/workflow/utils.ts
var cloneWorkflow = (workflow) => JSON.parse(JSON.stringify(workflow));
var setDeepValue = (obj, path, value) => {
  if (!path || value === void 0 || value === null) return;
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null || Array.isArray(current[key])) current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
};

// src/services/workflow/validator.ts
var validatePreset = (preset) => {
  const errors = [];
  const workflow = preset.workflow || {};
  const mapping = preset.mapping || {};
  const caps = { size: false, batch: false, seed: false, prompt: false, image: false, mask: false };
  const check = (nodeId, label, capKey, required = false) => {
    if (!nodeId) {
      if (required) errors.push(`${label} \u672A\u914D\u7F6E\u6620\u5C04`);
      return;
    }
    if (!workflow[nodeId]) {
      errors.push(`${label} \u8282\u70B9 #${nodeId} \u7269\u7406\u4E22\u5931`);
      return;
    }
    if (capKey) caps[capKey] = true;
  };
  const isTxt = preset.mode === "txt" /* TXT */;
  const isImg = preset.mode === "img" /* IMG */;
  const hasPromptInUI = preset.ui_config?.some((cfg) => {
    if (cfg.type !== "text_input" /* TEXT_INPUT */) return false;
    const node = workflow[cfg.nodeId];
    if (!node) return false;
    const classType = (node.class_type || "").toLowerCase();
    const title = (node._meta?.title || node.title || "").toLowerCase();
    const field = (cfg.fieldPath || "").toLowerCase();
    return classType.includes("cliptextencode") || classType.includes("conditioning") || title.includes("prompt") || title.includes("\u63D0\u793A\u8BCD") || field.includes("text") || field.includes("string");
  });
  const promptMapping = mapping.promptNode;
  const hasPromptNode = Boolean(promptMapping?.nodeId);
  const hasPromptField = Boolean(promptMapping?.fieldPath?.trim());
  const promptNodeExists = Boolean(promptMapping?.nodeId && workflow[promptMapping.nodeId]);
  if (!hasPromptNode) {
    if (isTxt && !hasPromptInUI) errors.push("\u6B63\u9762\u63D0\u793A\u8BCD \u672A\u914D\u7F6E\u6620\u5C04");
  } else if (!promptNodeExists) {
    errors.push(`\u6B63\u9762\u63D0\u793A\u8BCD \u8282\u70B9 #${promptMapping?.nodeId} \u7269\u7406\u4E22\u5931`);
  } else if (!hasPromptField) {
    if (isTxt && !hasPromptInUI) errors.push("\u6B63\u9762\u63D0\u793A\u8BCD \u672A\u914D\u7F6E\u6620\u5C04");
  } else {
    caps.prompt = true;
  }
  check(mapping.widthNode?.nodeId, "\u5BBD\u5EA6", "size");
  check(mapping.heightNode?.nodeId, "\u9AD8\u5EA6", "size");
  check(mapping.seedNode?.nodeId, "\u79CD\u5B50", "seed");
  check(mapping.batchSizeNode?.nodeId, "\u6279\u6B21", "batch");
  const hasImageInUI = preset.ui_config?.some((cfg) => {
    const node = workflow[cfg.nodeId];
    if (!node) return false;
    const classType = (node.class_type || "").toLowerCase();
    const title = (node._meta?.title || node.title || "").toLowerCase();
    const field = (cfg.fieldPath || "").toLowerCase();
    return classType.includes("loadimage") || classType.includes("inputimage") || title.includes("image") || title.includes("\u56FE\u7247") || field.includes("image");
  });
  if (isImg) {
    check(mapping.imageInputNode1?.nodeId, "\u4E3B\u56FE\u8F93\u5165", "image", !hasImageInUI);
    if (hasImageInUI) caps.image = true;
    check(mapping.maskInputNode?.nodeId, "\u906E\u7F69\u8F93\u5165", "mask");
  }
  return { valid: errors.length === 0, errors, capabilities: caps };
};

// src/services/workflow/workflowLabAgentCompiler.ts
var CORE_KEYS2 = [
  "promptNode",
  "negativePromptNode",
  "seedNode",
  "widthNode",
  "heightNode",
  "batchSizeNode",
  "imageInputNode1",
  "maskInputNode"
];
function stableHashPart(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function buildWorkflowLabAgentPresetId(intent) {
  const base = `${intent.sourceHash}:${intent.preset.name}:${intent.preset.mode}:${intent.preset.category}`;
  const fork = intent.preset.fork ? `:${intent.jobId}` : "";
  return `agent-${stableHashPart(`${base}${fork}`)}-${stableHashPart(`${fork}${base}`)}`;
}
function buildControlId(intent, control, index) {
  if (control.id) return `lab-${stableHashPart(`${intent.sourceHash}:${control.id}`)}`;
  return `lab-${stableHashPart(`${intent.sourceHash}:${control.nodeId}:${control.fieldPath}:${index}`)}`;
}
function fieldNameFromPath(fieldPath) {
  const parts = fieldPath.split(".");
  return parts[parts.length - 1] || fieldPath;
}
function scalarSentinel(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  return "__JMCAI_AGENT_DRY_RUN__";
}
function assertDryRun(preset) {
  const workflow = cloneWorkflow(preset.workflow);
  const inject = (mapping, value) => {
    if (!mapping?.nodeId || !mapping.fieldPath) return;
    setDeepValue(workflow[mapping.nodeId], mapping.fieldPath, value);
    const injected = readWorkflowField(workflow, mapping.nodeId, mapping.fieldPath);
    if (!injected.exists || injected.value !== value) {
      throw new WorkflowLabAgentError("E_DRY_RUN_FAILED", `Dry-run injection failed for ${mapping.nodeId}.${mapping.fieldPath}`);
    }
  };
  CORE_KEYS2.forEach((key) => {
    const mapping = preset.mapping[key];
    if (!mapping) return;
    const original = readWorkflowField(preset.workflow, mapping.nodeId, mapping.fieldPath);
    inject(mapping, scalarSentinel(original.value));
  });
  preset.ui_config.forEach((config) => {
    const original = readWorkflowField(preset.workflow, config.nodeId, config.fieldPath);
    inject({ nodeId: config.nodeId, fieldPath: config.fieldPath }, scalarSentinel(original.value));
  });
}
function compileWorkflowLabAgentIntent(raw) {
  const validated = validateWorkflowLabAgentIntent(raw);
  const { intent } = validated;
  const intentHash = computeValidatedWorkflowLabAgentIntentHash(intent);
  const mapping = {};
  CORE_KEYS2.forEach((key) => {
    const value = intent.core[key];
    if (value) mapping[key] = { nodeId: value.nodeId, fieldPath: value.fieldPath };
  });
  const outputMappings = inferWorkflowOutputMappings(intent.workflow).filter((output) => !intent.outputNodeIds || intent.outputNodeIds.includes(output.nodeId));
  if (outputMappings.length === 0) {
    throw new WorkflowLabAgentError("E_NO_OUTPUT", "No supported ComfyUI output node was found");
  }
  mapping.outputs = outputMappings;
  const used = /* @__PURE__ */ new Set();
  const ui_config = intent.controls.map((control, index) => {
    const field = readWorkflowField(intent.workflow, control.nodeId, control.fieldPath);
    const node = intent.workflow[control.nodeId];
    const inferred = createUIConfigFromWorkflowField({
      id: buildControlId(intent, control, index),
      nodeId: control.nodeId,
      nodeClass: String(node.class_type || ""),
      nodeTitle: typeof node._meta?.title === "string" ? node._meta.title : typeof node.title === "string" ? node.title : void 0,
      fieldName: fieldNameFromPath(control.fieldPath),
      fieldPath: control.fieldPath,
      value: field.value
    });
    if (control.preferredType && control.preferredType !== inferred.type) {
      throw new WorkflowLabAgentError("E_CONTROL_TYPE_CONFLICT", `Preferred control type ${control.preferredType} conflicts with inferred ${inferred.type}`, {
        nodeId: control.nodeId,
        fieldPath: control.fieldPath,
        inferredType: inferred.type
      });
    }
    const config = {
      ...inferred,
      label: control.label || inferred.label,
      ...control.group ? { group: control.group } : {},
      ...control.min !== void 0 ? { min: control.min } : {},
      ...control.max !== void 0 ? { max: control.max } : {},
      ...control.step !== void 0 ? { step: control.step } : {},
      ...control.options ? { options: control.options } : {}
    };
    const identity = `${config.nodeId}:${config.fieldPath}`;
    if (used.has(identity)) {
      throw new WorkflowLabAgentError("E_SCHEMA_INVALID", `Duplicate control target ${identity}`);
    }
    used.add(identity);
    return config;
  });
  const preset = normalizeWorkflowPreset({
    id: buildWorkflowLabAgentPresetId(intent),
    name: intent.preset.name,
    version: "1.0",
    mode: intent.preset.mode || "txt" /* TXT */,
    category: intent.preset.category || "generate" /* GENERATE */,
    workflow: cloneWorkflow(intent.workflow),
    mapping,
    ui_config,
    createdAt: 0,
    agentManaged: true,
    agentSourceHash: validated.sourceHash,
    agentIntentHash: intentHash,
    agentJobId: intent.jobId
  });
  const validation = validatePreset(normalizeWorkflowPreset(preset));
  if (!validation.valid) {
    throw new WorkflowLabAgentError("E_VALIDATION_FAILED", validation.errors[0] || "Preset validation failed", validation.errors);
  }
  assertDryRun(preset);
  return {
    preset,
    intentHash,
    sourceHash: validated.sourceHash,
    validation
  };
}
var WORKFLOW_LAB_AGENT_SUPPORTED_CONTROL_TYPES = Object.values(UIControlType);
export {
  WORKFLOW_LAB_AGENT_INTENT_TYPE,
  WorkflowLabAgentError,
  asWorkflowLabAgentError,
  compileWorkflowLabAgentIntent,
  computeValidatedWorkflowLabAgentIntentHash,
  computeWorkflowLabAgentIntentHash,
  computeWorkflowSourceHash,
  isWorkflowLabAgentJobId,
  isWorkflowLabAgentTerminalJobResult,
  normalizeWorkflowLabAgentBridgeWriteError,
  validateWorkflowLabAgentIntent
};
