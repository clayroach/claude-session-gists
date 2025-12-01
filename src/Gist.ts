/**
 * @since 0.1.0
 *
 * GitHub Gist integration for archiving Claude Code sessions.
 *
 * This module provides services for creating and managing GitHub Gists
 * containing exported Claude Code sessions.
 */
import { Context, Data, Effect, Layer, Option, Schedule, Scope } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"

// ============================================================================
// Errors
// ============================================================================

/**
 * @since 0.1.0
 * @category errors
 */
export class GistError extends Data.TaggedError("GistError")<{
  readonly reason: "AuthError" | "ApiError" | "NetworkError" | "CliError"
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
export interface GistFile {
  readonly filename: string
  readonly content: string
}

/**
 * @since 0.1.0
 * @category models
 */
export interface GistCreateOptions {
  readonly description: string
  readonly files: ReadonlyArray<GistFile>
  readonly public: boolean
}

/**
 * @since 0.1.0
 * @category models
 */
export interface GistUpdateOptions {
  readonly gistId: string
  readonly description?: string
  readonly files?: ReadonlyArray<GistFile>
}

/**
 * @since 0.1.0
 * @category models
 */
export interface GistResult {
  readonly id: string
  readonly url: string
  readonly htmlUrl: string
  readonly rawUrl: Option.Option<string>
  readonly description: string
  readonly createdAt: Date
}

/**
 * @since 0.1.0
 * @category models
 */
export interface GistConfigOptions {
  /** GitHub personal access token (optional if using gh CLI) */
  readonly token: Option.Option<string>
  /** Prefer gh CLI over direct API calls */
  readonly preferCli: boolean
  /** Retry configuration for API calls */
  readonly retryAttempts: number
}

// ============================================================================
// Gist Service
// ============================================================================

/**
 * @since 0.1.0
 * @category tags
 */
export class GistConfig extends Context.Tag("claude-session/GistConfig")<
  GistConfig,
  GistConfigOptions
>() {
  static readonly Default = Layer.succeed(GistConfig, {
    token: Option.fromNullable(process.env["GITHUB_TOKEN"]),
    preferCli: true,
    retryAttempts: 3
  })

  static readonly make = (config: Partial<GistConfigOptions>) =>
    Layer.succeed(GistConfig, {
      token: config.token ?? Option.fromNullable(process.env["GITHUB_TOKEN"]),
      preferCli: config.preferCli ?? true,
      retryAttempts: config.retryAttempts ?? 3
    })
}

/**
 * @since 0.1.0
 * @category tags
 */
export class GistService extends Context.Tag("claude-session/GistService")<
  GistService,
  {
    /**
     * Create a new GitHub Gist
     */
    readonly create: (
      options: GistCreateOptions
    ) => Effect.Effect<GistResult, GistError>

    /**
     * Update an existing GitHub Gist
     */
    readonly update: (
      options: GistUpdateOptions
    ) => Effect.Effect<GistResult, GistError>

    /**
     * Check if GitHub authentication is available
     */
    readonly checkAuth: Effect.Effect<boolean, GistError>

    /**
     * Get the configured authentication method
     */
    readonly getAuthMethod: Effect.Effect<"token" | "cli" | "none", never>
  }
>() {}

// ============================================================================
// CLI Implementation
// ============================================================================

const createGistViaCli = (
  options: GistCreateOptions
): Effect.Effect<GistResult, GistError, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    // Create a temporary file for the gist content
    // gh gist create requires files, so we'll use stdin
    const file = options.files[0]
    if (!file) {
      return yield* Effect.fail(new GistError({
        reason: "ApiError",
        message: "At least one file is required"
      }))
    }

    // Build the command
    const command = Command.make("gh", "gist", "create",
      "-d", options.description,
      ...(options.public ? ["--public"] : []),
      "-f", file.filename,
      "-" // Read from stdin
    ).pipe(Command.feed(file.content))

