# Claude Code Project Instructions

## Project Overview

`@effect/claude-session` is an Effect-TS library for extracting and archiving Claude Code sessions. It provides:
- Session discovery from `~/.claude/projects`
- Multiple output formats (Markdown, JSON, HTML)
- GitHub Gist integration for archiving
- CLI tool for interactive use

## Tech Stack

- **Effect-TS** - Functional effect system (v3.18+)
- **@effect/cli** - CLI command parsing
- **@effect/platform** - File system, HTTP, command execution
- **TypeScript** - Strict mode enabled
- **pnpm** - Package manager

## Project Structure

```
src/
├── bin/cli.ts      # CLI entry point (list, export, gist, hook commands)
├── Session.ts      # Session discovery & JSONL parsing
├── Formatter.ts    # Output formatting (MD/JSON/HTML)
├── Gist.ts         # GitHub Gist integration
└── index.ts        # Public API exports
```

## Build Commands

```bash
pnpm build           # Full build (ESM + CJS + DTS + pack)
pnpm build-esm       # TypeScript compilation only
pnpm clean           # Remove build artifacts
pnpm check           # Type check without emit
pnpm publish:local   # Publish to local Verdaccio (localhost:4873)
pnpm publish:npm     # Publish to npm registry
```

## Development

```bash
pnpm dev             # Run CLI directly via tsx
pnpm test            # Run tests with vitest
pnpm lint            # ESLint
```

## Effect-TS Patterns Used

### Service Architecture
- Services defined as `Context.Tag` with live implementations as `Layer`
- Config tags separate from service interfaces (e.g., `SessionConfigOptions` interface, `SessionConfig` tag)

### Error Handling
- Tagged errors via `Data.TaggedError` (e.g., `SessionError`, `GistError`)
- Errors have `reason` discriminator for pattern matching

### Option Handling
- Use `Option.getOrThrow()` to extract values after `Option.isSome()` guard
- Never access `.value` directly on Option types

### File System
- `@effect/platform/FileSystem` for file operations
- `stat.mtime` returns `Option<Date>`, must check with `Option.isSome()`

## Session File Format

Claude Code stores sessions in `~/.claude/projects/{project-name}/`:
- Session files: UUID-named `.jsonl` (e.g., `e409aacf-33a8-4b59-9cee-42cd5261bff7.jsonl`)
- Agent transcripts: `agent-*.jsonl` (excluded from main session list)

Each line in a session file is a JSON object with:
```typescript
{
  type: "user" | "human" | "assistant",
  message?: { role?: string, content: MessageContent },
  content?: MessageContent,
  timestamp?: string
}
```

## Publishing Workflow

1. Update version in `package.json`
2. Run `pnpm build`
3. Run `pnpm publish:local` (for testing) or `pnpm publish:npm` (for release)

The `dist/` directory contains the publishable package with separate ESM, CJS, and DTS outputs.

## Testing Locally

After publishing to Verdaccio:
```bash
pnpm install -g @effect/claude-session --registry http://localhost:4873/
claude-session list
```
