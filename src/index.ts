#!/usr/bin/env node

import { checkbox, input, select } from "@inquirer/prompts";
import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { emitKeypressEvents } from "readline";

type Environment = "dev" | "qa" | "prod";

interface Worktree {
  path: string;
  name: string;
}

interface Keypress {
  name?: string;
}

interface RepositoryResolution {
  handler: RepositoryHandler;
  repositoryPath: string;
}

interface RepositoryHandler {
  displayName: string;
  resolveRepositoryPath: (args: {
    cwd: string;
    gitRoot?: string;
  }) => string | undefined;
  run: (args: {
    repositoryPath: string;
    token: string;
  }) => Promise<void>;
}

async function main() {
  const repoContext = findRepositoryResolution();

  console.log(`✓ ${repoContext.handler.displayName} repository detected\n`);

  const tokenArg = process.argv[2]?.trim();
  const token =
    tokenArg ||
    (await input({
      message: "Paste JWT token:",
      validate: (value) => {
        if (!value.trim()) {
          return "Token cannot be empty";
        }
        return true;
      },
    }));

  await repoContext.handler.run({
    repositoryPath: repoContext.repositoryPath,
    token,
  });
}

function findRepositoryResolution() {
  const cwd = process.cwd();
  const gitRoot = tryGetGitRoot({ workingDirectory: cwd });
  const repositoryHandlers = getRepositoryHandlers();

  for (const handler of repositoryHandlers) {
    const repositoryPath = handler.resolveRepositoryPath({ cwd, gitRoot });

    if (repositoryPath) {
      return {
        handler,
        repositoryPath,
      } satisfies RepositoryResolution;
    }
  }

  console.error(
    "❌ Error: Could not detect a supported repository. Please run from a supported repo or the illumify folder.",
  );
  process.exit(1);
}

function getRepositoryHandlers() {
  return [
    createIosRepositoryHandler(),
    createUiRepositoryHandler(),
  ] satisfies RepositoryHandler[];
}

function createIosRepositoryHandler() {
  return {
    displayName: "iOS",
    resolveRepositoryPath: ({ cwd, gitRoot }) => {
      const candidatePaths = [cwd, gitRoot].filter((path): path is string => Boolean(path));
      return candidatePaths.find((candidatePath) => hasRepositoryMarker({
        path: candidatePath,
        markerPath: "app/services/api/api.ts",
      }));
    },
    run: async ({ repositoryPath, token }) => {
      console.log(`📱 Updating ${repositoryPath}...`);
      updateIosApiToken({ iosRepoPath: repositoryPath, token });
      console.log("\n✓ Token updated successfully!");
      console.log(`  iOS: ${repositoryPath}`);
    },
  } satisfies RepositoryHandler;
}

