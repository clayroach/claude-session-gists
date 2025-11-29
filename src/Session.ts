/**
 * @since 0.1.0
 * 
 * Claude Code Session domain types and services.
 * 
 * This module provides the core abstractions for working with Claude Code
 * session data, including schemas for parsing JSONL files and services
 * for discovering and loading sessions.
 */
import { Schema } from "effect"
import { Context, Data, Effect, Layer, Option, Stream } from "effect"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"

// ============================================================================
// Errors
// ============================================================================

/**
 * @since 0.1.0
 * @category errors
 */
export class SessionError extends Data.TaggedError("SessionError")<{
  readonly reason: "NotFound" | "ParseError" | "IoError" | "InvalidFormat"
  readonly message: string
  readonly cause?: unknown
}> {}

// ============================================================================
// Domain Types
// ============================================================================

/**
 * @since 0.1.0
 * @category schemas
 * 
 * Content block within a message - can be text, tool use, or tool result
 */
export const ContentBlock = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal("tool_use"),
    id: Schema.optional(Schema.String),
    name: Schema.String,
    input: Schema.Unknown
  }),
  Schema.Struct({
    type: Schema.Literal("tool_result"),
    tool_use_id: Schema.optional(Schema.String),
    content: Schema.Unknown
  })
)

/**
 * @since 0.1.0
 * @category schemas
 */
export type ContentBlock = typeof ContentBlock.Type

/**
 * @since 0.1.0
 * @category schemas
 * 
 * Message content - either a string or array of content blocks
 */
export const MessageContent = Schema.Union(
  Schema.String,
  Schema.Array(ContentBlock)
)

/**
 * @since 0.1.0
 * @category schemas
 */
export type MessageContent = typeof MessageContent.Type

/**
 * @since 0.1.0
 * @category schemas
 * 
 * A single message in a Claude Code session
 */
export const SessionMessage = Schema.Struct({
  type: Schema.Union(
    Schema.Literal("user"),
    Schema.Literal("human"),
    Schema.Literal("assistant")
  ),
  message: Schema.optional(Schema.Struct({
    role: Schema.optional(Schema.String),
    content: MessageContent
  })),
  content: Schema.optional(MessageContent),
  timestamp: Schema.optional(Schema.String)
})

/**
 * @since 0.1.0
 * @category schemas
 */
export type SessionMessage = typeof SessionMessage.Type

/**
 * @since 0.1.0
 * @category models
 * 
 * Normalized message for easier processing
 */
export interface NormalizedMessage {
  readonly role: "user" | "assistant"
  readonly content: string
  readonly toolUses: ReadonlyArray<{
    readonly name: string
    readonly input: unknown
  }>
  readonly toolResults: ReadonlyArray<{
    readonly content: unknown
  }>
  readonly timestamp: Option.Option<Date>
}

/**
 * @since 0.1.0
 * @category models
 * 
 * Metadata about a Claude Code session
 */
export interface SessionMetadata {
  readonly id: string
  readonly projectPath: string
  readonly projectName: string
  readonly filePath: string
  readonly lastModified: Date
  readonly messageCount: number
  readonly sizeBytes: number
}

/**
 * @since 0.1.0
 * @category models
 * 
 * A complete Claude Code session with messages and metadata
 */
export interface Session {
  readonly metadata: SessionMetadata
  readonly messages: ReadonlyArray<NormalizedMessage>
}

// ============================================================================
// Session Discovery Service
// ============================================================================

/**
 * @since 0.1.0
 * @category models
 *
 * Configuration options for session discovery
 */
export interface SessionConfigOptions {
  readonly claudeDir: string
  readonly projectFilter: Option.Option<string>
}

/**
 * @since 0.1.0
 * @category tags
 */
export class SessionConfig extends Context.Tag("@effect/claude-session/SessionConfig")<
  SessionConfig,
  SessionConfigOptions
>() {
  /**
   * Default configuration using ~/.claude
   */
  static readonly Default = Layer.succeed(
    SessionConfig,
    {
      claudeDir: `${process.env["HOME"] ?? "~"}/.claude`,
      projectFilter: Option.none()
    }
  )

  /**
   * Create a custom configuration
   */
  static readonly make = (config: Partial<SessionConfigOptions>) =>
    Layer.succeed(SessionConfig, {
      claudeDir: config.claudeDir ?? `${process.env["HOME"] ?? "~"}/.claude`,
      projectFilter: config.projectFilter ?? Option.none()
    })
}

