#!/usr/bin/env node
/**
 * @since 0.1.0
 * 
 * CLI for exporting Claude Code sessions to GitHub Gists.
 * 
 * Usage:
 *   claude-session list                    # List available sessions
 *   claude-session export                  # Export most recent session
 *   claude-session export --project foo    # Export session from project
 *   claude-session gist                    # Export to GitHub Gist
 *   claude-session gist --commit           # Export and output for git commit
 */
import { Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import * as PlatformCommand from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import { Console, Effect, Layer, Option } from "effect"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"

import {
  SessionService,
  makeSessionService,
  Formatter,
  FormatterLive,
  GistService,
  GistServiceLive,
  type OutputFormat,
  type Session
} from "../index.js"

// ============================================================================
// Shared Options
// ============================================================================

const projectOption = Options.text("project").pipe(
  Options.withAlias("p"),
  Options.withDescription("Filter by project name (partial match)"),
  Options.optional
)

const formatOption = Options.choice("format", ["markdown", "json", "html"]).pipe(
  Options.withAlias("f"),
  Options.withDescription("Output format"),
  Options.withDefault("markdown" as const)
)

const outputOption = Options.file("output").pipe(
  Options.withAlias("o"),
  Options.withDescription("Output file path"),
  Options.optional
)

const publicOption = Options.boolean("public").pipe(
  Options.withDescription("Create a public gist (default: secret)"),
  Options.withDefault(false)
)

const includeToolsOption = Options.boolean("tools").pipe(
  Options.withAlias("t"),
  Options.withDescription("Include tool usage details"),
  Options.withDefault(true)
)

const commitOption = Options.boolean("commit").pipe(
  Options.withAlias("c"),
  Options.withDescription("Output gist URL in format suitable for git commit trailers"),
  Options.withDefault(false)
)

const sinceOption = Options.text("since").pipe(
  Options.withAlias("s"),
  Options.withDescription("Only include messages since timestamp (ISO format) or 'last-commit'"),
  Options.optional
)

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the timestamp of the last git commit
 */
const getLastCommitTimestamp: Effect.Effect<
  Option.Option<Date>,
  never,
  CommandExecutor.CommandExecutor
> = Effect.gen(function* () {
  const command = PlatformCommand.make("git", "log", "-1", "--format=%cI")
  const result = yield* PlatformCommand.string(command).pipe(
    Effect.map(output => {
      const trimmed = output.trim()
      if (!trimmed) return Option.none()
      const date = new Date(trimmed)
      return isNaN(date.getTime()) ? Option.none() : Option.some(date)
    }),
    Effect.catchAll(() => Effect.succeed(Option.none()))
  )
  return result
})

/**
 * Parse the --since option into a Date
 */
const parseSinceOption = (
  since: Option.Option<string>
): Effect.Effect<Option.Option<Date>, never, CommandExecutor.CommandExecutor> =>
  Option.match(since, {
    onNone: () => Effect.succeed(Option.none()),
    onSome: (value) => {
      if (value === "last-commit") {
        return getLastCommitTimestamp
      }
      const date = new Date(value)
      if (isNaN(date.getTime())) {
        return Effect.succeed(Option.none())
      }
      return Effect.succeed(Option.some(date))
    }
  })

/**
 * Filter session messages to only those after a given timestamp
 */
const filterSessionSince = (session: Session, since: Option.Option<Date>): Session =>
  Option.match(since, {
    onNone: () => session,
    onSome: (sinceDate) => ({
      ...session,
      messages: session.messages.filter(msg =>
        Option.match(msg.timestamp, {
          onNone: () => true, // Include messages without timestamps
          onSome: (ts) => ts.getTime() > sinceDate.getTime()
        })
      )
    })
  })

// ============================================================================
// List Command
// ============================================================================

const listCommand = Command.make(
  "list",
  { project: projectOption },
  ({ project }) =>
    Effect.gen(function* () {
      const sessionService = yield* SessionService

      yield* Console.log("\n📁 Claude Code Sessions\n")
      yield* Console.log("─".repeat(80))

      const sessions = yield* sessionService.discover

      if (sessions.length === 0) {
        yield* Console.log("No sessions found.")
        yield* Console.log("\nMake sure you have used Claude Code at least once.")
        return
      }

      // Filter if project specified
      const filtered = Option.match(project, {
        onNone: () => sessions,
        onSome: (p) => sessions.filter(s => 
          s.projectName.toLowerCase().includes(p.toLowerCase())
        )
      })

      yield* Console.log(
        `${"#".padEnd(4)} ${"Project".padEnd(40)} ${"Modified".padEnd(20)} ${"Msgs".padEnd(6)}`
      )
      yield* Console.log("─".repeat(80))

      for (let i = 0; i < filtered.length; i++) {
        const s = filtered[i]!
        const modified = s.lastModified.toISOString().substring(0, 16).replace("T", " ")
        const projectDisplay = s.projectName.length > 38 
          ? s.projectName.substring(0, 35) + "..." 
          : s.projectName
        
        yield* Console.log(
          `${String(i + 1).padEnd(4)} ${projectDisplay.padEnd(40)} ${modified.padEnd(20)} ${String(s.messageCount).padEnd(6)}`
        )
      }

      yield* Console.log("")
      yield* Console.log(`Total: ${filtered.length} session(s)`)
    })
)

// ============================================================================
// Export Command
// ============================================================================

const exportCommand = Command.make(
  "export",
  {
    project: projectOption,
    format: formatOption,
    output: outputOption,
    includeTools: includeToolsOption,
    since: sinceOption
  },
  ({ project, format, output, includeTools, since }) =>
    Effect.gen(function* () {
      const sessionService = yield* SessionService
      const formatter = yield* Formatter
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* Console.log("🔍 Loading session...")

      const fullSession = yield* Option.match(project, {
        onNone: () => sessionService.loadMostRecent,
        onSome: (p) => sessionService.loadByProject(p)
      })

      // Filter by --since if provided
      const sinceDate = yield* parseSinceOption(since)
      const session = filterSessionSince(fullSession, sinceDate)

      yield* Console.log(`📝 Formatting as ${format}...`)
      if (Option.isSome(sinceDate)) {
        yield* Console.log(`   Filtering to ${session.messages.length} messages since ${sinceDate.value.toISOString()}`)
      }

      const formatted = yield* formatter.format(session, format as OutputFormat, {
        includeToolUse: includeTools
      })

      // Output to file or stdout
      const outputPath = Option.match(output, {
        onNone: () => Option.none<string>(),
        onSome: (p) => Option.some(p)
      })

      if (Option.isSome(outputPath)) {
        const outPath = Option.getOrThrow(outputPath)
        yield* fs.writeFileString(outPath, formatted)
        yield* Console.log(`✅ Exported to: ${outPath}`)
      } else {
        // Generate default filename
        const filename = formatter.generateFilename(session.metadata, format as OutputFormat)
        const defaultPath = path.join(process.cwd(), filename)
        
        yield* fs.writeFileString(defaultPath, formatted)
        yield* Console.log(`✅ Exported to: ${defaultPath}`)
      }

      yield* Console.log(`   Project: ${session.metadata.projectName}`)
      yield* Console.log(`   Messages: ${session.messages.length}`)
    })
)

// ============================================================================
// Gist Command
// ============================================================================

const gistCommand = Command.make(
  "gist",
  {
    project: projectOption,
    format: formatOption,
    public: publicOption,
    includeTools: includeToolsOption,
    commit: commitOption,
    since: sinceOption
  },
  ({ project, format, public: isPublic, includeTools, commit, since }) =>
    Effect.gen(function* () {
      const sessionService = yield* SessionService
      const formatter = yield* Formatter
      const gistService = yield* GistService

      // Check authentication
      const authMethod = yield* gistService.getAuthMethod
      if (authMethod === "none") {
        yield* Console.error("❌ No GitHub authentication found.")
        yield* Console.error("   Run 'gh auth login' or set GITHUB_TOKEN environment variable.")
        return yield* Effect.fail(new Error("No authentication"))
      }

      if (!commit) {
        yield* Console.log(`🔐 Using ${authMethod} authentication`)
        yield* Console.log("🔍 Loading session...")
      }

      const fullSession = yield* Option.match(project, {
        onNone: () => sessionService.loadMostRecent,
        onSome: (p) => sessionService.loadByProject(p)
      })

      // Filter by --since if provided
      const sinceDate = yield* parseSinceOption(since)
      const session = filterSessionSince(fullSession, sinceDate)

      if (!commit) {
        yield* Console.log(`📝 Formatting as ${format}...`)
        if (Option.isSome(sinceDate)) {
          yield* Console.log(`   Filtering to ${session.messages.length} messages since ${sinceDate.value.toISOString()}`)
        }
      }

      const formatted = yield* formatter.format(session, format as OutputFormat, {
        includeToolUse: includeTools
      })

      const filename = formatter.generateFilename(session.metadata, format as OutputFormat)

      if (!commit) {
        yield* Console.log("🚀 Creating gist...")
      }

      const result = yield* gistService.create({
        description: `Claude Code session: ${session.metadata.projectName} (${session.metadata.lastModified.toISOString().substring(0, 10)})`,
        files: [{ filename, content: formatted }],
        public: isPublic
      })

      if (commit) {
        // Output just the URL in a format suitable for git commit trailers
        yield* Console.log(`Claude-Session: ${result.htmlUrl}`)
      } else {
        yield* Console.log("")
        yield* Console.log("✅ Gist created successfully!")
        yield* Console.log("")
        yield* Console.log(`   🔗 URL: ${result.htmlUrl}`)
        yield* Console.log(`   📋 ID: ${result.id}`)
        yield* Console.log(`   🔒 Visibility: ${isPublic ? "public" : "secret"}`)
        yield* Console.log(`   📄 File: ${filename}`)
        yield* Console.log("")
        yield* Console.log("💡 To add to your commit message, use:")
        yield* Console.log(`   git commit -m "Your message" -m "Claude-Session: ${result.htmlUrl}"`)
      }
    })
)

// ============================================================================
// Hook Command (for Claude Code Stop hook integration)
// ============================================================================

const hookCommand = Command.make(
  "hook",
  {
    format: formatOption,
    public: publicOption
  },
  ({ format, public: isPublic }) =>
    Effect.gen(function* () {
      // Read hook payload from stdin
      // The Stop hook provides session info via stdin
      const sessionService = yield* SessionService
      const formatter = yield* Formatter
      const gistService = yield* GistService

      // For hooks, we always use the most recent session
      const session = yield* sessionService.loadMostRecent

      const formatted = yield* formatter.format(session, format as OutputFormat, {
        includeToolUse: true
      })

      const filename = formatter.generateFilename(session.metadata, format as OutputFormat)

      const result = yield* gistService.create({
        description: `Claude Code session: ${session.metadata.projectName} (auto-archived)`,
        files: [{ filename, content: formatted }],
        public: isPublic
      })

      // Output JSON for hook consumption
      yield* Console.log(JSON.stringify({
        success: true,
        gistUrl: result.htmlUrl,
        gistId: result.id,
        project: session.metadata.projectName,
        messageCount: session.messages.length
      }))
    }).pipe(
      Effect.catchAll((error) =>
        Console.log(JSON.stringify({
          success: false,
          error: String(error)
        }))
      )
    )
)

// ============================================================================
// Link Commit Command (for post-commit hook)
// ============================================================================

const gistUrlOption = Options.text("gist").pipe(
  Options.withAlias("g"),
  Options.withDescription("Gist URL or ID to update")
)

const repoOption = Options.text("repo").pipe(
  Options.withAlias("r"),
  Options.withDescription("GitHub repository (owner/repo) for commit links"),
  Options.optional
)

/**
 * Get commit info from git
 */
const getCommitInfo = Effect.gen(function* () {
  const shaCommand = PlatformCommand.make("git", "rev-parse", "HEAD")
  const sha = yield* PlatformCommand.string(shaCommand).pipe(
    Effect.map(s => s.trim()),
    Effect.catchAll(() => Effect.succeed(""))
  )

  const messageCommand = PlatformCommand.make("git", "log", "-1", "--format=%B")
  const message = yield* PlatformCommand.string(messageCommand).pipe(
    Effect.map(s => s.trim()),
    Effect.catchAll(() => Effect.succeed(""))
  )

  const branchCommand = PlatformCommand.make("git", "rev-parse", "--abbrev-ref", "HEAD")
  const branch = yield* PlatformCommand.string(branchCommand).pipe(
    Effect.map(s => s.trim()),
    Effect.catchAll(() => Effect.succeed(""))
  )

  // Try to get remote URL for repo info
  const remoteCommand = PlatformCommand.make("git", "remote", "get-url", "origin")
  const remoteUrl = yield* PlatformCommand.string(remoteCommand).pipe(
    Effect.map(s => s.trim()),
    Effect.catchAll(() => Effect.succeed(""))
  )

  // Parse repo from remote URL (handles both https and ssh formats)
  let repo = ""
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/.]+)/)
  const sshMatch = remoteUrl.match(/github\.com:([^/]+\/[^/.]+)/)
  if (httpsMatch) repo = httpsMatch[1]!
  else if (sshMatch) repo = sshMatch[1]!

  return { sha, message, branch, repo }
})