function createUiRepositoryHandler() {
  return {
    displayName: "UI",
    resolveRepositoryPath: ({ cwd, gitRoot }) => {
      const candidatePaths = [
        cwd,
        gitRoot,
        join(cwd, "UI"),
        join(dirname(cwd), "UI"),
        gitRoot ? join(gitRoot, "UI") : undefined,
        gitRoot ? join(dirname(gitRoot), "UI") : undefined,
        ...getSiblingRepositoryPaths({
          directoryPath: cwd,
          markerPath: "src/lib/api-client.ts",
        }),
        ...(gitRoot
          ? getSiblingRepositoryPaths({
              directoryPath: dirname(gitRoot),
              markerPath: "src/lib/api-client.ts",
            })
          : []),
      ].filter((path): path is string => Boolean(path));

      return candidatePaths.find((candidatePath) => hasRepositoryMarker({
        path: candidatePath,
        markerPath: "src/lib/api-client.ts",
      }));
    },
    run: async ({ repositoryPath, token }) => {
      const apiClientPath = join(repositoryPath, "src/lib/api-client.ts");

      if (!existsSync(apiClientPath)) {
        console.error(
          "❌ Error: Not a UI repository. Please run from a UI worktree.",
        );
        console.error("   Expected file not found: src/lib/api-client.ts");
        process.exit(1);
      }

      const worktrees = getWorktrees({ gitRoot: repositoryPath });

      if (worktrees.length === 0) {
        console.error("❌ Error: No worktrees found");
        process.exit(1);
      }

      let selectedWorktrees: string[];

      if (worktrees.length === 1) {
        selectedWorktrees = [worktrees[0].path];
        console.log(`✓ Auto-selected worktree: ${worktrees[0].name}\n`);
      } else {
        const sortedWorktrees = worktrees.sort((a, b) => {
          if (a.path === repositoryPath) return -1;
          if (b.path === repositoryPath) return 1;
          return 0;
        });

        let activeWorktreeIndex = 0;
        emitKeypressEvents(process.stdin);

        const onKeypress = (_value: string, key: Keypress) => {
          if (key.name === "up") {
            activeWorktreeIndex =
              (activeWorktreeIndex - 1 + sortedWorktrees.length) %
              sortedWorktrees.length;
          }

          if (key.name === "down") {
            activeWorktreeIndex =
              (activeWorktreeIndex + 1) % sortedWorktrees.length;
          }

          if (key.name && /^\d$/.test(key.name)) {
            const numericIndex = Number(key.name) - 1;

            if (numericIndex >= 0 && numericIndex < sortedWorktrees.length) {
              activeWorktreeIndex = numericIndex;
            }
          }
        };

        process.stdin.on("keypress", onKeypress);

        try {
          selectedWorktrees = await checkbox({
            message: "Select worktrees (space to toggle, enter to confirm):",
            choices: sortedWorktrees.map((wt) => ({
              name: wt.name,
              value: wt.path,
            })),
          });
        } finally {
          process.stdin.removeListener("keypress", onKeypress);
        }

        if (selectedWorktrees.length === 0) {
          const fallbackWorktree = sortedWorktrees[activeWorktreeIndex];

          if (!fallbackWorktree) {
            console.error("❌ Error: No worktrees selected");
            process.exit(1);
          }

          selectedWorktrees = [fallbackWorktree.path];
          console.log(`✓ Auto-selected worktree: ${fallbackWorktree.name}\n`);
        }
      }

      const environment = await select<Environment>({
        message: "Select environment:",
        choices: [
          { name: "qa", value: "qa" },
          { name: "dev", value: "dev" },
          { name: "prod", value: "prod" },
        ],
      });

      for (const worktreePath of selectedWorktrees) {
        console.log(`\n📁 Updating ${worktreePath}...`);
        updateFiles({ worktreePath, token, environment });
      }

      const iosRepoPath = join(dirname(repositoryPath), "iOS");
      const iosApiPath = join(iosRepoPath, "app/services/api/api.ts");
      let iosUpdated = false;

      if (existsSync(iosApiPath)) {
        console.log(`\n📱 Updating ${iosRepoPath}...`);
        updateIosApiToken({ iosRepoPath, token });
        iosUpdated = true;
      } else {
        console.log(`\n✓ iOS repository not found, skipped: ${iosRepoPath}`);
      }

      console.log("\n✓ Token and environment updated successfully!");
      console.log(`  Worktrees: ${selectedWorktrees.length}`);
      selectedWorktrees.forEach((wt) => console.log(`    - ${wt}`));
      console.log(`  Environment: ${environment}`);

      if (iosUpdated) {
        console.log(`  iOS: ${iosRepoPath}`);
      }
    },
  } satisfies RepositoryHandler;
}

