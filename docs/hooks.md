# Claude Code Stop Hook Configuration

This directory contains configuration for automatically archiving Claude Code sessions to GitHub Gists when a session ends.

## Setup

1. Install the CLI globally:
   ```bash
   pnpm add -g claude-session
   ```

2. Add the hook to your Claude Code settings. Create or edit `~/.claude/settings.json`:

   ```json
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

3. Alternatively, add it to a project-specific configuration in `.claude/settings.json`:

   ```json
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

## Hook Options

- `--format markdown|json|html` - Output format (default: markdown)
- `--public` - Create public gist (default: secret)

## Git Commit Integration

To automatically include the gist URL in your commits, you can create a custom git hook or use the `--commit` flag:

```bash
# In your commit message workflow
claude-session gist --commit >> commit_msg.txt
git commit -F commit_msg.txt
```

Or add a prepare-commit-msg hook:

```bash
#!/bin/bash
# .git/hooks/prepare-commit-msg

# Only add session link if there's a recent Claude session
GIST_URL=$(claude-session gist --commit 2>/dev/null)
if [ -n "$GIST_URL" ]; then
  echo "" >> "$1"
  echo "$GIST_URL" >> "$1"
fi
```

## Combining with GitButler

If you're using GitButler's Claude Code hooks, you can add session archiving alongside:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "but claude stop"
          },
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

## Troubleshooting

### No authentication found

Make sure you have GitHub CLI authenticated:
```bash
gh auth login
```

Or set the `GITHUB_TOKEN` environment variable:
```bash
export GITHUB_TOKEN=your_personal_access_token
```

### No sessions found

Ensure Claude Code has been used at least once and check that `~/.claude/projects` exists:
```bash
ls -la ~/.claude/projects/
```

### Hook not running

Verify the hook is properly configured:
```bash
cat ~/.claude/settings.json | jq '.hooks.Stop'
```

Check that `claude-session` is in your PATH:
```bash
which claude-session
```
