# @effect/claude-session

Effect-TS utilities for extracting and archiving Claude Code sessions.

[![npm version](https://badge.fury.io/js/@effect%2Fclaude-session.svg)](https://badge.fury.io/js/@effect%2Fclaude-session)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why?

When working with Claude Code, you often make important design and implementation decisions through conversation. These decisions deserve the same level of traceability as your code changes. This package enables **decision provenance** by:

- Extracting Claude Code sessions from `~/.claude/projects`
- Formatting them as Markdown, JSON, or HTML
- Archiving to GitHub Gists with a single command
- Integrating with git commits via trailers

Now you can link your commits to the conversations that led to them.

## Installation

```bash
npm install @effect/claude-session
# or
pnpm add @effect/claude-session
# or
bun add @effect/claude-session
```

For CLI usage, install globally:

```bash
npm install -g @effect/claude-session
```

## CLI Usage

### List Sessions

```bash
claude-session list
claude-session list --project myproject    # Filter by project name
```

### Export Session

```bash
claude-session export                      # Export most recent to file
claude-session export --format json        # Export as JSON
claude-session export --project foo        # Export specific project
claude-session export --output ./out.md    # Custom output path
```

### Create GitHub Gist

```bash
claude-session gist                    # Create secret gist
claude-session gist --public           # Create public gist
claude-session gist --commit           # Output for git commit trailer
```

### Git Commit Integration

```bash
# Add gist URL as commit trailer
git commit -m "Implement feature X" -m "$(claude-session gist --commit)"
```

## Programmatic Usage

```typescript
import { Effect, Layer } from "effect"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import {
  SessionService,
  makeSessionService,
  Formatter,
  FormatterLive,
  GistService,
  GistServiceLive
} from "@effect/claude-session"

const program = Effect.gen(function* () {
  const sessions = yield* SessionService
  const formatter = yield* Formatter
  const gist = yield* GistService

  // Discover all sessions
  const allSessions = yield* sessions.discover
  console.log(`Found ${allSessions.length} sessions`)

  // Load the most recent
  const session = yield* sessions.loadMostRecent
  console.log(`Project: ${session.metadata.projectName}`)
  console.log(`Messages: ${session.messages.length}`)

  // Format as markdown
  const markdown = yield* formatter.toMarkdown(session, {
    includeToolUse: true,
    includeTimestamps: true
  })

  // Create a gist
  const result = yield* gist.create({
    description: `Claude session: ${session.metadata.projectName}`,
    files: [{ filename: "session.md", content: markdown }],
    public: false
  })

  console.log(`Gist URL: ${result.htmlUrl}`)
})

// Compose layers
const MainLayer = Layer.mergeAll(
  makeSessionService(),
  FormatterLive,
  GistServiceLive
)

// Run
program.pipe(
  Effect.provide(MainLayer),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
```

## Claude Code Hook Integration

Automatically archive sessions when Claude Code stops:

```json
// ~/.claude/settings.json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "claude-session hook --format markdown"
          }
        ]
      }
    ]
  }
}
```

See [docs/hooks.md](./docs/hooks.md) for detailed hook configuration.

## API Reference

### Session Module

| Export | Description |
|--------|-------------|
| `SessionService` | Service tag for session operations |
| `SessionServiceLive` | Default implementation |
| `makeSessionService(config?)` | Create custom service layer |
| `SessionError` | Error type for session operations |
| `Session` | Complete session with messages |
| `SessionMetadata` | Session metadata (id, project, dates) |
| `NormalizedMessage` | Parsed message with role, content, tools |

### Formatter Module

| Export | Description |
|--------|-------------|
| `Formatter` | Service tag for formatting |
| `FormatterLive` | Default implementation |
| `OutputFormat` | `"markdown" \| "json" \| "html"` |
| `FormatOptions` | Configuration for formatting |

### Gist Module

| Export | Description |
|--------|-------------|
| `GistService` | Service tag for GitHub Gist operations |
| `GistServiceLive` | Default implementation (CLI + API) |
| `makeGistService(config?)` | Create custom service layer |
| `GistResult` | Created gist information |
| `GistConfig` | Configuration (token, preferCli) |

## Configuration

### Session Discovery

By default, sessions are discovered from `~/.claude/projects`. Customize with:

```typescript
const customService = makeSessionService({
  claudeDir: "/custom/path/.claude",
  projectFilter: Option.some("my-project")
})
```

### GitHub Authentication

The package supports two authentication methods:

1. **GitHub CLI** (preferred): Run `gh auth login`
2. **Personal Access Token**: Set `GITHUB_TOKEN` environment variable

```typescript
const customGist = makeGistService({
  token: Option.some("ghp_..."),
  preferCli: false
})
```

## VSCode Extension Integration

This package is designed to potentially integrate with the Effect Dev Tools VSCode extension. The session data can be visualized alongside traces and metrics for a complete development observability experience.

## Contributing

This package follows Effect-TS conventions and could be contributed to the Effect ecosystem. Key areas for contribution:

- [ ] Additional output formats (PDF, Notion, Obsidian)
- [ ] Session summarization using @effect/ai
- [ ] VSCode extension integration
- [ ] Real-time session streaming
- [ ] Session diffing and comparison

## License

MIT © Clay Roach

---

Built with [Effect-TS](https://effect.website) 💜
