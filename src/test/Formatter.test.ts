import { describe, it, expect } from "vitest"
import { Effect, Option } from "effect"
import { Formatter, FormatterLive } from "../Formatter.js"
import type { Session, NormalizedMessage } from "../Session.js"

const createMessage = (
  role: "user" | "assistant",
  content: string,
  toolUses: Array<{ name: string; input: unknown }> = [],
  toolResults: Array<{ content: unknown }> = []
): NormalizedMessage => ({
  role,
  content,
  toolUses,
  toolResults,
  timestamp: Option.none()
})

const createSession = (messages: Array<NormalizedMessage>): Session => ({
  metadata: {
    id: "test-session-id",
    projectPath: "/test/project",
    projectName: "test-project",
    filePath: "/test/project/session.jsonl",
    lastModified: new Date("2025-01-01T00:00:00Z"),
    messageCount: messages.length,
    sizeBytes: 1000
  },
  messages
})

describe("Formatter", () => {
  describe("hasDisplayableContent filtering", () => {
    it("should include messages with text content", async () => {
      const session = createSession([
        createMessage("user", "Hello, how are you?"),
        createMessage("assistant", "I'm doing well, thank you!")
      ])

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const formatter = yield* Formatter
          return yield* formatter.toMarkdown(session)
        }).pipe(Effect.provide(FormatterLive))
      )

      expect(result).toContain("Hello, how are you?")
      expect(result).toContain("I'm doing well, thank you!")
    })

    it("should filter out messages with only whitespace content", async () => {
      const session = createSession([
        createMessage("user", "Hello"),
        createMessage("assistant", "   "), // Only whitespace
        createMessage("assistant", "Real response")
      ])

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const formatter = yield* Formatter
          return yield* formatter.toMarkdown(session)
        }).pipe(Effect.provide(FormatterLive))
      )

      expect(result).toContain("Hello")
      expect(result).toContain("Real response")
      // Should only have 2 message entries, not 3
      const userMatches = result.match(/## 👤 User/g)
      const claudeMatches = result.match(/## 🤖 Claude/g)
      expect(userMatches?.length).toBe(1)
      expect(claudeMatches?.length).toBe(1)
    })

    it("should show tool-use-only messages as summaries when tools enabled", async () => {
      const session = createSession([
        createMessage("user", "Do something"),
        createMessage("assistant", "", [{ name: "Bash", input: { command: "ls" } }]), // Tool use only
        createMessage("assistant", "Here's what I found")
      ])

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const formatter = yield* Formatter
          return yield* formatter.toMarkdown(session, { includeToolUse: true })
        }).pipe(Effect.provide(FormatterLive))
      )

      expect(result).toContain("Do something")
      expect(result).toContain("Here's what I found")
      expect(result).toContain("*Used tools: Bash*")
      // Should have 2 Claude messages (tool use summary + text)
      const claudeMatches = result.match(/## 🤖 Claude/g)
      expect(claudeMatches?.length).toBe(2)
    })

    it("should filter out tool-use-only messages when tools disabled", async () => {
      const session = createSession([
        createMessage("user", "Do something"),
        createMessage("assistant", "", [{ name: "Bash", input: { command: "ls" } }]), // Tool use only
        createMessage("assistant", "Here's what I found")
      ])

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const formatter = yield* Formatter
          return yield* formatter.toMarkdown(session, { includeToolUse: false })
        }).pipe(Effect.provide(FormatterLive))
      )

      expect(result).toContain("Do something")
      expect(result).toContain("Here's what I found")
      expect(result).not.toContain("Used tools")
      // Only one Claude message when tools disabled
      const claudeMatches = result.match(/## 🤖 Claude/g)
      expect(claudeMatches?.length).toBe(1)
    })

    it("should filter out user messages with only tool results", async () => {
      const session = createSession([
        createMessage("user", "Run a command"),
        createMessage("assistant", "Running the command now"),
        createMessage("user", "", [], [{ content: "command output" }]), // Tool result only
        createMessage("assistant", "The command succeeded")
      ])

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const formatter = yield* Formatter
          return yield* formatter.toMarkdown(session)
        }).pipe(Effect.provide(FormatterLive))
      )

      // Should only show user messages with actual text
      const userMatches = result.match(/## 👤 User/g)
      expect(userMatches?.length).toBe(1)
      expect(result).toContain("Run a command")
      expect(result).not.toContain("command output")
    })

    it("should show tool uses when message also has text content", async () => {
      const session = createSession([
        createMessage("user", "List files"),
        createMessage(
          "assistant",
          "Let me list the files for you:",
          [{ name: "Bash", input: { command: "ls -la" } }]
        )
      ])

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const formatter = yield* Formatter
          return yield* formatter.toMarkdown(session, { includeToolUse: true })
        }).pipe(Effect.provide(FormatterLive))
      )

      expect(result).toContain("List files")
      expect(result).toContain("Let me list the files for you:")
      expect(result).toContain("Bash")
      expect(result).toContain("ls -la")
    })
  })

  describe("message count in metadata", () => {
    it("should show filtered message count, not total", async () => {
      const session = createSession([
        createMessage("user", "Hello"),
        createMessage("assistant", ""), // Filtered
        createMessage("assistant", ""), // Filtered
        createMessage("assistant", "Hi there!")
      ])

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const formatter = yield* Formatter
          return yield* formatter.toMarkdown(session)
        }).pipe(Effect.provide(FormatterLive))
      )

      // The metadata should show the original count (4), but only 2 messages displayed
      expect(result).toContain("| **Messages** | 4 |")
      // Only 2 actual message sections rendered
      const userMatches = result.match(/## 👤 User/g)
      const claudeMatches = result.match(/## 🤖 Claude/g)
      expect(userMatches?.length).toBe(1)
      expect(claudeMatches?.length).toBe(1)
    })
  })
})
