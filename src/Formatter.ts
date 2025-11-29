/**
 * @since 0.1.0
 * 
 * Session formatting utilities for converting Claude Code sessions
 * to various output formats (Markdown, JSON, HTML).
 */
import { Context, Data, Effect, Layer, Option } from "effect"
import type { Session, NormalizedMessage, SessionMetadata } from "./Session.js"

// ============================================================================
// Errors
// ============================================================================

/**
 * @since 0.1.0
 * @category errors
 */
export class FormatterError extends Data.TaggedError("FormatterError")<{
  readonly reason: "InvalidFormat" | "TemplateError"
  readonly message: string
  readonly cause?: unknown
}> {}

// ============================================================================
// Types
// ============================================================================

/**
 * @since 0.1.0
 * @category models
 */
export type OutputFormat = "markdown" | "json" | "html"

/**
 * @since 0.1.0
 * @category models
 */
export interface FormatOptions {
  /** Include tool usage details */
  readonly includeToolUse: boolean
  /** Include timestamps if available */
  readonly includeTimestamps: boolean
  /** Maximum content length per message (0 = no limit) */
  readonly maxContentLength: number
  /** Include session metadata header */
  readonly includeMetadata: boolean
  /** Custom title (defaults to project name) */
  readonly title: Option.Option<string>
}

/**
 * @since 0.1.0
 * @category models
 */
export const defaultFormatOptions: FormatOptions = {
  includeToolUse: true,
  includeTimestamps: true,
  maxContentLength: 0,
  includeMetadata: true,
  title: Option.none()
}

// ============================================================================
// Formatter Service
// ============================================================================

/**
 * @since 0.1.0
 * @category tags
 */
export class Formatter extends Context.Tag("@effect/claude-session/Formatter")<
  Formatter,
  {
    /**
     * Format a session to the specified output format
     */
    readonly format: (
      session: Session,
      outputFormat: OutputFormat,
      options?: Partial<FormatOptions>
    ) => Effect.Effect<string, FormatterError>

    /**
     * Format session to Markdown
     */
    readonly toMarkdown: (
      session: Session,
      options?: Partial<FormatOptions>
    ) => Effect.Effect<string, FormatterError>

    /**
     * Format session to JSON
     */
    readonly toJson: (
      session: Session,
      options?: Partial<FormatOptions>
    ) => Effect.Effect<string, FormatterError>

    /**
     * Format session to HTML
     */
    readonly toHtml: (
      session: Session,
      options?: Partial<FormatOptions>
    ) => Effect.Effect<string, FormatterError>

    /**
     * Generate a filename for the session export
     */
    readonly generateFilename: (
      metadata: SessionMetadata,
      format: OutputFormat
    ) => string
  }
>() {}

// ============================================================================
// Formatting Helpers
// ============================================================================

