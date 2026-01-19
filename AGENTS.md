# Agent Guidelines for ill-token

This document provides guidelines for AI coding agents working on the `ill-token` CLI tool.

## Project Overview

A TypeScript-based CLI tool that manages JWT tokens and environment settings across UI repository worktrees. The tool is globally installed via `npm link` and invoked using the `ill-token` command.

## Build, Run, and Test Commands

### Development
```bash
npm run dev              # Watch mode - auto-rebuild on changes
npm run start            # Run directly with tsx (no build)
npm run build            # Compile TypeScript to dist/
```

### Installation
```bash
npm install              # Install dependencies
npm run build            # Build the project
npm link                 # Install globally as 'ill-token' command
```

### Testing
```bash
ill-token                # Test the CLI (must run from UI worktree)
```

Note: No automated tests currently exist. Manual testing is done by running `ill-token` from a UI repository worktree.

### Rebuild After Changes
```bash
npm run build            # Changes are immediately available (linked globally)
```

## Code Style Guidelines

### General Rules (from ~/.claude/CLAUDE.md)
- **Never add comments** to the code unless explicitly requested
- **Functions with >2 arguments**: Pass them as an object parameter
- **TypeScript types**: Never specify return types inside functions unless explicitly requested

### Import Organization
```typescript
// 1. External dependencies (alphabetical)
import { input, select } from "@inquirer/prompts";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

// 2. Types
type Environment = "dev" | "qa" | "prod";

// 3. Interfaces
interface Worktree {
  path: string;
  name: string;
}
```

### TypeScript Configuration
- **Target**: ES2022
- **Module**: NodeNext (ESM)
- **Strict mode**: Enabled
- All source files in `src/`, compiled to `dist/`

### Naming Conventions
- **Functions**: camelCase (`getWorktrees`, `updateFiles`)
- **Types/Interfaces**: PascalCase (`Environment`, `Worktree`)
- **Variables**: camelCase (`worktreePath`, `apiClientPath`)
- **Constants**: UPPER_SNAKE_CASE for error messages or config

### Function Parameters
When a function takes more than 2 parameters, use destructured object:
```typescript
// ✅ Good
function updateFiles({
  worktreePath,
  token,
  environment,
}: {
  worktreePath: string;
  token: string;
  environment: Environment;
}) {
  // implementation
}

// ❌ Bad
function updateFiles(worktreePath: string, token: string, environment: Environment) {
  // implementation
}
```

### Return Types
Do not explicitly specify return types unless requested:
```typescript
// ✅ Good
function getWorktrees() {
  const worktrees: Worktree[] = [];
  return worktrees;
}

// ❌ Bad
function getWorktrees(): Worktree[] {
  const worktrees: Worktree[] = [];
  return worktrees;
}
```

### Error Handling
- Use `console.error()` for error messages
- Use emoji prefixes: `❌ Error:` for errors, `✓` for success
- Call `process.exit(1)` for fatal errors
- Catch async errors in main():
  ```typescript
  main().catch((error) => {
    if (error.name === "ExitPromptError") {
      console.log("\n👋 Cancelled");
      process.exit(0);
    }
    console.error("❌ Error:", error.message);
    process.exit(1);
  });
  ```

### File Operations
- Use `existsSync()` before reading/writing files
- Always provide user-friendly error messages with file paths
- Use `utf-8` encoding explicitly for file operations

### Console Output
- Use emoji for visual feedback: `✓`, `❌`, `👋`
- Keep messages concise and user-friendly
- Show file paths in error messages for debugging

### Regular Expressions
- Use clear, descriptive variable names (`bearerRegex`, `localhostRegex`)
- Test regex patterns before applying replacements
- Provide clear error messages when patterns don't match

## Project Structure

```
token-script/
├── src/
│   └── index.ts          # Main CLI entry point (181 lines)
├── dist/                 # Compiled JavaScript (auto-generated)
├── package.json          # Defines 'ill-token' bin command
├── tsconfig.json         # TypeScript configuration
└── node_modules/         # Dependencies
```

## Key Dependencies

- `@inquirer/prompts`: Interactive CLI prompts (input, select)
- `tsx`: Run TypeScript directly without compilation
- `typescript`: TypeScript compiler

## Architecture Notes

### Main Flow
1. Validate running from UI repository (checks for `src/lib/api-client.ts`)
2. Prompt for JWT token
3. Discover worktrees via `git worktree list`
4. Prompt for worktree selection
5. Prompt for environment (dev/qa/prod)
6. Update files immediately (no confirmation)

### File Updates
- `src/lib/api-client.ts`: Replace Bearer token using regex
- `src/lib/utils.ts`: Update localhost environment return value

### Git Integration
- Uses `git rev-parse --show-toplevel` to find repository root
- Uses `git worktree list` to discover all worktrees
- Parses git command output to extract worktree paths

## Best Practices

1. **Maintain the shebang**: Keep `#!/usr/bin/env node` at the top of src/index.ts
2. **Keep it simple**: This is a utility tool - avoid over-engineering
3. **Test manually**: After changes, run `npm run build` and test with `ill-token`
4. **Preserve regex patterns**: The token and environment regex are critical
5. **User experience**: Keep prompts clear and error messages helpful

## Common Tasks

### Add a new prompt
```typescript
const newValue = await input({
  message: "Prompt message:",
  validate: (value) => value.trim() ? true : "Cannot be empty",
});
```

### Add a new file operation
```typescript
const filePath = join(worktreePath, "path/to/file.ts");
if (!existsSync(filePath)) {
  console.error(`❌ Error: File not found: ${filePath}`);
  process.exit(1);
}
let content = readFileSync(filePath, "utf-8");
// modify content
writeFileSync(filePath, content, "utf-8");
console.log(`✓ Updated ${filePath}`);
```

### Execute shell commands
```typescript
const result = execSync("git command", {
  cwd: workingDirectory,
  encoding: "utf-8",
}).trim();
```