function tryGetGitRoot({
  workingDirectory,
}: {
  workingDirectory: string;
}) {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: workingDirectory,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function getSiblingRepositoryPaths({
  directoryPath,
  markerPath,
}: {
  directoryPath: string;
  markerPath: string;
}) {
  if (!existsSync(directoryPath)) {
    return [];
  }

  return readdirSync(directoryPath)
    .map((entry) => join(directoryPath, entry))
    .filter((entryPath) => hasRepositoryMarker({ path: entryPath, markerPath }));
}

function hasRepositoryMarker({
  path,
  markerPath,
}: {
  path: string;
  markerPath: string;
}) {
  return existsSync(join(path, markerPath));
}

function getWorktrees({
  gitRoot,
}: {
  gitRoot: string;
}) {
  const worktreeList = execSync("git worktree list", {
    cwd: gitRoot,
    encoding: "utf-8",
  });

  const worktrees: Worktree[] = [];

  worktreeList.split("\n").forEach((line) => {
    if (!line.trim()) return;

    const parts = line.split(/\s+/);
    const path = parts[0];

    if (!path) return;

    const name = path.split("/").pop() || path;

    worktrees.push({ path, name });
  });

  return worktrees;
}

function getIosRepoPath({
  uiGitRoot,
}: {
  uiGitRoot: string;
}) {
  return join(dirname(uiGitRoot), "iOS");
}

function updateFiles({
  worktreePath,
  token,
  environment,
}: {
  worktreePath: string;
  token: string;
  environment: Environment;
}) {
  updateApiClient({ worktreePath, token });
  updateUtils({ worktreePath, environment });
}

function updateApiClient({
  worktreePath,
  token,
}: {
  worktreePath: string;
  token: string;
}) {
  const filePath = join(worktreePath, "src/lib/api-client.ts");

  if (!existsSync(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`);
    process.exit(1);
  }

  let content = readFileSync(filePath, "utf-8");

  const bearerRegex =
    /(config\.headers\.Authorization\s*=\s*`Bearer\s+)[^`]+(`;)/;

  if (!bearerRegex.test(content)) {
    console.error(
      `❌ Error: Could not find Bearer token pattern in ${filePath}`,
    );
    process.exit(1);
  }

  content = content.replace(
    bearerRegex,
    (_match, prefix: string, suffix: string) => `${prefix}${token}${suffix}`,
  );

  writeFileSync(filePath, content, "utf-8");
  console.log(`✓ Updated ${filePath}`);
}

function updateUtils({
  worktreePath,
  environment,
}: {
  worktreePath: string;
  environment: Environment;
}) {
  const filePath = join(worktreePath, "src/lib/utils.ts");

  if (!existsSync(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`);
    process.exit(1);
  }

  let content = readFileSync(filePath, "utf-8");

  const localhostRegex =
    /(if\s*\(\s*hostname\.startsWith\s*\(\s*["']localhost["']\s*\)\s*\)\s*\{\s*return\s+["'])(dev|qa|prod)(["'];)/;

  if (!localhostRegex.test(content)) {
    console.error(
      `❌ Error: Could not find localhost environment pattern in ${filePath}`,
    );
    process.exit(1);
  }

  content = content.replace(localhostRegex, `$1${environment}$3`);

  writeFileSync(filePath, content, "utf-8");
  console.log(`✓ Updated ${filePath}`);
}

function updateIosApiToken({
  iosRepoPath,
  token,
}: {
  iosRepoPath: string;
  token: string;
}) {
  const filePath = join(iosRepoPath, "app/services/api/api.ts");

  if (!existsSync(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`);
    process.exit(1);
  }

  let content = readFileSync(filePath, "utf-8");

  const authTokenRegex = /^(export const DEV_AUTH_TOKEN\s*=\s*)("(?:[^"\\]|\\.)*")\s*;?$/m

  if (!authTokenRegex.test(content)) {
    console.error(
      `❌ Error: Could not find iOS auth token pattern in ${filePath}`,
    );
    process.exit(1);
  }

  content = content.replace(
    authTokenRegex,
    (_match, prefix: string) => `${prefix}${JSON.stringify(token)}`,
  );

  writeFileSync(filePath, content, "utf-8");
  console.log(`✓ Updated ${filePath}`);
}

main().catch((error) => {
  if (error.name === "ExitPromptError") {
    console.log("\n👋 Cancelled");
    process.exit(0);
  }
  console.error("❌ Error:", error.message);
  process.exit(1);
});
