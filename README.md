# jmcai-workflow-skill

面向用户的 Codex Skill：把 ComfyUI API-format workflow JSON 分析并配置成 JMCAI 工作流实验室预设。

GitHub 仓库：`https://github.com/allen-Jmc/jmcai-workflow-skill`

## 安装

仓库发布到 GitHub 后，使用 Codex 的 Skill 安装能力安装仓库根目录：

```text
从 GitHub 安装 allen-Jmc/jmcai-workflow-skill，Skill 路径为仓库根目录。
或直接安装：https://github.com/allen-Jmc/jmcai-workflow-skill.git
```

首次发布前仓库尚不存在时，可先把本目录复制到 `$CODEX_HOME/skills/jmcai-workflow-skill`，下个回合即可使用。

## 前置条件

- Node.js 20 或更新版本。
- 已发布包含 Workflow Lab Agent bridge 的 JMCAI 应用。
- 应用与 CLI 挂载同一个 bridge 目录，默认是 `~/JMCAI/workflow-lab-agent-bridge`。

Web 端在“算力中心 → 存储系统 → 挂载目录”授权；桌面端选择同一目录。

## 本地检查

```bash
node scripts/jmcai-workflow.mjs doctor
node --test
```

## 维护

运行时的契约与编译器来自 JMCAI Core。更新 Core 后，在维护机上执行：

```bash
JMCAI_CORE_ROOT="/path/to/JMCAI-CORE-V10" node scripts/sync-core-runtime.mjs
node --test
```

`scripts/lib/core-agent-runtime.mjs` 是生成文件，不手工编辑。`runtime-manifest.json` 记录契约版本、源文件指纹和 bundle 哈希。

## 兼容性

当前 Skill 只支持 `TXT` 和 `IMG`、ComfyUI API workflow、已挂载的 Agent bridge。`PLUGIN`、ComfyUI UI-format 转换、URL 下载和直接修改应用存储不在首版范围内。
