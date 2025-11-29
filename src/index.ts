/**
 * @since 0.1.0
 * 
 * @effect/claude-session - Effect-TS utilities for extracting and archiving Claude Code sessions
 * 
 * This package provides a type-safe, functional approach to working with
 * Claude Code session data. It enables you to:
 * 
 * - Discover and load Claude Code sessions from ~/.claude/projects
 * - Parse the JSONL session format into structured data
 * - Format sessions as Markdown, JSON, or HTML
 * - Archive sessions to GitHub Gists for decision provenance
 * 
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { NodeContext, NodeRuntime } from "@effect/platform-node"
 * import { SessionService, SessionServiceLive, Formatter, FormatterLive } from "@effect/claude-session"
 * 
 * const program = Effect.gen(function* () {
 *   const sessions = yield* SessionService
 *   const formatter = yield* Formatter
 *   
 *   // Load the most recent session
 *   const session = yield* sessions.loadMostRecent
 *   
 *   // Format as markdown
 *   const markdown = yield* formatter.toMarkdown(session)
 *   
 *   console.log(markdown)
 * })
 * 
 * program.pipe(
 *   Effect.provide(SessionServiceLive),
 *   Effect.provide(FormatterLive),
 *   Effect.provide(NodeContext.layer),
 *   NodeRuntime.runMain
 * )
 * ```
 */

// ============================================================================
// Session Module
// ============================================================================

export {
  /**
   * Error type for session operations
   * @since 0.1.0
   */
  SessionError,
  
  /**
   * Schema for content blocks within messages
   * @since 0.1.0
   */
  ContentBlock,
  
  /**
   * Schema for message content
   * @since 0.1.0
   */
  MessageContent,
  
  /**
   * Schema for raw session messages
   * @since 0.1.0
   */
  SessionMessage,
  
  /**
   * Normalized message type
   * @since 0.1.0
   */
  type NormalizedMessage,
  
  /**
   * Session metadata type
   * @since 0.1.0
   */
  type SessionMetadata,
  
  /**
   * Complete session type
   * @since 0.1.0
   */
  type Session,
  
  /**
   * Configuration tag for session discovery
   * @since 0.1.0
   */
  SessionConfig,
  
  /**
   * Session service tag
   * @since 0.1.0
   */
  SessionService,
  
  /**
   * Live implementation of SessionService
   * @since 0.1.0
   */
  SessionServiceLive,
  
  /**
   * Create a custom SessionService layer
   * @since 0.1.0
   */
  makeSessionService,
  
  /**
   * Normalize a raw session message
   * @since 0.1.0
   */
  normalizeMessage,
  
  /**
   * Parse a JSONL line
   * @since 0.1.0
   */
  parseJsonlLine
} from "./Session.js"

// ============================================================================
// Formatter Module
// ============================================================================

export {
  /**
   * Error type for formatter operations
   * @since 0.1.0
   */
  FormatterError,
  
  /**
   * Output format type
   * @since 0.1.0
   */
  type OutputFormat,
  
  /**
   * Format options type
   * @since 0.1.0
   */
  type FormatOptions,
  
  /**
   * Default format options
   * @since 0.1.0
   */
  defaultFormatOptions,
  
  /**
   * Formatter service tag
   * @since 0.1.0
   */
  Formatter,
  
  /**
   * Live implementation of Formatter
   * @since 0.1.0
   */
  FormatterLive
} from "./Formatter.js"

// ============================================================================
// Gist Module
// ============================================================================

export {
  /**
   * Error type for gist operations
   * @since 0.1.0
   */
  GistError,
  
  /**
   * Gist file type
   * @since 0.1.0
   */
  type GistFile,
  
  /**
   * Gist creation options
   * @since 0.1.0
   */
  type GistCreateOptions,
  
  /**
   * Gist result type
   * @since 0.1.0
   */
  type GistResult,
  
  /**
   * Gist configuration tag
   * @since 0.1.0
   */
  GistConfig,
  
  /**
   * Gist service tag
   * @since 0.1.0
   */
  GistService,
  
  /**
   * Live implementation of GistService
   * @since 0.1.0
   */
  GistServiceLive,
  
  /**
   * Create a custom GistService layer
   * @since 0.1.0
   */
  makeGistService
} from "./Gist.js"
