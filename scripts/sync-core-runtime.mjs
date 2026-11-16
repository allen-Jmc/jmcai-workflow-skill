import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const coreRoot = resolve(
  process.env.JMCAI_CORE_ROOT || join(skillRoot, '..', 'JMCAI-CORE-V10'),
);
const runtimePath = join(skillRoot, 'scripts', 'lib', 'core-agent-runtime.mjs');
const manifestPath = join(skillRoot, 'runtime-manifest.json');

const contractPath = join(
  coreRoot,
  'src',
  'services',
  'workflow',
  'workflowLabAgentContract.ts',
);
const compilerPath = join(
  coreRoot,
  'src',
  'services',
  'workflow',
  'workflowLabAgentCompiler.ts',
);

const requiredFiles = [
  contractPath,
  compilerPath,
  join(coreRoot, 'package.json'),
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function loadEsbuild() {
  for (const base of [skillRoot, coreRoot]) {
    try {
      const require = createRequire(join(base, 'package.json'));
      const esbuildPath = require.resolve('esbuild');
      const loaded = await import(pathToFileURL(esbuildPath).href);
      const esbuild = loaded.build ? loaded : loaded.default;
      if (esbuild?.build) return esbuild;
    } catch {
      // Try the next module root.
    }
  }
  throw new Error(
    'esbuild was not found. Run npm install in this Skill or the Core checkout.',
  );
}

async function buildFingerprint(metafile, workingDirectory) {
  const inputNames = Object.keys(metafile.inputs || {})
    .map(value => value.replaceAll('\\', '/'))
    .filter(value => value.startsWith('src/'))
    .sort();
  const files = [];
  const fingerprint = createHash('sha256');
  for (const inputName of inputNames) {
    const inputPath = resolve(workingDirectory, inputName);
    if (!existsSync(inputPath)) continue;
    const content = await readFile(inputPath);
    const digest = sha256(content);
    files.push({ path: inputName, sha256: digest });
    fingerprint.update(`${inputName}\0${digest}\n`);
  }
  return { fingerprint: fingerprint.digest('hex'), files };
}

async function main() {
  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      throw new Error(`Required Core source is missing: ${file}`);
    }
  }

  const esbuild = await loadEsbuild();
  const tempRoot = await mkdtemp(join(tmpdir(), 'jmcai-workflow-skill-runtime-'));
  try {
    const entryPath = join(tempRoot, 'entry.ts');
    const bundlePath = join(tempRoot, 'runtime.mjs');
    const shimPath = join(
      skillRoot,
      'scripts',
      'runtime-shims',
      'comfyMetadataService.mjs',
    );
    const entry = [
      'export {',
      '  WORKFLOW_LAB_AGENT_INTENT_TYPE,',
      '  WorkflowLabAgentError,',
      '  asWorkflowLabAgentError,',
      '  computeValidatedWorkflowLabAgentIntentHash,',
      '  computeWorkflowLabAgentIntentHash,',
      '  computeWorkflowSourceHash,',
      '  isWorkflowLabAgentJobId,',
      '  isWorkflowLabAgentTerminalJobResult,',
      '  normalizeWorkflowLabAgentBridgeWriteError,',
      '  validateWorkflowLabAgentIntent,',
      `} from ${JSON.stringify(contractPath)};`,
      `export { compileWorkflowLabAgentIntent } from ${JSON.stringify(compilerPath)};`,
      '',
    ].join('\n');
    await writeFile(entryPath, entry, 'utf8');

    const build = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      outfile: bundlePath,
      metafile: true,
      absWorkingDir: coreRoot,
      logLevel: 'warning',
      plugins: [{
        name: 'jmcai-agent-runtime-shims',
        setup(builder) {
          builder.onResolve(
            { filter: /comfyMetadataService$/ },
            args => (
              args.importer.replaceAll('\\', '/').endsWith('uiConfigInference.ts')
                ? { path: shimPath }
                : null
            ),
          );
        },
      }],
    });
    const metafile = build.metafile;
    const source = await buildFingerprint(metafile, coreRoot);
    const shim = {
      path: 'scripts/runtime-shims/comfyMetadataService.mjs',
      sha256: sha256(await readFile(shimPath)),
    };
    source.fingerprint = sha256(
      `${source.fingerprint}\n${shim.path}\0${shim.sha256}\n`,
    );
    const bundle = await readFile(bundlePath);
    const bundleDigest = sha256(bundle);
    const corePackage = JSON.parse(
      await readFile(join(coreRoot, 'package.json'), 'utf8'),
    );

    await mkdir(dirname(runtimePath), { recursive: true });
    await writeFile(runtimePath, bundle);

    const manifest = {
      schemaVersion: 1,
      skill: 'jmcai-workflow-skill',
      runtime: {
        intentType: 'JMCAI_WORKFLOW_INTENT_V1',
        nodeEngine: '>=20',
        corePackage: corePackage.name,
        coreVersion: corePackage.version,
      },
      bundle: {
        path: 'scripts/lib/core-agent-runtime.mjs',
        sha256: bundleDigest,
        bytes: (await stat(runtimePath)).size,
      },
      sources: {
        ...source,
        shims: [shim],
      },
      generatedBy: 'scripts/sync-core-runtime.mjs',
    };
    const stagedManifest = join(
      dirname(manifestPath),
      `.${basename(manifestPath)}.${process.pid}.tmp`,
    );
    await writeFile(
      stagedManifest,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await rename(stagedManifest, manifestPath);

    process.stdout.write(
      `${JSON.stringify({
        status: 'synced',
        coreRoot,
        runtimePath,
        manifestPath,
        bundleSha256: bundleDigest,
        sourceFingerprint: source.fingerprint,
        sourceFiles: source.files.length,
      })}\n`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(
    `${JSON.stringify({
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