    const output = yield* Command.string(command).pipe(
      Effect.mapError((e) => new GistError({
        reason: "CliError",
        message: "Failed to execute gh command",
        cause: e
      }))
    )

    const urlMatch = output.match(/https:\/\/gist\.github\.com\/[^\s]+/)
    const htmlUrl = urlMatch?.[0] ?? ""
    const idMatch = htmlUrl.match(/\/([a-f0-9]+)$/)
    const id = idMatch?.[1] ?? ""

    return {
      id,
      url: `https://api.github.com/gists/${id}`,
      htmlUrl,
      rawUrl: Option.none(),
      description: options.description,
      createdAt: new Date()
    }
  })

const updateGistViaCli = (
  options: GistUpdateOptions
): Effect.Effect<GistResult, GistError, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    const file = options.files?.[0]
    if (!file) {
      return yield* Effect.fail(new GistError({
        reason: "ApiError",
        message: "At least one file is required for update"
      }))
    }

    // gh gist edit <gist-id> -f <filename> - (reads from stdin)
    const args = ["gist", "edit", options.gistId, "-f", file.filename, "-"]
    const command = Command.make("gh", ...args).pipe(Command.feed(file.content))

    yield* Command.string(command).pipe(
      Effect.mapError((e) => new GistError({
        reason: "CliError",
        message: "Failed to update gist via gh CLI",
        cause: e
      }))
    )

    return {
      id: options.gistId,
      url: `https://api.github.com/gists/${options.gistId}`,
      htmlUrl: `https://gist.github.com/${options.gistId}`,
      rawUrl: Option.none(),
      description: options.description ?? "",
      createdAt: new Date()
    }
  })

const checkAuthViaCli = (): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    const command = Command.make("gh", "auth", "status")

    const exitCode = yield* Command.exitCode(command).pipe(
      Effect.catchAll(() => Effect.succeed(1))
    )

    return exitCode === 0
  })

// ============================================================================
// API Implementation
// ============================================================================

interface GitHubGistResponse {
  id: string
  url: string
  html_url: string
  description: string
  created_at: string
  files: Record<string, { raw_url: string }>
}

const createGistViaApi = (
  options: GistCreateOptions,
  token: string
): Effect.Effect<GistResult, GistError, HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    const filesPayload: Record<string, { content: string }> = {}
    for (const file of options.files) {
      filesPayload[file.filename] = { content: file.content }
    }

    const baseRequest = HttpClientRequest.post("https://api.github.com/gists").pipe(
      HttpClientRequest.setHeaders({
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "claude-session"
      })
    )

    const request = yield* HttpClientRequest.bodyJson(baseRequest, {
      description: options.description,
      public: options.public,
      files: filesPayload
    }).pipe(
      Effect.mapError((e) => new GistError({
        reason: "ApiError",
        message: "Failed to create request body",
        cause: e
      }))
    )

    const response = yield* client.execute(request).pipe(
      Effect.flatMap((res) => res.json),
      Effect.retry(Schedule.recurs(3).pipe(Schedule.intersect(Schedule.exponential("1 second")))),
      Effect.mapError((e) => new GistError({
        reason: "ApiError",
        message: "Failed to create gist via API",
        cause: e
      }))
    )

    const gist = response as GitHubGistResponse
    const firstFile = options.files[0]
    const rawUrl = firstFile
      ? Option.fromNullable(gist.files[firstFile.filename]?.raw_url)
      : Option.none()

    return {
      id: gist.id,
      url: gist.url,
      htmlUrl: gist.html_url,
      rawUrl,
      description: gist.description,
      createdAt: new Date(gist.created_at)
    }
  })

