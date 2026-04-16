# 🔍 PR Detective

**AI-powered GitHub PR analysis from your terminal** — built with the [Cline SDK](https://docs.cline.bot/cline-sdk/overview).

[![Cline SDK](https://img.shields.io/badge/Built_with-Cline_SDK-blue?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PC9zdmc+)](https://docs.cline.bot/cline-sdk/overview)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)

---

Pass any GitHub PR URL → get a structured AI code review streamed to your terminal in real-time.

```bash
npx tsx src/index.ts https://github.com/owner/repo/pull/123
```

The agent analyzes the PR diff and produces a structured report:
- 📋 **Summary** — what the PR does and why
- 🔍 **Key Changes** — file-by-file breakdown
- ✅ **What Looks Good** — things the author did well
- ⚠️ **Potential Issues** — bugs, security concerns, code smells
- 💡 **Suggestions** — concrete improvements
- 🏆 **Overall Score** — out of 10

## Quick Start

```bash
git clone https://github.com/jl-codes/sdk-pr-detective.git
cd sdk-pr-detective
npm install
npx tsx src/index.ts https://github.com/jl-codes/platformio-mcp/pull/7
```

### Prerequisites

- **Node.js 20+**
- **Cline CLI authenticated** — the SDK reads credentials from `~/.cline/data/`. Set up with:
  ```bash
  # Option A: Cline OAuth (opens browser)
  cline auth

  # Option B: Bring your own API key
  cline auth -p anthropic -k "sk-ant-..." -m anthropic/claude-sonnet-4-20250514
  ```

### Optional: GitHub Token

Set a GitHub token to avoid API rate limits on private repos or frequent use:

```bash
export GITHUB_TOKEN=ghp_your_token_here
npx tsx src/index.ts https://github.com/owner/repo/pull/123
```

## How It Works

This project demonstrates the [Cline SDK](https://docs.cline.bot/cline-sdk/overview) — a TypeScript API that lets you embed [Cline](https://github.com/cline/cline) as a programmable coding agent in any Node.js application.

The entire demo is ~180 lines of TypeScript:

```typescript
import { ClineAgent } from "cline"

// 1. Create and initialize the agent
const agent = new ClineAgent({})
await agent.initialize({ protocolVersion: 1, clientCapabilities: {} })

// 2. Create a session
const { sessionId } = await agent.newSession({ cwd, mcpServers: [] })

// 3. Auto-approve tool calls (read-only analysis)
agent.setPermissionHandler(async (request) => {
  const allow = request.options.find((o) => o.kind.includes("allow"))
  return {
    outcome: allow
      ? { outcome: "selected", optionId: allow.optionId }
      : { outcome: "cancelled" },
  }
})

// 4. Stream real-time output
const emitter = agent.emitterForSession(sessionId)
emitter.on("agent_message_chunk", (payload) => {
  process.stdout.write(payload.content.text)
})

// 5. Send the PR diff as a prompt
await agent.prompt({
  sessionId,
  prompt: [{ type: "text", text: `Analyze this PR:\n${diff}` }],
})

// 6. Clean up
await agent.shutdown()
```

### SDK Features Showcased

| Feature | Usage |
|---------|-------|
| Agent lifecycle | `initialize()` → `newSession()` → `prompt()` → `shutdown()` |
| Streaming events | `agent_message_chunk`, `agent_thought_chunk`, `tool_call` |
| Permission handler | Auto-approve for autonomous operation |
| Rich prompt content | PR metadata + diff sent as context |

## CI / GitHub Actions

Run PR Detective automatically on every PR with a GitHub Actions workflow. Use the `--ci` flag for clean markdown output (no colors/spinners).

### Example workflow

Add this to your repo at `.github/workflows/pr-detective.yml`:

```yaml
name: 🔍 PR Detective Review

on:
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:
    inputs:
      pr_url:
        description: "GitHub PR URL to analyze"
        required: true
        type: string

permissions:
  pull-requests: write
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install Cline CLI
        run: npm install -g cline

      - name: Authenticate Cline
        env:
          CLINE_API_KEY: ${{ secrets.CLINE_API_KEY }}
        run: |
          mkdir -p ~/.cline/data

          # Write secrets — Cline API key
          cat > ~/.cline/data/secrets.json <<EOF
          {"clineApiKey":"$CLINE_API_KEY"}
          EOF
          chmod 600 ~/.cline/data/secrets.json

          # Write global state — provider + model config
          # Without this, the SDK defaults to "anthropic" provider (which needs a different key)
          cat > ~/.cline/data/globalState.json <<'EOF'
          {
            "actModeApiProvider": "cline",
            "planModeApiProvider": "cline",
            "actModeClineModelId": "anthropic/claude-sonnet-4.6",
            "planModeClineModelId": "anthropic/claude-sonnet-4.6",
            "actModeClineModelInfo": {
              "maxTokens": 128000,
              "contextWindow": 200000,
              "supportsImages": true,
              "supportsPromptCache": true,
              "inputPrice": 3,
              "outputPrice": 15
            },
            "planModeClineModelInfo": {
              "maxTokens": 128000,
              "contextWindow": 200000,
              "supportsImages": true,
              "supportsPromptCache": true,
              "inputPrice": 3,
              "outputPrice": 15
            }
          }
          EOF

      - name: Clone PR Detective
        run: |
          git clone https://github.com/jl-codes/sdk-pr-detective.git /tmp/pr-detective
          cd /tmp/pr-detective
          npm install

      - name: Resolve PR URL
        id: pr
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            PR_URL="${{ github.event.inputs.pr_url }}"
          else
            PR_URL="${{ github.event.pull_request.html_url }}"
          fi
          PR_NUMBER=$(echo "$PR_URL" | grep -oP '\d+$')
          echo "url=$PR_URL" >> "$GITHUB_OUTPUT"
          echo "number=$PR_NUMBER" >> "$GITHUB_OUTPUT"

      - name: Run PR Detective
        continue-on-error: true
        timeout-minutes: 15
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_URL: ${{ steps.pr.outputs.url }}
        run: |
          cd /tmp/pr-detective
          # stdout = review markdown → tee saves to file AND streams to step log
          # stderr = progress markers → visible in step log only
          npx tsx src/index.ts --ci "$PR_URL" 2>/dev/stderr | tee /tmp/review.md

      - name: Post PR Comment
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          {
            echo "## 🔍 PR Detective Review"
            echo ""
            echo "*Automated analysis powered by the [Cline SDK](https://docs.cline.bot/cline-sdk/overview)*"
            echo ""
            echo "---"
            echo ""
            cat /tmp/review.md
          } > /tmp/comment.md
          gh pr comment "${{ steps.pr.outputs.number }}" \
            --repo "${{ github.repository }}" --body-file /tmp/comment.md
```

### Required secrets & config

| What | Where | Purpose |
|------|-------|---------|
| `CLINE_API_KEY` | **Settings → Secrets → Actions** | Your Cline API key for authentication |
| `GITHUB_TOKEN` | Built-in (automatic) | Used for PR API access and posting comments |

> **Important:** The `Authenticate Cline` step writes **both** `secrets.json` (API key) and `globalState.json` (provider + model config). Without `globalState.json`, the SDK silently defaults to the `anthropic` provider, which requires a different API key format.

### Key design choices

- **`continue-on-error: true`** on the detective step — ensures the PR comment is always posted, even if the review is partial (e.g., for very large PRs that hit the timeout)
- **`2>/dev/stderr | tee`** — separates progress markers (stderr) from the review markdown (stdout), so debug info appears in the step log but not in the PR comment
- **`workflow_dispatch` trigger** — lets you manually test the workflow by pasting any PR URL, without needing to open a new PR
- **`process.exit(0)` in the script** — the Cline SDK's gRPC server keeps the Node event loop alive after `agent.shutdown()`; without an explicit exit, the step hangs until the timeout kills it

## Project Structure

```
sdk-pr-detective/
├── src/
│   └── index.ts        # The entire demo (~180 lines)
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

## Learn More

- 📖 [**Cline SDK Documentation**](https://docs.cline.bot/cline-sdk/overview) — Full API reference and examples
- 🤖 [**Cline GitHub**](https://github.com/cline/cline) — The AI coding agent for VS Code, CLI, and SDK
- 🔌 [**Agent Client Protocol (ACP)**](https://agentclientprotocol.com) — The open protocol Cline implements

## Contributing

Contributions are welcome! Feel free to open issues or submit PRs.

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/awesome`)
3. Commit your changes (`git commit -m 'Add awesome feature'`)
4. Push to the branch (`git push origin feature/awesome`)
5. Open a Pull Request

## License

[MIT](LICENSE) — built with the [Cline SDK](https://docs.cline.bot/cline-sdk/overview).
