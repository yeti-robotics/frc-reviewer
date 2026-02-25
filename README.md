# frc-reviewer

A GitHub Action that reviews pull requests on FRC robot code. Drop a workflow file in your repo, open a PR, comment `@frc-reviewer`, and get inline feedback on WPILib patterns, command-based architecture, and AdvantageKit logging.

Built by [YETI Robotics](https://github.com/yeti-robotics) (FRC Team 3506).

---

## How it works

Reviews run in three passes:

1. **Summarize** — reads the diff and figures out what the PR is actually trying to do, and which files are worth looking at closely
2. **Review** — checks the changed code against a set of FRC-specific rules (skills), produces a list of candidate issues
3. **Verify** — runs each candidate independently to confirm it's real before posting anything

The result is a summary comment on the PR plus inline review comments at the exact lines where issues were found. Pass 1 can use a cheaper/faster model than passes 2 and 3 if you want to save on inference costs.

Reviews are **incremental**: if you trigger the reviewer twice on the same PR, the second run only looks at commits pushed since the first review.

---

## Setup

### 1. Install the GitHub App

Install the **YETI FRC Reviewer** GitHub App on your repository. This gives the bot its own identity so review comments show up as `frc-reviewer[bot]`.

> [Install the YETI FRC Reviewer app →](https://github.com/apps/frc-reviewer)

### 2. Add your API key

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `DO_API_KEY` | Your DigitalOcean AI inference API key |

For the DigitalOcean key: go to [cloud.digitalocean.com](https://cloud.digitalocean.com), navigate to **AI → API Keys**, and generate a key.

### 3. Add the workflow file

Copy this to `.github/workflows/frc-reviewer.yml` in your robot code repo:

```yaml
name: FRC Code Reviewer

on:
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  review:
    if: |
      github.event.issue.pull_request != null &&
      contains(github.event.comment.body, '@frc-reviewer')
    runs-on: ubuntu-latest
    steps:
      - name: Run FRC Reviewer
        uses: yeti-robotics/frc-reviewer@v1
        with:
          api-key: ${{ secrets.DO_API_KEY }}
          gateway: digitalocean
          model: anthropic/claude-sonnet-4-5
```

### 4. Test it

Open a PR in your repo and comment `@frc-reviewer`. The bot will add a 👀 reaction when it starts, post inline comments and a summary, then add a 🚀 when it's done.

---

## Triggering a review

The default mode (`trigger: comment`) runs when someone comments the trigger phrase on a PR. Only runs on PRs — comments on regular issues are ignored.

If you'd rather have the review run automatically on every push to a PR, switch to auto mode:

```yaml
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      # ... same steps, but remove the if: condition
      - uses: yeti-robotics/frc-reviewer@v1
        with:
          trigger: auto
          # ...
```

Auto mode works well if your team treats reviews as a CI check. Comment mode is better if you only want a review on demand, since it avoids spending inference tokens on every trivial push.

---

## Configuration

All inputs are optional except `api-key`.

| Input | Default | Description |
|---|---|---|
| `api-key` | — | API key for the AI gateway (required) |
| `gateway` | `digitalocean` | Which AI provider to use. Options: `digitalocean`, `openai`, `anthropic`, `vercel` |
| `model` | `gpt-4o` | Model name. Must be valid for the chosen gateway |
| `fast-model` | _(same as model)_ | A cheaper model to use for pass 1 (summarize). Pass 2 and 3 always use `model` |
| `github-token` | `${{ github.token }}` | GitHub token for API calls. Defaults to the token provided by the installed GitHub App |
| `trigger` | `comment` | `comment` runs on @mention, `auto` runs on every PR push |
| `trigger-phrase` | `@frc-reviewer` | The phrase that triggers a comment-based review |
| `minimum-role` | `write` | Minimum repository role required to trigger a comment-based review. Options: `read`, `triage`, `write`. Bot accounts are always blocked. |
| `skills-path` | `.agents/skills` | Path to your team's custom skills directory (relative to repo root) |
| `fail-on-critical` | `false` | If `true`, the Action exits with code 1 when critical issues are found |

### Model names by gateway

**DigitalOcean** — use DigitalOcean's model slugs:

- `anthropic/claude-sonnet-4-5`
- `anthropic/claude-haiku-4-5`
- `meta/llama-3.3-70b-instruct`

**OpenAI**:

- `gpt-4o`, `gpt-4o-mini`, `o3-mini`

**Anthropic**:

- `claude-sonnet-4-5`, `claude-haiku-4-5-20251001`

A good split is `fast-model: anthropic/claude-haiku-4-5` for the summarize pass and `model: anthropic/claude-sonnet-4-5` for review and verify. Haiku is significantly cheaper and the summarize pass doesn't need the best model.

---

## Bundled skills

Skills are markdown files that define what the reviewer looks for. Three skills ship with the action:

**WPILib** (`wpilib`) — common mistakes in WPILib robot code: blocking calls in periodic methods, incorrect `CommandScheduler` usage, putting logic in `Subsystem.periodic()`, using `System.currentTimeMillis()` instead of `Timer.getFPGATimestamp()`, missing motor safety timeouts.

**Command-Based** (`command-based`) — command-based architecture patterns: missing `isFinished()`, forgetting `addRequirements()`, using `InstantCommand` where a full command is needed (and vice versa), parallel command groups that conflict on subsystem requirements, `end()` not handling interruption.

**AdvantageKit** (`advantagekit`) — AdvantageKit logging correctness: missing IO interface pattern, side effects in `updateInputs()` that break replay, direct `DriverStation` calls inside subsystems, missing `Logger.recordOutput()` calls, `@AutoLog` usage.

All bundled skills apply globally — they run on every PR regardless of which files changed.

---

## Writing team skills

You can add your own skills in `.agents/skills/` (or wherever you point `skills-path`). A skill is a markdown file with a YAML front matter block:

```markdown
---
name: Team 3506 Drive Standards
---

# Drive Subsystem Rules

## Swerve module order
Always initialize swerve modules in the order: front-left, front-right,
back-left, back-right. Inconsistent ordering causes field-relative drive
to flip axes unpredictably.

## Odometry updates
Call `poseEstimator.update()` in `DriveSubsystem.periodic()`, not in a
command. Commands that need the current pose should read from the subsystem.
```

Skills with the same filename stem as a bundled skill override it. So if your team has strong opinions about WPILib patterns that differ from the defaults, create `.agents/skills/wpilib.md` and it will replace the bundled one entirely.

There's no limit on the number of skills, but more skills means more prompt tokens per review. Keep rules specific and actionable — the reviewer does better with "don't call `CommandScheduler.getInstance().run()` manually" than with "follow best practices."

---

## Incremental reviews

When you trigger a second review on the same PR, the action looks for its own previous summary comment and reads the SHA it reviewed last time. Only files changed in commits _after_ that SHA get reviewed.

This means you can iterate on a PR — push a fix, ask for another review — without re-reviewing code that was already approved. The summary comment is replaced with a new one each time.

---

## Permissions

The action needs these permissions on whatever token you pass as `github-token`:

- `pull-requests: write` — to post the review and inline comments
- `issues: write` — to post the summary comment and reactions
- `contents: read` — to read file contents at the PR's head SHA

When the YETI FRC Reviewer GitHub App is installed, `${{ github.token }}` is automatically scoped to the app's identity and has all of these permissions.

The `api-key` is the DigitalOcean (or other gateway) key. It never touches GitHub — it's only used for AI inference calls. It won't appear in logs.

---

## Troubleshooting

**The bot isn't responding to my comment.**
Check the Actions tab in your repo and look at the workflow run. If it didn't trigger at all, the `if:` condition on the job probably didn't match — confirm the comment is on a PR (not an issue) and contains the exact trigger phrase. If the run started but the logs say "Skipping review: [username] has 'read' on this repo", the commenter doesn't have sufficient repository access (see `minimum-role`). If the run started but failed, the error will be in the job logs.

**I'm getting "Could not determine PR number from event context".**
This usually means the workflow triggered on an event that isn't a PR comment or PR push. Double-check your `on:` block matches what you're expecting.

**Reviews are posting but the inline comments are in the wrong place.**
Inline comments require a diff position, not a line number — the action maps line numbers to positions using the patch. If the model reports an issue on a line that isn't in the diff (e.g., an unchanged line), it gets dropped from inline comments but still shows in the summary. This is by design.

**I want to disable a bundled skill.**
Create an empty skill file with the same stem in your `.agents/skills/` directory. For example, `.agents/skills/advantagekit.md` with just the front matter and no content will override the bundled AdvantageKit skill.

---

## Contributing

Skills are the easiest place to contribute. If you've identified a common FRC mistake that isn't covered, open a PR adding or improving a skill in `skills/`. Keep rule descriptions concrete — include a bad example and a good example in code blocks where it helps.

For bugs or feature requests, open an issue.
