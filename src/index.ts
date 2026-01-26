#!/usr/bin/env node

import { input, select } from "@inquirer/prompts";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

type Environment = "dev" | "qa" | "prod";

interface Worktree {
  path: string;
  name: string;
}

async function main() {
  const apiClientPath = resolve(process.cwd(), "src/lib/api-client.ts");

  if (!existsSync(apiClientPath)) {
    console.error(
      "❌ Error: Not a UI repository. Please run from a UI worktree."
    );
    console.error("   Expected file not found: src/lib/api-client.ts");
    process.exit(1);
  }

  console.log("✓ UI repository detected\n");

  const tokenArg = process.argv[2]?.trim();
  const token = tokenArg || await input({
    message: "Paste JWT token:",
    validate: (value) => {
      if (!value.trim()) {
        return "Token cannot be empty";
      }
      return true;
    },
  });

  const currentPath = resolve(process.cwd());
  const worktrees = getWorktrees();

  if (worktrees.length === 0) {
    console.error("❌ Error: No worktrees found");
    process.exit(1);
  }

  const sortedWorktrees = worktrees.sort((a, b) => {
    if (a.path === currentPath) return -1;
    if (b.path === currentPath) return 1;
    return 0;
  });

  const selectedWorktree = await select({
    message: "Select worktree:",
    choices: sortedWorktrees.map((wt) => ({
      name: wt.name,
      value: wt.path,
    })),
  });

  const environment = await select<Environment>({
    message: "Select environment:",
    choices: [
      { name: "dev", value: "dev" },
      { name: "qa", value: "qa" },
      { name: "prod", value: "prod" },
    ],
  });

  updateFiles({ worktreePath: selectedWorktree, token, environment });

  console.log("\n✓ Token and environment updated successfully!");
  console.log(`  Worktree: ${selectedWorktree}`);
  console.log(`  Environment: ${environment}`);
}

function getWorktrees() {
  const gitRoot = execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
  }).trim();

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

  const bearerRegex = /(config\.headers\.Authorization\s*=\s*`Bearer\s+)[^`]+(`;)/;

  if (!bearerRegex.test(content)) {
    console.error(
      `❌ Error: Could not find Bearer token pattern in ${filePath}`
    );
    process.exit(1);
  }

  content = content.replace(bearerRegex, `$1${token}$2`);

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
      `❌ Error: Could not find localhost environment pattern in ${filePath}`
    );
    process.exit(1);
  }

  content = content.replace(localhostRegex, `$1${environment}$3`);

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
