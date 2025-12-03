# claude-session-gists

Archive your Claude Code conversations alongside your commits for complete decision provenance.

[![npm version](https://badge.fury.io/js/claude-session-gists.svg)](https://badge.fury.io/js/claude-session-gists)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why?

Important design and implementation decisions happen in Claude Code conversations. Link these conversations to your commits so you can understand the "why" behind every code change.

## Quick Start

### 1. Install Globally

**Using npm:**

```bash
npm install -g claude-session-gists
```

**Using pnpm:**

```bash
pnpm add -g claude-session-gists
```

### 2. Authenticate with GitHub

```bash
gh auth login
```

Or set a personal access token:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

### 3. Use with Git Hooks (Recommended)

Install Husky in your project:

```bash
pnpm add -D husky
pnpm exec husky init
```

Create `.husky/prepare-commit-msg`:

```bash
#!/usr/bin/env bash

COMMIT_MSG_FILE=$1
COMMIT_SOURCE=$2

# Skip for merge/squash/amend
if [ "$COMMIT_SOURCE" = "merge" ] || [ "$COMMIT_SOURCE" = "squash" ] || [ -n "$3" ]; then
  exit 0
fi

# Create gist and save URL
GIST_TRAILER=$(claude-session-gists create --commit --since last-commit 2>/dev/null | grep "^Claude-Session:" | tail -1)

if [ -n "$GIST_TRAILER" ]; then
  echo "" >> "$COMMIT_MSG_FILE"
  echo "$GIST_TRAILER" >> "$COMMIT_MSG_FILE"
  echo "$GIST_TRAILER" > /tmp/claude-session-gists-gist-url
fi
```

Create `.husky/post-commit`:

```bash
#!/usr/bin/env bash

# Link commit to gist
if [ -f /tmp/claude-session-gists-gist-url ]; then
  GIST_URL=$(cat /tmp/claude-session-gists-gist-url | sed 's/Claude-Session: //')
  rm -f /tmp/claude-session-gists-gist-url
  [ -n "$GIST_URL" ] && claude-session-gists link-commit --gist "$GIST_URL" 2>/dev/null
fi
```

Make them executable:

```bash
chmod +x .husky/prepare-commit-msg .husky/post-commit
```

**That's it!** Now every commit will automatically:

- Create a gist with the Claude conversation since your last commit
- Add the gist URL to your commit message
- Update the gist with a link back to the commit

## CLI Commands

```bash
# List sessions for current project directory
claude-session-gists list

# List sessions from all projects
claude-session-gists list --all

# List sessions matching a project name
claude-session-gists list --project myproject

# Export most recent session from current project
claude-session-gists export --format markdown

# Create a gist from current project's session
claude-session-gists create --since last-commit

# Create a gist from a specific project
claude-session-gists create --project myproject

# Link a commit to an existing gist
claude-session-gists link-commit --gist <gist-url>
```

> **Note:** By default, all commands scope to sessions from your current working directory. Use `--all` to see all projects or `--project` to filter by name.

## Example Workflow

1. Work on a feature with Claude Code
2. Commit your changes: `git commit -m "feat: Add user authentication"`
3. The hooks automatically:
   - Create a gist with your Claude conversation
   - Add `Claude-Session: https://gist.github.com/...` to the commit message
   - Update the gist with commit SHA and link
4. Push: `git push`
5. View your commit on GitHub - click the gist link to see the conversation that led to the code

## Programmatic Usage

For library usage with Effect-TS, see the [API documentation](./docs/api.md).

## License

MIT © Clay Roach

---

Built with [Effect-TS](https://effect.website) 💜
