#!/usr/bin/env tsx
/**
 * 🔍 PR Detective — Analyze any GitHub PR with the Cline SDK
 *
 * Usage:
 *   npx tsx src/index.ts https://github.com/owner/repo/pull/123
 *   npx tsx src/index.ts --ci https://github.com/owner/repo/pull/123
 */

import { ClineAgent } from "cline"
import chalk from "chalk"
import ora from "ora"
import { tmpdir } from "node:os"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const ciMode = args.includes("--ci")
const prUrl = args.find((a) => !a.startsWith("--"))

// In CI mode, disable chalk colors for clean markdown output
if (ciMode) {
  chalk.level = 0
}

// ─── Progress logging (always goes to stderr, visible in CI logs) ─────────────

function progress(msg: string) {
  process.stderr.write(`[pr-detective] ${msg}\n`)
}

// ─── Parse PR URL ────────────────────────────────────────────────────────────

function parsePrUrl(url: string): { owner: string; repo: string; number: number } {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) {
    console.error("✗ Invalid PR URL. Expected: https://github.com/owner/repo/pull/123")
    process.exit(1)
  }
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) }
}

// ─── Fetch PR data from GitHub API ───────────────────────────────────────────

async function fetchPrData(owner: string, repo: string, number: number) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "pr-detective",
  }

  // Use GITHUB_TOKEN if available (avoids rate limits)
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`

  // Fetch PR metadata + diff in parallel
  const [metaRes, diffRes] = await Promise.all([
    fetch(baseUrl, { headers }),
    fetch(baseUrl, { headers: { ...headers, Accept: "application/vnd.github.v3.diff" } }),
  ])

  if (!metaRes.ok) {
    throw new Error(`GitHub API error ${metaRes.status}: ${await metaRes.text()}`)
  }

  const meta = (await metaRes.json()) as {
    title: string
    body: string | null
    user: { login: string }
    changed_files: number
    additions: number
    deletions: number
    html_url: string
    base: { ref: string }
    head: { ref: string }
  }

  const diff = diffRes.ok ? await diffRes.text() : "(diff unavailable)"

  return { meta, diff }
}

// ─── Pretty terminal output helpers ──────────────────────────────────────────

const banner = `
${chalk.bold.cyan("┌─────────────────────────────────────────┐")}
${chalk.bold.cyan("│")}  🔍 ${chalk.bold("PR Detective")} — Cline SDK Demo        ${chalk.bold.cyan("│")}
${chalk.bold.cyan("└─────────────────────────────────────────┘")}
`

function printPrSummary(meta: Awaited<ReturnType<typeof fetchPrData>>["meta"]) {
  console.log(chalk.dim("─".repeat(50)))
  console.log(chalk.bold(`  📋 ${meta.title}`))
  console.log(chalk.gray(`     by ${chalk.white(meta.user.login)} • ${meta.base.ref} ← ${meta.head.ref}`))
  console.log(
    chalk.gray(`     ${chalk.green(`+${meta.additions}`)} ${chalk.red(`-${meta.deletions}`)} across ${meta.changed_files} files`),
  )
  console.log(chalk.dim("─".repeat(50)))
  console.log()
}

// ─── Logging helpers (silent in CI mode) ─────────────────────────────────────

function log(msg: string) {
  if (!ciMode) console.log(msg)
}

function logError(msg: string) {
  if (!ciMode) console.error(msg)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!prUrl) {
    if (!ciMode) console.log(banner)
    console.error("Usage: npx tsx src/index.ts [--ci] <github-pr-url>")
    console.error("  Example: npx tsx src/index.ts https://github.com/jl-codes/platformio-mcp/pull/7")
    console.error("  CI mode: npx tsx src/index.ts --ci https://github.com/jl-codes/platformio-mcp/pull/7")
    process.exit(1)
  }

  if (!ciMode) console.log(banner)

  // 1. Parse and fetch PR data
  const { owner, repo, number } = parsePrUrl(prUrl)

  let meta: Awaited<ReturnType<typeof fetchPrData>>["meta"]
  let diff: string

  progress(`Fetching PR #${number} from ${owner}/${repo}...`)

  if (ciMode) {
    const data = await fetchPrData(owner, repo, number)
    meta = data.meta
    diff = data.diff
  } else {
    const spinner = ora(chalk.cyan(`Fetching PR #${number} from ${owner}/${repo}...`)).start()
    const data = await fetchPrData(owner, repo, number)
    meta = data.meta
    diff = data.diff
    spinner.succeed(chalk.green(`Fetched PR #${number}`))
    printPrSummary(meta)
  }

  progress(`PR fetched: "${meta.title}" by ${meta.user.login} (+${meta.additions}/-${meta.deletions})`)

  // 2. Initialize Cline agent
  if (!ciMode) {
    var agentSpinner = ora(chalk.cyan("Starting Cline agent...")).start()
  }

  progress("Creating temp directory...")
  const cwd = await mkdtemp(join(tmpdir(), "pr-detective-"))
  progress(`Temp dir: ${cwd}`)

  progress("Instantiating ClineAgent...")
  const agent = new ClineAgent({})

  progress("Calling agent.initialize()...")
  await agent.initialize({
    protocolVersion: 1,
    clientCapabilities: {},
  })
  progress("agent.initialize() complete")

  progress("Calling agent.newSession()...")
  const { sessionId } = await agent.newSession({ cwd, mcpServers: [] })
  progress(`agent.newSession() complete — sessionId: ${sessionId}`)

  // Auto-approve all tool calls (this is a read-only analysis demo)
  agent.setPermissionHandler(async (request) => {
    const allow = request.options.find((o) => o.kind.includes("allow"))
    return {
      outcome: allow ? { outcome: "selected", optionId: allow.optionId } : { outcome: "cancelled" },
    }
  })

  if (!ciMode) {
    agentSpinner!.succeed(chalk.green("Cline agent ready"))
    console.log()
  }

  // 3. Subscribe to streaming events
  const emitter = agent.emitterForSession(sessionId)
  const output: string[] = []
  let isFirstChunk = true

  emitter.on("agent_message_chunk", (payload) => {
    if (payload.content.type === "text") {
      if (ciMode) {
        // In CI mode, collect output AND mirror to stderr for real-time visibility in logs
        output.push(payload.content.text)
        process.stderr.write(payload.content.text)
      } else {
        if (isFirstChunk) {
          console.log(chalk.bold.cyan("🔍 Detective's Report:"))
          console.log(chalk.dim("─".repeat(50)))
          isFirstChunk = false
        }
        process.stdout.write(payload.content.text)
      }
    }
  })

  emitter.on("agent_thought_chunk", (payload) => {
    if (payload.content.type === "text" && !ciMode) {
      process.stdout.write(chalk.dim.italic(payload.content.text))
    }
  })

  emitter.on("tool_call", (payload) => {
    if (ciMode) {
      progress(`Tool call: ${payload.title}`)
    } else {
      console.log(chalk.yellow(`  🔧 ${payload.title}`))
    }
  })

  emitter.on("error", (err) => {
    progress(`Emitter error: ${err.message}`)
    console.error(`Error: ${err.message}`)
  })

  // 4. Build the prompt with PR context
  // Truncate diff if it's extremely large (>100k chars) to stay within context limits
  const maxDiffLen = 100_000
  const truncatedDiff = diff.length > maxDiffLen ? diff.slice(0, maxDiffLen) + "\n\n... (diff truncated)" : diff

  const prompt = `You are PR Detective 🔍 — an expert code reviewer with a knack for clear, structured analysis.

Analyze this GitHub Pull Request and provide a structured review. Be concise but thorough.

## PR Information
- **Title:** ${meta.title}
- **Author:** ${meta.user.login}
- **Branch:** ${meta.head.ref} → ${meta.base.ref}
- **Stats:** +${meta.additions} -${meta.deletions} across ${meta.changed_files} files
- **URL:** ${meta.html_url}

## PR Description
${meta.body || "(no description provided)"}

## Diff
\`\`\`diff
${truncatedDiff}
\`\`\`

---

Please provide your analysis in this format:

## 📋 Summary
A 2-3 sentence overview of what this PR does and why.

## 🔍 Key Changes
File-by-file breakdown of the important changes (skip trivial ones).

## ✅ What Looks Good
Things the author did well.

## ⚠️ Potential Issues
Any bugs, edge cases, security concerns, or code smells you spot.

## 💡 Suggestions
Concrete improvements the author could make.

## 🏆 Overall Score: X/10
One-line verdict.

Keep your review focused and actionable. No need to use any tools — just analyze the diff directly and give your assessment.`

  // 5. Send prompt and wait for completion (with timeout)
  log(chalk.cyan("\n🕵️  Analyzing PR...\n"))

  const TIMEOUT_MS = 8 * 60 * 1000 // 8 minutes — under the 10-min step limit

  progress("Calling agent.prompt()...")

  const { stopReason } = await Promise.race([
    agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Timed out after 8 minutes waiting for agent response")),
        TIMEOUT_MS,
      ),
    ),
  ])

  progress(`agent.prompt() complete — stopReason: ${stopReason}`)

  // 6. Output and clean up
  if (ciMode) {
    // In CI mode, print the collected markdown to stdout
    process.stdout.write(output.join(""))
  } else {
    console.log(chalk.dim("\n" + "─".repeat(50)))
    console.log(chalk.gray(`\nDone (${stopReason})`))
  }

  progress("Shutting down agent...")
  await agent.shutdown()
  progress("Done.")
}

main().catch((err) => {
  progress(`Fatal error: ${err.message}`)
  console.error(`Fatal error: ${err.message}`)
  process.exit(1)
})