const truncateContent = (content: string, maxLength: number): string => {
  if (maxLength <= 0 || content.length <= maxLength) {
    return content
  }
  return content.substring(0, maxLength) + "\n\n...(truncated)"
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")

const formatTimestamp = (date: Date): string =>
  date.toISOString().replace("T", " ").substring(0, 19)

const formatMessageMarkdown = (
  msg: NormalizedMessage,
  index: number,
  options: FormatOptions
): string => {
  const emoji = msg.role === "user" ? "👤" : "🤖"
  const roleName = msg.role === "user" ? "User" : "Claude"

  let output = `## ${emoji} ${roleName} (${index + 1})`

  if (options.includeTimestamps && Option.isSome(msg.timestamp)) {
    output += ` - ${formatTimestamp(msg.timestamp.value)}`
  }

  output += "\n\n"

  const hasTextContent = msg.content.trim().length > 0
  const hasToolUses = msg.toolUses.length > 0

  if (hasTextContent) {
    output += truncateContent(msg.content, options.maxContentLength)
  } else if (hasToolUses && options.includeToolUse) {
    // Tool-use-only message: show as a compact summary
    const toolNames = msg.toolUses.map(t => t.name)
    const uniqueTools = [...new Set(toolNames)]
    output += `*Used tools: ${uniqueTools.join(", ")}*`
  }

  // Show tool details if enabled and message has text content
  if (options.includeToolUse && hasToolUses && hasTextContent) {
    output += "\n\n<details>\n<summary>Tool Uses</summary>\n\n"
    for (const tool of msg.toolUses) {
      output += `**${tool.name}**\n`
      output += "```json\n"
      output += JSON.stringify(tool.input, null, 2)
      output += "\n```\n\n"
    }
    output += "</details>"
  }

  return output + "\n\n---\n\n"
}

const formatMetadataMarkdown = (
  metadata: SessionMetadata,
  title: Option.Option<string>
): string => {
  const displayTitle = Option.getOrElse(title, () => metadata.projectName)
  
  return `# Claude Code Session: ${displayTitle}

| Property | Value |
|----------|-------|
| **Session ID** | \`${metadata.id}\` |
| **Project** | ${metadata.projectName} |
| **Last Modified** | ${formatTimestamp(metadata.lastModified)} |
| **Messages** | ${metadata.messageCount} |
| **Size** | ${(metadata.sizeBytes / 1024).toFixed(1)} KB |

---

`
}

// ============================================================================
// Markdown Formatter
// ============================================================================

/**
 * Check if a message has displayable content
 *
 * Shows messages with:
 * - Text content (always)
 * - Tool uses from assistant (formatted as summary)
 *
 * Filters out:
 * - User messages with only tool_result (internal responses to tool calls)
 * - Messages with no content at all
 */
const hasDisplayableContent = (msg: NormalizedMessage, options: FormatOptions): boolean => {
  // Has text content - always show
  if (msg.content.trim().length > 0) return true

  // Assistant messages with tool uses - show as summary when tools enabled
  if (msg.role === "assistant" && options.includeToolUse && msg.toolUses.length > 0) {
    return true
  }

  // User messages with only tool_result are internal - skip
  return false
}

const formatToMarkdown = (
  session: Session,
  options: FormatOptions
): string => {
  let output = ""

  if (options.includeMetadata) {
    output += formatMetadataMarkdown(session.metadata, options.title)
  }

  // Filter to only messages with displayable content
  const displayableMessages = session.messages.filter(msg =>
    hasDisplayableContent(msg, options)
  )

  displayableMessages.forEach((msg, index) => {
    output += formatMessageMarkdown(msg, index, options)
  })

  output += `\n*Exported by @effect/claude-session on ${new Date().toISOString()}*\n`

  return output
}

// ============================================================================
// JSON Formatter
// ============================================================================

interface JsonExport {
  readonly metadata: {
    readonly sessionId: string
    readonly project: string
    readonly lastModified: string
    readonly messageCount: number
    readonly exportedAt: string
  }
  readonly messages: ReadonlyArray<{
    readonly role: "user" | "assistant"
    readonly content: string
    readonly timestamp: string | null
    readonly toolUses?: ReadonlyArray<{ name: string; input: unknown }>
    readonly toolResults?: ReadonlyArray<{ content: unknown }>
  }>
}

const formatToJson = (
  session: Session,
  options: FormatOptions
): string => {
  // Filter to only messages with displayable content
  const displayableMessages = session.messages.filter(msg =>
    hasDisplayableContent(msg, options)
  )

  const exportData: JsonExport = {
    metadata: {
      sessionId: session.metadata.id,
      project: session.metadata.projectName,
      lastModified: session.metadata.lastModified.toISOString(),
      messageCount: displayableMessages.length,
      exportedAt: new Date().toISOString()
    },
    messages: displayableMessages.map(msg => ({
      role: msg.role,
      content: truncateContent(msg.content, options.maxContentLength),
      timestamp: Option.isSome(msg.timestamp)
        ? msg.timestamp.value.toISOString()
        : null,
      ...(options.includeToolUse && msg.toolUses.length > 0
        ? { toolUses: msg.toolUses }
        : {}),
      ...(options.includeToolUse && msg.toolResults.length > 0
        ? { toolResults: msg.toolResults }
        : {})
    }))
  }

  return JSON.stringify(exportData, null, 2)
}

// ============================================================================
// HTML Formatter
// ============================================================================

const formatToHtml = (
  session: Session,
  options: FormatOptions
): string => {
  const title = Option.getOrElse(options.title, () => session.metadata.projectName)

  // Filter to only messages with displayable content
  const displayableMessages = session.messages.filter(msg =>
    hasDisplayableContent(msg, options)
  )

  const messagesHtml = displayableMessages.map((msg, index) => {
    const roleClass = msg.role === "user" ? "user" : "assistant"
    const emoji = msg.role === "user" ? "👤" : "🤖"
    const roleName = msg.role === "user" ? "User" : "Claude"
    
    const timestamp = options.includeTimestamps && Option.isSome(msg.timestamp)
      ? `<span class="timestamp">${formatTimestamp(msg.timestamp.value)}</span>`
      : ""
    
    const contentHtml = escapeHtml(truncateContent(msg.content, options.maxContentLength))
      .replace(/\n/g, "<br>")
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    
    let toolHtml = ""
    if (options.includeToolUse && msg.toolUses.length > 0) {
      toolHtml += '<div class="tool-uses"><h4>Tool Uses</h4>'
      for (const tool of msg.toolUses) {
        toolHtml += `<div class="tool"><strong>${escapeHtml(tool.name)}</strong>`
        toolHtml += `<pre><code>${escapeHtml(JSON.stringify(tool.input, null, 2))}</code></pre></div>`
      }
      toolHtml += "</div>"
    }
    
    return `
    <div class="message ${roleClass}">
      <div class="message-header">
        <span class="role">${emoji} ${roleName} (${index + 1})</span>
        ${timestamp}
      </div>
      <div class="message-content">${contentHtml}</div>
      ${toolHtml}
    </div>`
  }).join("\n")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Session: ${escapeHtml(title)}</title>
  <style>
    :root {
      --bg-primary: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-user: #0f3460;
      --bg-assistant: #1a1a2e;
      --text-primary: #e8e8e8;
      --text-secondary: #a0a0a0;
      --accent: #e94560;
      --border: #2a2a4a;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 2rem;
    }
    
    .container { max-width: 900px; margin: 0 auto; }
    
    header {
      background: var(--bg-secondary);
      padding: 2rem;
      border-radius: 12px;
      margin-bottom: 2rem;
      border: 1px solid var(--border);
    }
    
    h1 { color: var(--accent); margin-bottom: 1rem; }
    
    .metadata { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .metadata-item { background: var(--bg-primary); padding: 0.75rem 1rem; border-radius: 8px; }
    .metadata-item label { color: var(--text-secondary); font-size: 0.85rem; display: block; }
    .metadata-item span { font-weight: 500; }
    
    .message {
      padding: 1.5rem;
      margin-bottom: 1rem;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    
    .message.user { background: var(--bg-user); }
    .message.assistant { background: var(--bg-assistant); }
    
    .message-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    .role { font-weight: 600; font-size: 1.1rem; }
    .timestamp { color: var(--text-secondary); font-size: 0.85rem; }
    
    .message-content { white-space: pre-wrap; word-wrap: break-word; }
    
    pre {
      background: var(--bg-primary);
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    
    code { font-family: 'Fira Code', 'Monaco', monospace; font-size: 0.9rem; }
    
    .tool-uses { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    .tool-uses h4 { color: var(--accent); margin-bottom: 0.5rem; }
    .tool { margin-bottom: 1rem; }
    
    footer {
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.85rem;
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🤖 Claude Code Session</h1>
      ${options.includeMetadata ? `
      <div class="metadata">
        <div class="metadata-item">
          <label>Project</label>
          <span>${escapeHtml(session.metadata.projectName)}</span>
        </div>
        <div class="metadata-item">
          <label>Session ID</label>
          <span>${escapeHtml(session.metadata.id)}</span>
        </div>
        <div class="metadata-item">
          <label>Last Modified</label>
          <span>${formatTimestamp(session.metadata.lastModified)}</span>
        </div>
        <div class="metadata-item">
          <label>Messages</label>
          <span>${displayableMessages.length}</span>
        </div>
      </div>
      ` : ""}
    </header>
    
    <main>
      ${messagesHtml}
    </main>
    
    <footer>
      Exported by @effect/claude-session on ${new Date().toISOString()}
    </footer>
  </div>
</body>
</html>`
}

// ============================================================================
// Live Implementation
// ============================================================================

/**
 * @since 0.1.0
 * @category layers
 */
export const FormatterLive = Layer.succeed(
  Formatter,
  {
    format: (session, outputFormat, partialOptions) => {
      const options: FormatOptions = { ...defaultFormatOptions, ...partialOptions }
      
      return Effect.sync(() => {
        switch (outputFormat) {
          case "markdown":
            return formatToMarkdown(session, options)
          case "json":
            return formatToJson(session, options)
          case "html":
            return formatToHtml(session, options)
        }
      })
    },

    toMarkdown: (session, partialOptions) => {
      const options: FormatOptions = { ...defaultFormatOptions, ...partialOptions }
      return Effect.sync(() => formatToMarkdown(session, options))
    },

    toJson: (session, partialOptions) => {
      const options: FormatOptions = { ...defaultFormatOptions, ...partialOptions }
      return Effect.sync(() => formatToJson(session, options))
    },

    toHtml: (session, partialOptions) => {
      const options: FormatOptions = { ...defaultFormatOptions, ...partialOptions }
      return Effect.sync(() => formatToHtml(session, options))
    },

    generateFilename: (metadata, format) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
      const projectSlug = metadata.projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .substring(0, 30)
      
      const ext = format === "markdown" ? "md" : format
      return `claude-session-${projectSlug}-${timestamp}.${ext}`
    }
  }
)
