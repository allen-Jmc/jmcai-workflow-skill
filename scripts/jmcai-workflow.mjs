import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WorkflowLabAgentError,
  asWorkflowLabAgentError,
  compileWorkflowLabAgentIntent,
  computeValidatedWorkflowLabAgentIntentHash,
  computeWorkflowSourceHash,
  isWorkflowLabAgentJobId,
  isWorkflowLabAgentTerminalJobResult,
  normalizeWorkflowLabAgentBridgeWriteError,
  validateWorkflowLabAgentIntent,
} from './lib/core-agent-runtime.mjs';
import {
  ANALYSIS_VERSION,
  WorkflowAnalysisError,
  analyzeWorkflow,
  assertApiWorkflow,
} from './lib/workflow-analysis.mjs';

const skillRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = join(skillRoot, 'runtime-manifest.json');
const runtimePath = join(skillRoot, 'scripts', 'lib', 'core-agent-runtime.mjs');
const DEFAULT_BRIDGE_DIR = join(
  homedir(),
  'JMCAI',
  'workflow-lab-agent-bridge',
);
const COMMANDS = [
  'doctor',
  'analyze',
  'prepare',
  'validate',
  'compile',
  'install',
  'verify',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positionals = [];
  const options = {};
  const valueOptions = new Set([
    '--bridge-dir',
    '--out',
    '--plan',
    '--mapping',
    '--extra-controls',
    '--timeout-ms',
    '--mode',
    '--category',
    '--name',
  ]);
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--fork') {
      options.fork = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (valueOptions.has(arg)) {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        throw new WorkflowAnalysisError(
          'E_CLI_OPTION',
          `${arg} requires a value.`,
        );
      }
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new WorkflowAnalysisError(
        'E_CLI_OPTION',
        `Unknown option ${arg}.`,
      );
    }
    positionals.push(arg);
  }
  return { command, positionals, options };
}