/**
 * @since 0.1.0
 * @category tags
 * 
 * Service for discovering and loading Claude Code sessions
 */
export class SessionService extends Context.Tag("@effect/claude-session/SessionService")<
  SessionService,
  {
    /**
     * Discover all available sessions
     */
    readonly discover: Effect.Effect<
      ReadonlyArray<SessionMetadata>,
      SessionError
    >

    /**
     * Stream all sessions as they're discovered
     */
    readonly stream: Stream.Stream<SessionMetadata, SessionError>

    /**
     * Load a specific session by metadata
     */
    readonly load: (
      metadata: SessionMetadata
    ) => Effect.Effect<Session, SessionError>

    /**
     * Load the most recent session
     */
    readonly loadMostRecent: Effect.Effect<Session, SessionError>

    /**
     * Load a session by project name (partial match)
     */
    readonly loadByProject: (
      projectName: string
    ) => Effect.Effect<Session, SessionError>
  }
>() {}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * @internal
 * Extract text content from a message
 */
const extractTextContent = (content: MessageContent): string => {
  if (typeof content === "string") {
    return content
  }
  return content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => 
      block.type === "text"
    )
    .map(block => block.text)
    .join("\n")
}

/**
 * @internal
 * Extract tool uses from content blocks
 */
const extractToolUses = (content: MessageContent): ReadonlyArray<{ name: string; input: unknown }> => {
  if (typeof content === "string") return []
  return content
    .filter((block): block is Extract<ContentBlock, { type: "tool_use" }> =>
      block.type === "tool_use"
    )
    .map(block => ({ name: block.name, input: block.input }))
}

/**
 * @internal
 * Extract tool results from content blocks
 */
const extractToolResults = (content: MessageContent): ReadonlyArray<{ content: unknown }> => {
  if (typeof content === "string") return []
  return content
    .filter((block): block is Extract<ContentBlock, { type: "tool_result" }> =>
      block.type === "tool_result"
    )
    .map(block => ({ content: block.content }))
}

/**
 * @internal
 * Normalize a raw session message
 */
export const normalizeMessage = (raw: SessionMessage): Option.Option<NormalizedMessage> => {
  const content = raw.message?.content ?? raw.content
  if (content === undefined) return Option.none()

  const role = raw.type === "assistant" ? "assistant" as const : "user" as const

  return Option.some({
    role,
    content: extractTextContent(content),
    toolUses: extractToolUses(content),
    toolResults: extractToolResults(content),
    timestamp: raw.timestamp 
      ? Option.some(new Date(raw.timestamp))
      : Option.none()
  })
}

/**
 * @internal
 * Parse a JSONL line into a SessionMessage
 */
export const parseJsonlLine = (line: string): Effect.Effect<SessionMessage, SessionError> =>
  Effect.try({
    try: () => JSON.parse(line) as unknown,
    catch: (error) => new SessionError({
      reason: "ParseError",
      message: `Failed to parse JSON line: ${line.substring(0, 100)}...`,
      cause: error
    })
  }).pipe(
    Effect.flatMap((json) =>
      Schema.decodeUnknown(SessionMessage)(json).pipe(
        Effect.mapError((error) => new SessionError({
          reason: "InvalidFormat",
          message: `Invalid session message format`,
          cause: error
        }))
      )
    )
  )

// ============================================================================
// Live Implementation
// ============================================================================

/**
 * @since 0.1.0
 * @category layers
 * 
 * Live implementation of the SessionService
 */