const updateGistViaApi = (
  options: GistUpdateOptions,
  token: string
): Effect.Effect<GistResult, GistError, HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    const filesPayload: Record<string, { content: string }> = {}
    for (const file of options.files ?? []) {
      filesPayload[file.filename] = { content: file.content }
    }

    const baseRequest = HttpClientRequest.patch(`https://api.github.com/gists/${options.gistId}`).pipe(
      HttpClientRequest.setHeaders({
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "claude-session"
      })
    )

    const body: Record<string, unknown> = { files: filesPayload }
    if (options.description) {
      body["description"] = options.description
    }

    const request = yield* HttpClientRequest.bodyJson(baseRequest, body).pipe(
      Effect.mapError((e) => new GistError({
        reason: "ApiError",
        message: "Failed to create request body",
        cause: e
      }))
    )

    const response = yield* client.execute(request).pipe(
      Effect.flatMap((res) => res.json),
      Effect.retry(Schedule.recurs(3).pipe(Schedule.intersect(Schedule.exponential("1 second")))),
      Effect.mapError((e) => new GistError({
        reason: "ApiError",
        message: "Failed to update gist via API",
        cause: e
      }))
    )

    const gist = response as GitHubGistResponse
    const firstFile = options.files?.[0]
    const rawUrl = firstFile
      ? Option.fromNullable(gist.files[firstFile.filename]?.raw_url)
      : Option.none()

    return {
      id: gist.id,
      url: gist.url,
      htmlUrl: gist.html_url,
      rawUrl,
      description: gist.description,
      createdAt: new Date(gist.created_at)
    }
  })

const checkAuthViaApi = (
  token: string
): Effect.Effect<boolean, never, HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    const request = HttpClientRequest.get("https://api.github.com/user").pipe(
      HttpClientRequest.setHeaders({
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "claude-session"
      })
    )

    const response = yield* client.execute(request).pipe(
      Effect.map(r => r.status === 200),
      Effect.catchAll(() => Effect.succeed(false))
    )

    return response
  })

// ============================================================================
// Live Implementation
// ============================================================================

/**
 * @since 0.1.0
 * @category layers
 *
 * Live implementation using gh CLI (preferred) with API fallback
 */