async function readJsonFile(path, label = 'JSON file') {
  let raw;
  try {
    raw = await readFile(resolve(expandHome(path)), 'utf8');
  } catch (error) {
    throw new WorkflowAnalysisError(
      'E_READ_FILE',
      `Unable to read ${label}: ${path}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new WorkflowAnalysisError(
      'E_JSON_PARSE',
      `${label} is not valid JSON: ${path}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function writeJsonFile(path, value) {
  const target = resolve(expandHome(path));
  await mkdir(dirname(target), { recursive: true });
  const temp = join(
    dirname(target),
    `.${parse(target).base}.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, target);
  return target;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function defaultBridgeDir(options) {
  return resolve(expandHome(options['bridge-dir'] || DEFAULT_BRIDGE_DIR));
}

function parseTimeout(options) {
  const value = options['timeout-ms'] === undefined
    ? 30_000
    : Number(options['timeout-ms']);
  if (!Number.isFinite(value) || value < 1) {
    throw new WorkflowAnalysisError(
      'E_CLI_OPTION',
      '--timeout-ms must be a positive number.',
    );
  }
  return Math.floor(value);
}

function ensureMode(mode) {
  if (!mode) {
    throw new WorkflowAnalysisError(
      'E_MODE_REQUIRED',
      'Choose TXT or IMG explicitly before preparing the preset.',
    );
  }
  const normalized = String(mode).toLowerCase();
  if (!['txt', 'img'].includes(normalized)) {
    throw new WorkflowAnalysisError(
      'E_MODE_INVALID',
      'Mode must be txt or img.',
    );
  }
  return normalized;
}

function ensureCategory(category, fallback) {
  const value = String(category || fallback || '').toLowerCase();
  if (!['generate', 'edit'].includes(value)) {
    throw new WorkflowAnalysisError(
      'E_CATEGORY_INVALID',
      'Category must be generate or edit.',
    );
  }
  return value;
}

function analyzeWithSource(workflow) {
  const analysis = analyzeWorkflow(workflow);
  return {
    ...analysis,
    workflowSourceHash: computeWorkflowSourceHash(workflow),
  };
}

function normalizeMapping(value, label) {
  if (!isPlainObject(value)) {
    throw new WorkflowAnalysisError(
      'E_MAPPING_INVALID',
      `${label} must be an object.`,
    );
  }
  const core = isPlainObject(value.core) ? value.core : {};
  const controls = Array.isArray(value.controls) ? value.controls : [];
  const outputNodeIds = Array.isArray(value.outputNodeIds)
    ? value.outputNodeIds
    : [];
  return { core, controls, outputNodeIds };
}

function selectProposal(plan, analysis, mode) {
  if (plan) {
    if (
      plan.workflowSourceHash &&
      plan.workflowSourceHash !== analysis.workflowSourceHash
    ) {
      throw new WorkflowAnalysisError(
        'E_PLAN_MISMATCH',
        'The analysis plan belongs to a different workflow version. Run analyze again.',
      );
    }
    const selected = plan.proposals?.[mode];
    if (!selected) {
      throw new WorkflowAnalysisError(
        'E_PLAN_INVALID',
        `The analysis plan has no ${mode} proposal.`,
      );
    }
    return selected;
  }
  return analysis.proposals[mode];
}

function mergeControls(baseControls, extraControls) {
  const merged = new Map();
  for (const control of [...(baseControls || []), ...(extraControls || [])]) {
    if (!isPlainObject(control)) {
      throw new WorkflowAnalysisError(
        'E_CONTROL_INVALID',
        'Every control must be an object.',
      );
    }
    if (typeof control.nodeId !== 'string' || !control.nodeId) {
      throw new WorkflowAnalysisError(
        'E_CONTROL_INVALID',
        'Every control needs a nodeId.',
      );
    }
    if (
      typeof control.fieldPath !== 'string' ||
      !control.fieldPath.startsWith('inputs.')
    ) {
      throw new WorkflowAnalysisError(
        'E_CONTROL_INVALID',
        'Every control needs an inputs.* fieldPath.',
      );
    }
    const key = `${control.nodeId}:${control.fieldPath}`;
    merged.set(key, { ...merged.get(key), ...control });
  }
  return [...merged.values()];
}

async function loadExtraControls(options) {
  if (!options['extra-controls']) return [];
  const extra = await readJsonFile(
    options['extra-controls'],
    'Extra controls file',
  );
  if (!Array.isArray(extra)) {
    throw new WorkflowAnalysisError(
      'E_CONTROL_INVALID',
      'Extra controls must be a JSON array.',
    );
  }
  return extra;
}

function buildEvidence(selectedMode, warnings) {
  return {
    skill: 'jmcai-workflow-skill',
    analysisVersion: ANALYSIS_VERSION,
    selectedMode,
    source: 'graph-analysis',
    ...(warnings?.length ? { warnings } : {}),
  };
}

function summarizeIntent(intent) {
  return {
    type: intent.type,
    jobId: intent.jobId,
    sourceHash: intent.sourceHash,
    preset: intent.preset,
    coreKeys: Object.keys(intent.core || {}),
    controlCount: intent.controls?.length || 0,
    outputNodeIds: intent.outputNodeIds || [],
  };
}

function summarizePreset(compiled) {
  return {
    presetId: compiled.preset.id,
    presetName: compiled.preset.name,
    mode: compiled.preset.mode,
    category: compiled.preset.category,
    sourceHash: compiled.sourceHash,
    intentHash: compiled.intentHash,
    coreKeys: Object.keys(compiled.preset.mapping || {}),
    controlCount: compiled.preset.ui_config?.length || 0,
    outputs: (compiled.preset.mapping?.outputs || []).map(output => ({
      nodeId: output.nodeId,
      type: output.type,
      label: output.label,
    })),
    validation: compiled.validation,
  };
}

async function commandDoctor(options) {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 20) {
    throw new WorkflowAnalysisError(
      'E_NODE_VERSION',
      'Node.js 20 or newer is required.',
      { detected: process.versions.node },
    );
  }
  const manifest = await readJsonFile(manifestPath, 'Runtime manifest');
  const runtimeBytes = await readFile(runtimePath);
  const runtimeSha256 = sha256(runtimeBytes);
  if (runtimeSha256 !== manifest.bundle?.sha256) {
    throw new WorkflowAnalysisError(
      'E_RUNTIME_MANIFEST_MISMATCH',
      'The bundled runtime does not match runtime-manifest.json.',
      {
        expected: manifest.bundle?.sha256,
        actual: runtimeSha256,
      },
    );
  }
  const bridgeDir = defaultBridgeDir(options);
  const root = parse(bridgeDir).root;
  if (!bridgeDir || bridgeDir === root) {
    throw new WorkflowAnalysisError(
      'E_BRIDGE_PATH_INVALID',
      'Bridge directory must be a real directory.',
    );
  }
  await mkdir(bridgeDir, { recursive: true });
  const probePath = join(
    bridgeDir,
    `.jmcai-workflow-skill-doctor-${process.pid}.tmp`,
  );
  try {
    await writeFile(probePath, 'ok', 'utf8');
    await readFile(probePath, 'utf8');
  } catch (error) {
    throw normalizeWorkflowLabAgentBridgeWriteError(error);
  } finally {
    await rm(probePath, { force: true });
  }
  const queueExists = existsSync(join(bridgeDir, 'queue'));
  const outboxExists = existsSync(join(bridgeDir, 'outbox'));
  return {
    status: 'ok',
    nodeVersion: process.versions.node,
    runtime: manifest.runtime,
    runtimeSha256,
    bridgeDir,
    bridgeWritable: true,
    appBridgeDirectoriesPresent: queueExists && outboxExists,
    nextStep: queueExists && outboxExists
      ? 'Ensure the app also shows the bridge as ready.'
      : 'Mount this exact directory in JMCAI storage settings before installing.',
  };
}

async function commandAnalyze(positionals, options) {
  const workflowPath = positionals[0];
  if (!workflowPath) {
    throw new WorkflowAnalysisError(
      'E_CLI_ARGUMENT',
      'analyze requires a workflow JSON path.',
    );
  }
  const raw = await readJsonFile(workflowPath, 'Workflow JSON');
  const workflow = assertApiWorkflow(raw);
  const analysis = analyzeWithSource(workflow);
  let planPath;
  if (options.out) {
    planPath = await writeJsonFile(options.out, analysis);
  }
  return {
    ...analysis,
    ...(planPath ? { planPath } : {}),
  };
}

async function commandPrepare(positionals, options) {
  const workflowPath = positionals[0];
  if (!workflowPath) {
    throw new WorkflowAnalysisError(
      'E_CLI_ARGUMENT',
      'prepare requires a workflow JSON path.',
    );
  }
  if (!options.name) {
    throw new WorkflowAnalysisError(
      'E_NAME_REQUIRED',
      'prepare requires --name.',
    );
  }
  const mode = ensureMode(options.mode);
  const workflow = assertApiWorkflow(
    await readJsonFile(workflowPath, 'Workflow JSON'),
  );
  const analysis = analyzeWithSource(workflow);
  const plan = options.plan
    ? await readJsonFile(options.plan, 'Analysis plan')
    : null;
  const extraControls = await loadExtraControls(options);
  const selectedProposal = options.mapping
    ? null
    : selectProposal(plan, analysis, mode);
  let mapping;
  if (options.mapping) {
    mapping = normalizeMapping(
      await readJsonFile(options.mapping, 'Mapping file'),
      'Mapping file',
    );
  } else {
    if (!selectedProposal.ready) {
      throw new WorkflowAnalysisError(
        'E_MAPPING_NOT_READY',
        'The selected proposal still has unresolved mappings. Provide --mapping or ask the user to resolve the listed candidates.',
        {
          mode,
          warnings: selectedProposal.warnings || [],
          ambiguities: analysis.ambiguities,
        },
      );
    }
    mapping = normalizeMapping(selectedProposal, 'Selected proposal');
  }
  const proposalWarnings = selectedProposal?.warnings
    || analysis.proposals[mode]?.warnings
    || [];
  const category = ensureCategory(
    options.category,
    analysis.suggestedCategory,
  );
  const controls = mergeControls(mapping.controls, extraControls);
  const presetBase = {
    name: options.name,
    mode,
    category,
    ...(options.fork ? { fork: true } : {}),
  };
  const baseIntent = {
    type: 'JMCAI_WORKFLOW_INTENT_V1',
    jobId: 'jmcai-pending',
    sourceHash: analysis.workflowSourceHash,
    workflow,
    preset: presetBase,
    core: mapping.core,
    controls,
    ...(mapping.outputNodeIds.length
      ? { outputNodeIds: mapping.outputNodeIds }
      : {}),
    evidence: buildEvidence(mode, proposalWarnings),
  };
  const validatedBase = validateWorkflowLabAgentIntent(baseIntent);
  const intentHash = computeValidatedWorkflowLabAgentIntentHash(
    validatedBase.intent,
  );
  const jobId = options.fork
    ? `jmcai-fork-${Date.now().toString(36)}-${intentHash.slice(0, 12)}`
    : `jmcai-${intentHash.slice(0, 20)}`;
  if (!isWorkflowLabAgentJobId(jobId)) {
    throw new WorkflowLabAgentError(
      'E_SCHEMA_INVALID',
      'Generated jobId is not bridge-safe.',
    );
  }
  const intent = {
    ...baseIntent,
    jobId,
  };
  const validated = validateWorkflowLabAgentIntent(intent);
  const compiled = compileWorkflowLabAgentIntent(validated.intent);
  const finalHash = computeValidatedWorkflowLabAgentIntentHash(
    validated.intent,
  );
  const defaultOut = join(
    tmpdir(),
    'jmcai-workflow-skill',
    finalHash.slice(0, 20),
    'intent.json',
  );
  const intentPath = await writeJsonFile(options.out || defaultOut, intent);
  return {
    status: 'prepared',
    intentPath,
    jobId,
    sourceHash: analysis.workflowSourceHash,
    intentHash: finalHash,
    presetSummary: summarizePreset(compiled),
    warnings: proposalWarnings,
  };
}

async function commandValidate(positionals) {
  const intentPath = positionals[0];
  if (!intentPath) {
    throw new WorkflowAnalysisError(
      'E_CLI_ARGUMENT',
      'validate requires an intent JSON path.',
    );
  }
  const raw = await readJsonFile(intentPath, 'Intent file');
  const validated = validateWorkflowLabAgentIntent(raw);
  return {
    status: 'valid',
    jobId: validated.intent.jobId,
    sourceHash: validated.sourceHash,
    intentHash: computeValidatedWorkflowLabAgentIntentHash(
      validated.intent,
    ),
    intent: summarizeIntent(validated.intent),
  };
}

async function commandCompile(positionals, options) {
  const intentPath = positionals[0];
  if (!intentPath) {
    throw new WorkflowAnalysisError(
      'E_CLI_ARGUMENT',
      'compile requires an intent JSON path.',
    );
  }
  const raw = await readJsonFile(intentPath, 'Intent file');
  const compiled = compileWorkflowLabAgentIntent(raw);
  let presetPath;
  if (options.out) {
    presetPath = await writeJsonFile(options.out, compiled.preset);
  }
  return {
    status: 'compiled',
    ...summarizePreset(compiled),
    ...(presetPath ? { presetPath } : {}),
  };
}

async function ensureBridgeDirectories(bridgeDir) {
  const root = parse(bridgeDir).root;
  if (!bridgeDir || bridgeDir === root || bridgeDir.includes('\0')) {
    throw new WorkflowLabAgentError(
      'E_BRIDGE_PATH_INVALID',
      'Bridge directory must be a real directory.',
    );
  }
  const dirs = {
    inbox: join(bridgeDir, 'inbox'),
    queue: join(bridgeDir, 'queue'),
    outbox: join(bridgeDir, 'outbox'),
    processed: join(bridgeDir, 'processed'),
  };
  await Promise.all(
    Object.values(dirs).map(dir => mkdir(dir, { recursive: true })),
  );
  return dirs;
}

async function commandInstall(positionals, options) {
  const intentPath = positionals[0];
  if (!intentPath) {
    throw new WorkflowAnalysisError(
      'E_CLI_ARGUMENT',
      'install requires an intent JSON path.',
    );
  }
  const raw = await readJsonFile(intentPath, 'Intent file');
  const validated = validateWorkflowLabAgentIntent(raw);
  const intent = validated.intent;
  const intentHash = computeValidatedWorkflowLabAgentIntentHash(intent);
  const bridgeDir = defaultBridgeDir(options);
  const dirs = await ensureBridgeDirectories(bridgeDir);
  const inboxPath = join(dirs.inbox, `${intent.jobId}.json`);
  const queuePath = join(dirs.queue, `${intent.jobId}.json`);
  const outboxPath = join(dirs.outbox, `${intent.jobId}.json`);
  const processedPath = join(dirs.processed, `${intent.jobId}.json`);
  const outbox = await readJsonIfExists(outboxPath);
  const processed = await readJsonIfExists(processedPath);

  if (isWorkflowLabAgentTerminalJobResult(outbox, intentHash)) {
    if (processed && processed.intentHash !== intentHash) {
      await rm(processedPath, { force: true });
    }
    return outbox;
  }
  if (processed) await rm(processedPath, { force: true });

  const pending = {
    status: 'queued',
    jobId: intent.jobId,
    intentHash,
    processedAt: new Date().toISOString(),
  };
  await writeJsonFile(inboxPath, intent);
  await writeJsonFile(outboxPath, pending);
  await writeJsonFile(queuePath, intent);

  const timeoutMs = parseTimeout(options);
  const deadline = Date.now() + timeoutMs;
  let lastResult = pending;
  while (Date.now() <= deadline) {
    lastResult = (await readJsonIfExists(outboxPath)) || lastResult;
    if (isWorkflowLabAgentTerminalJobResult(lastResult, intentHash)) {
      return lastResult;
    }
    if (
      lastResult?.status === 'queued' &&
      lastResult.intentHash === intentHash &&
      (
        typeof lastResult.queuedReason === 'string' ||
        lastResult.processedAt !== pending.processedAt
      )
    ) {
      return {
        ...lastResult,
        bridgeDir,
        nextStep: 'Close Workflow Lab or resolve the dirty draft, then verify this job ID.',
      };
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  return {
    status: 'failed',
    jobId: intent.jobId,
    intentHash,
    errorCode: 'E_TIMEOUT',
    errorMessage:
      'Timed out waiting for the Workflow Lab Agent bridge. Check that the app is running and the bridge directory is mounted.',
    bridgeDir,
    lastResult,
  };
}

async function commandVerify(positionals, options) {
  const jobId = positionals[0];
  if (!jobId) {
    throw new WorkflowAnalysisError(
      'E_CLI_ARGUMENT',
      'verify requires a jobId.',
    );
  }
  if (!isWorkflowLabAgentJobId(jobId)) {
    return {
      status: 'failed',
      jobId,
      errorCode: 'E_BRIDGE_PATH_INVALID',
      errorMessage: 'Invalid jobId.',
    };
  }
  const bridgeDir = defaultBridgeDir(options);
  const outbox = await readJsonIfExists(
    join(bridgeDir, 'outbox', `${jobId}.json`),
  );
  const processed = await readJsonIfExists(
    join(bridgeDir, 'processed', `${jobId}.json`),
  );
  if (
    outbox?.status === 'queued' &&
    typeof outbox.intentHash === 'string'
  ) {
    return {
      ...outbox,
      bridgeDir,
      nextStep: 'Close Workflow Lab or resolve the dirty draft, then verify this job ID.',
    };
  }
  if (
    !isWorkflowLabAgentTerminalJobResult(outbox) ||
    !isWorkflowLabAgentTerminalJobResult(processed) ||
    !outbox?.intentHash ||
    outbox.intentHash !== processed.intentHash
  ) {
    return {
      status: 'failed',
      jobId,
      errorCode: 'E_JOB_ALREADY_PROCESSED',
      errorMessage: 'No matching terminal success result was found.',
      bridgeDir,
    };
  }
  return { ...outbox, bridgeDir };
}

function usage() {
  return {
    status: 'ok',
    commands: COMMANDS,
    note: 'All command output is JSON. Workflow Lab installation requires explicit user confirmation.',
  };
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    throw new WorkflowAnalysisError(
      'E_NODE_VERSION',
      'Node.js 20 or newer is required.',
      { detected: process.versions.node },
    );
  }
  const { command, positionals, options } = parseArgs(process.argv.slice(2));
  if (!command || options.help || command === 'help') {
    return usage();
  }
  if (!COMMANDS.includes(command)) {
    throw new WorkflowAnalysisError(
      'E_COMMAND',
      `Unknown command ${command}.`,
      { commands: COMMANDS },
    );
  }
  if (command === 'doctor') return commandDoctor(options);
  if (command === 'analyze') return commandAnalyze(positionals, options);
  if (command === 'prepare') return commandPrepare(positionals, options);
  if (command === 'validate') return commandValidate(positionals);
  if (command === 'compile') return commandCompile(positionals, options);
  if (command === 'install') return commandInstall(positionals, options);
  return commandVerify(positionals, options);
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result?.status === 'failed') process.exitCode = 1;
} catch (error) {
  const normalized = error?.code?.startsWith?.('E_')
    ? {
      code: error.code,
      message: error.message,
      details: error.details,
    }
    : (() => {
      const agentError = asWorkflowLabAgentError(error);
      return {
        code: agentError.code,
        message: agentError.message,
        details: agentError.details,
      };
    })();
  process.stdout.write(`${JSON.stringify({
    status: 'failed',
    errorCode: normalized.code,
    errorMessage: normalized.message,
    ...(normalized.details === undefined ? {} : { details: normalized.details }),
    ...(process.env.JMCAI_WORKFLOW_SKILL_DEBUG === '1' && error?.stack
      ? { stack: error.stack }
      : {}),
  })}\n`);
  process.exitCode = 1;
}