export const SessionServiceLive = Layer.effect(
  SessionService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const config = yield* SessionConfig

    const projectsDir = path.join(config.claudeDir, "projects")

    const discoverSessions: Effect.Effect<ReadonlyArray<SessionMetadata>, SessionError> =
      Effect.gen(function* () {
        // Check if projects directory exists
        const exists = yield* fs.exists(projectsDir).pipe(
          Effect.mapError((e) => new SessionError({
            reason: "IoError",
            message: `Failed to check projects directory: ${projectsDir}`,
            cause: e
          }))
        )

        if (!exists) {
          return []
        }

        // List project directories
        const entries = yield* fs.readDirectory(projectsDir).pipe(
          Effect.mapError((e) => new SessionError({
            reason: "IoError",
            message: `Failed to read projects directory`,
            cause: e
          }))
        )

        // Find all chat_*.jsonl files
        const sessions: SessionMetadata[] = []

        for (const entry of entries) {
          const projectPath = path.join(projectsDir, entry)
          
          // Apply project filter if set
          if (Option.isSome(config.projectFilter)) {
            const filter = Option.getOrThrow(config.projectFilter)
            if (!entry.toLowerCase().includes(filter.toLowerCase())) {
              continue
            }
          }

          const projectEntries = yield* fs.readDirectory(projectPath).pipe(
            Effect.catchAll(() => Effect.succeed([] as string[]))
          )

          for (const file of projectEntries) {
            if (file.startsWith("chat_") && file.endsWith(".jsonl")) {
              const filePath = path.join(projectPath, file)
              const stat = yield* fs.stat(filePath).pipe(
                Effect.catchAll(() => Effect.succeed(null))
              )

              if (stat && Option.isSome(stat.mtime)) {
                const sessionId = file.replace("chat_", "").replace(".jsonl", "")

                // Count lines (messages)
                const content = yield* fs.readFileString(filePath).pipe(
                  Effect.catchAll(() => Effect.succeed(""))
                )
                const messageCount = content.split("\n").filter(l => l.trim()).length

                sessions.push({
                  id: sessionId,
                  projectPath: projectPath,
                  projectName: entry,
                  filePath: filePath,
                  lastModified: Option.getOrThrow(stat.mtime),
                  messageCount,
                  sizeBytes: Number(stat.size)
                })
              }
            }
          }
        }

        // Sort by last modified, most recent first
        return sessions.sort((a, b) => 
          b.lastModified.getTime() - a.lastModified.getTime()
        )
      })

    const loadSession = (metadata: SessionMetadata): Effect.Effect<Session, SessionError> =>
      Effect.gen(function* () {
        const content = yield* fs.readFileString(metadata.filePath).pipe(
          Effect.mapError((e) => new SessionError({
            reason: "IoError",
            message: `Failed to read session file: ${metadata.filePath}`,
            cause: e
          }))
        )

        const lines = content.split("\n").filter(l => l.trim())
        const messages: NormalizedMessage[] = []

        for (const line of lines) {
          const parsed = yield* parseJsonlLine(line).pipe(
            Effect.catchAll(() => Effect.succeed(null))
          )
          
          if (parsed) {
            const normalized = normalizeMessage(parsed)
            if (Option.isSome(normalized)) {
              messages.push(Option.getOrThrow(normalized))
            }
          }
        }

        return {
          metadata,
          messages
        }
      })

    return {
      discover: discoverSessions,
      
      stream: Stream.fromEffect(discoverSessions).pipe(
        Stream.flatMap(sessions => Stream.fromIterable(sessions))
      ),

      load: loadSession,

      loadMostRecent: Effect.gen(function* () {
        const sessions = yield* discoverSessions
        if (sessions.length === 0) {
          return yield* Effect.fail(new SessionError({
            reason: "NotFound",
            message: "No Claude Code sessions found"
          }))
        }
        return yield* loadSession(sessions[0]!)
      }),

      loadByProject: (projectName: string) =>
        Effect.gen(function* () {
          const sessions = yield* discoverSessions
          const matching = sessions.find(s => 
            s.projectName.toLowerCase().includes(projectName.toLowerCase())
          )
          if (!matching) {
            return yield* Effect.fail(new SessionError({
              reason: "NotFound",
              message: `No session found for project: ${projectName}`
            }))
          }
          return yield* loadSession(matching)
        })
    }
  })
).pipe(
  Layer.provide(SessionConfig.Default)
)

/**
 * @since 0.1.0
 * @category constructors
 *
 * Create a SessionService layer with custom configuration
 */