/**
 * Create commit info block to prepend to gist
 */
const createCommitInfoBlock = (
  sha: string,
  message: string,
  branch: string,
  repo: string
): string => {
  const shortSha = sha.substring(0, 7)
  const commitUrl = repo ? `https://github.com/${repo}/commit/${sha}` : ""
  const commitLink = commitUrl ? `[${shortSha}](${commitUrl})` : shortSha

  // Extract just the first line of commit message
  const firstLine = message.split("\n")[0] || message

  return `> **Commit:** ${commitLink}
> **Branch:** ${branch}
> **Message:** ${firstLine}

---

`
}

const linkCommitCommand = Command.make(
  "link-commit",
  {
    gist: gistUrlOption,
    repo: repoOption
  },
  ({ gist, repo }) =>
    Effect.gen(function* () {
      const gistService = yield* GistService

      // Extract gist ID from URL or use as-is
      const gistId = gist.includes("/") ? gist.split("/").pop()! : gist

      // Get commit info
      const commitInfo = yield* getCommitInfo
      const effectiveRepo = Option.getOrElse(repo, () => commitInfo.repo)

      if (!commitInfo.sha) {
        yield* Console.error("No commit found")
        return
      }

      // Get the filename from the gist
      const filesCommand = PlatformCommand.make("gh", "gist", "view", gistId, "--files")
      const filename = yield* PlatformCommand.string(filesCommand).pipe(
        Effect.map(s => s.trim().split("\n")[0] || "session.md"),
        Effect.catchAll(() => Effect.succeed("session.md"))
      )

      // Fetch current gist content via gh CLI
      const viewCommand = PlatformCommand.make("gh", "gist", "view", gistId, "-f", filename)
      const currentContent = yield* PlatformCommand.string(viewCommand).pipe(
        Effect.catchAll(() => Effect.succeed(""))
      )

      // Create commit info block and prepend
      const commitBlock = createCommitInfoBlock(
        commitInfo.sha,
        commitInfo.message,
        commitInfo.branch,
        effectiveRepo
      )

      // Find the metadata table end (first --- after the table)
      // The content looks like: # Title\n\n| ... |\n\n---\n\n## First message
      const metadataEndMatch = currentContent.match(/\n---\n\n/)
      let updatedContent: string
      if (metadataEndMatch && metadataEndMatch.index !== undefined) {
        const insertPos = metadataEndMatch.index + metadataEndMatch[0].length
        updatedContent = currentContent.slice(0, insertPos) + commitBlock + currentContent.slice(insertPos)
      } else {
        // Fallback: prepend to content
        updatedContent = commitBlock + currentContent
      }

      // Update the gist
      yield* gistService.update({
        gistId,
        files: [{ filename, content: updatedContent }]
      })

      yield* Console.log(`Linked commit ${commitInfo.sha.substring(0, 7)} to gist ${gistId}`)
    }).pipe(
      Effect.catchAll((error) =>
        Console.error(`Failed to link commit: ${error}`)
      )
    )
)

// ============================================================================
// Main Command
// ============================================================================

const mainCommand = Command.make("claude-session").pipe(
  Command.withDescription("Export Claude Code sessions to GitHub Gists for decision provenance"),
  Command.withSubcommands([listCommand, exportCommand, gistCommand, hookCommand, linkCommitCommand])
)

// ============================================================================
// CLI Setup
// ============================================================================

const cli = Command.run(mainCommand, {
  name: "claude-session",
  version: "0.1.0"
})

// ============================================================================
// Layer Composition
// ============================================================================

const MainLayer = Layer.mergeAll(
  makeSessionService(),
  FormatterLive,
  GistServiceLive
)

// ============================================================================
// Run
// ============================================================================

cli(process.argv).pipe(
  Effect.provide(MainLayer),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