export const GistServiceLive = Layer.effect(
  GistService,
  Effect.gen(function* () {
    const config = yield* GistConfig

    return {
      create: (options) =>
        Effect.gen(function* () {
          // Try CLI first if preferred
          if (config.preferCli) {
            const cliAuth = yield* Effect.serviceOption(CommandExecutor.CommandExecutor).pipe(
              Effect.flatMap(executorOpt =>
                Option.isSome(executorOpt)
                  ? checkAuthViaCli().pipe(
                      Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, Option.getOrThrow(executorOpt))),
                      Effect.scoped
                    )
                  : Effect.succeed(false)
              ),
              Effect.catchAll(() => Effect.succeed(false))
            )

            if (cliAuth) {
              return yield* Effect.serviceOption(CommandExecutor.CommandExecutor).pipe(
                Effect.flatMap(executorOpt =>
                  Option.isSome(executorOpt)
                    ? createGistViaCli(options).pipe(
                        Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, Option.getOrThrow(executorOpt))),
                        Effect.scoped
                      )
                    : Effect.fail(new GistError({
                        reason: "CliError",
                        message: "CommandExecutor not available"
                      }))
                )
              )
            }
          }

          // Fall back to API
          if (Option.isSome(config.token)) {
            const tokenValue = Option.getOrThrow(config.token)
            return yield* Effect.serviceOption(HttpClient.HttpClient).pipe(
              Effect.flatMap(clientOpt =>
                Option.isSome(clientOpt)
                  ? createGistViaApi(options, tokenValue).pipe(
                      Effect.provide(Layer.succeed(HttpClient.HttpClient, Option.getOrThrow(clientOpt))),
                      Effect.scoped
                    )
                  : Effect.fail(new GistError({
                      reason: "ApiError",
                      message: "HttpClient not available"
                    }))
              )
            )
          }

          return yield* Effect.fail(new GistError({
            reason: "AuthError",
            message: "No authentication method available. Either run 'gh auth login' or set GITHUB_TOKEN environment variable."
          }))
        }),

      update: (options) =>
        Effect.gen(function* () {
          // Try CLI first if preferred
          if (config.preferCli) {
            const cliAuth = yield* Effect.serviceOption(CommandExecutor.CommandExecutor).pipe(
              Effect.flatMap(executorOpt =>
                Option.isSome(executorOpt)
                  ? checkAuthViaCli().pipe(
                      Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, Option.getOrThrow(executorOpt))),
                      Effect.scoped
                    )
                  : Effect.succeed(false)
              ),
              Effect.catchAll(() => Effect.succeed(false))
            )

            if (cliAuth) {
              return yield* Effect.serviceOption(CommandExecutor.CommandExecutor).pipe(
                Effect.flatMap(executorOpt =>
                  Option.isSome(executorOpt)
                    ? updateGistViaCli(options).pipe(
                        Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, Option.getOrThrow(executorOpt))),
                        Effect.scoped
                      )
                    : Effect.fail(new GistError({
                        reason: "CliError",
                        message: "CommandExecutor not available"
                      }))
                )
              )
            }
          }

          // Fall back to API
          if (Option.isSome(config.token)) {
            const tokenValue = Option.getOrThrow(config.token)
            return yield* Effect.serviceOption(HttpClient.HttpClient).pipe(
              Effect.flatMap(clientOpt =>
                Option.isSome(clientOpt)
                  ? updateGistViaApi(options, tokenValue).pipe(
                      Effect.provide(Layer.succeed(HttpClient.HttpClient, Option.getOrThrow(clientOpt))),
                      Effect.scoped
                    )
                  : Effect.fail(new GistError({
                      reason: "ApiError",
                      message: "HttpClient not available"
                    }))
              )
            )
          }

          return yield* Effect.fail(new GistError({
            reason: "AuthError",
            message: "No authentication method available."
          }))
        }),

      checkAuth: Effect.gen(function* () {
        // Check CLI auth
        if (config.preferCli) {
          const cliAuth = yield* Effect.serviceOption(CommandExecutor.CommandExecutor).pipe(
            Effect.flatMap(executorOpt =>
              Option.isSome(executorOpt)
                ? checkAuthViaCli().pipe(
                    Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, Option.getOrThrow(executorOpt))),
                    Effect.scoped
                  )
                : Effect.succeed(false)
            ),
            Effect.catchAll(() => Effect.succeed(false))
          )

          if (cliAuth) return true
        }

        // Check API auth
        if (Option.isSome(config.token)) {
          const tokenValue = Option.getOrThrow(config.token)
          return yield* Effect.serviceOption(HttpClient.HttpClient).pipe(
            Effect.flatMap(clientOpt =>
              Option.isSome(clientOpt)
                ? checkAuthViaApi(tokenValue).pipe(
                    Effect.provide(Layer.succeed(HttpClient.HttpClient, Option.getOrThrow(clientOpt))),
                    Effect.scoped
                  )
                : Effect.succeed(false)
            ),
            Effect.catchAll(() => Effect.succeed(false))
          )
        }

        return false
      }),

      getAuthMethod: Effect.gen(function* () {
        if (config.preferCli) {
          const cliAuth = yield* Effect.serviceOption(CommandExecutor.CommandExecutor).pipe(
            Effect.flatMap(executorOpt =>
              Option.isSome(executorOpt)
                ? checkAuthViaCli().pipe(
                    Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, Option.getOrThrow(executorOpt))),
                    Effect.scoped
                  )
                : Effect.succeed(false)
            ),
            Effect.catchAll(() => Effect.succeed(false))
          )

          if (cliAuth) return "cli" as const
        }

        if (Option.isSome(config.token)) {
          return "token" as const
        }

        return "none" as const
      })
    }
  })
).pipe(Layer.provide(GistConfig.Default))

/**
 * @since 0.1.0
 * @category constructors
 */
export const makeGistService = (config?: Partial<GistConfigOptions>) =>
  GistServiceLive.pipe(
    Layer.provide(config ? GistConfig.make(config) : GistConfig.Default)
  )