export const makeSessionService = (config?: Partial<SessionConfigOptions>) =>
  Layer.effect(
    SessionService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path

      const effectiveConfig: SessionConfigOptions = {
        claudeDir: config?.claudeDir ?? `${process.env["HOME"] ?? "~"}/.claude`,
        projectFilter: config?.projectFilter ?? Option.none()
      }

      const projectsDir = pathService.join(effectiveConfig.claudeDir, "projects")

      // Implementation mirrors SessionServiceLive but with custom config
      const discoverSessions: Effect.Effect<ReadonlyArray<SessionMetadata>, SessionError> =
        Effect.gen(function* () {
          const exists = yield* fs.exists(projectsDir).pipe(
            Effect.mapError((e) => new SessionError({
              reason: "IoError",
              message: `Failed to check projects directory: ${projectsDir}`,
              cause: e
            }))
          )

          if (!exists) {
            return []
          }

          const entries = yield* fs.readDirectory(projectsDir).pipe(
            Effect.mapError((e) => new SessionError({
              reason: "IoError",
              message: `Failed to read projects directory`,
              cause: e
            }))
          )

          const sessions: SessionMetadata[] = []

          for (const entry of entries) {
            const projectPath = pathService.join(projectsDir, entry)
            
            if (Option.isSome(effectiveConfig.projectFilter)) {
              const filter = Option.getOrThrow(effectiveConfig.projectFilter)
              if (!entry.toLowerCase().includes(filter.toLowerCase())) {
                continue
              }
            }

            const projectEntries = yield* fs.readDirectory(projectPath).pipe(
              Effect.catchAll(() => Effect.succeed([] as string[]))
            )

            for (const file of projectEntries) {
              if (file.startsWith("chat_") && file.endsWith(".jsonl")) {
                const filePath = pathService.join(projectPath, file)
                const stat = yield* fs.stat(filePath).pipe(
                  Effect.catchAll(() => Effect.succeed(null))
                )

                if (stat && Option.isSome(stat.mtime)) {
                  const sessionId = file.replace("chat_", "").replace(".jsonl", "")
                  const content = yield* fs.readFileString(filePath).pipe(
                    Effect.catchAll(() => Effect.succeed(""))
                  )
                  const messageCount = content.split("\n").filter(l => l.trim()).length

                  sessions.push({
                    id: sessionId,
                    projectPath: projectPath,
                    projectName: entry,
                    filePath: filePath,
                    lastModified: Option.getOrThrow(stat.mtime),
                    messageCount,
                    sizeBytes: Number(stat.size)
                  })
                }
              }
            }
          }

          return sessions.sort((a, b) => 
            b.lastModified.getTime() - a.lastModified.getTime()
          )
        })

      const loadSession = (metadata: SessionMetadata): Effect.Effect<Session, SessionError> =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(metadata.filePath).pipe(
            Effect.mapError((e) => new SessionError({
              reason: "IoError",
              message: `Failed to read session file: ${metadata.filePath}`,
              cause: e
            }))
          )

          const lines = content.split("\n").filter(l => l.trim())
          const messages: NormalizedMessage[] = []

          for (const line of lines) {
            const parsed = yield* parseJsonlLine(line).pipe(
              Effect.catchAll(() => Effect.succeed(null))
            )
            
            if (parsed) {
              const normalized = normalizeMessage(parsed)
              if (Option.isSome(normalized)) {
                messages.push(Option.getOrThrow(normalized))
              }
            }
          }

          return { metadata, messages }
        })

      return {
        discover: discoverSessions,
        stream: Stream.fromEffect(discoverSessions).pipe(
          Stream.flatMap(sessions => Stream.fromIterable(sessions))
        ),
        load: loadSession,
        loadMostRecent: Effect.gen(function* () {
          const sessions = yield* discoverSessions
          if (sessions.length === 0) {
            return yield* Effect.fail(new SessionError({
              reason: "NotFound",
              message: "No Claude Code sessions found"
            }))
          }
          return yield* loadSession(sessions[0]!)
        }),
        loadByProject: (projectName: string) =>
          Effect.gen(function* () {
            const sessions = yield* discoverSessions
            const matching = sessions.find(s => 
              s.projectName.toLowerCase().includes(projectName.toLowerCase())
            )
            if (!matching) {
              return yield* Effect.fail(new SessionError({
                reason: "NotFound",
                message: `No session found for project: ${projectName}`
              }))
            }
            return yield* loadSession(matching)
          })
      }
    })
  )
