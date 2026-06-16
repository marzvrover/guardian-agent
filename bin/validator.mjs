import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

/* Pseudo type definitions used in the validator
 *
 * type Rule = {
 *   id: string
 *   name: string
 *   type: RuleType // as lowercase string of RuleType key
 *   definition: string
 * }
 *
 * enum RuleType {
 *   REGEX
 * }
 */

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main(args) {
  const workingDir = fs.realpathSync('.')
  const config = JSON.parse(fs.readFileSync(workingDir + '/guardian-agent.config.json', 'utf8'))
  const hookType = process.env.GUARDIAN_HOOK ?? 'agentStop'
  let haystack

  if (args[0]) {
    haystack = args[0]
  } else {
    const input = JSON.parse(await readStdin())

    switch (hookType) {
      case 'preToolUse': {
        // Check tool call arguments before execution
        const parts = []
        if (input.toolCall?.arguments) {
          parts.push(typeof input.toolCall.arguments === 'string'
            ? input.toolCall.arguments
            : JSON.stringify(input.toolCall.arguments))
        }
        if (input.assistantMessage) {
          parts.push(input.assistantMessage)
        }
        haystack = parts.join('\n')
        break
      }
      case 'postToolUse': {
        // Check all fields that could indicate a write action:
        // tool call arguments, tool result, and the assistant's message
        const parts = []
        if (input.toolCall?.arguments) {
          parts.push(typeof input.toolCall.arguments === 'string'
            ? input.toolCall.arguments
            : JSON.stringify(input.toolCall.arguments))
        }
        if (input.toolResult?.textResultForLlm) {
          parts.push(input.toolResult.textResultForLlm)
        }
        if (input.assistantMessage) {
          parts.push(input.assistantMessage)
        }
        haystack = parts.join('\n')
        break
      }
      case 'agentStop':
      case 'subagentStop':
        if (input.transcriptPath) {
          haystack = fs.readFileSync(input.transcriptPath, 'utf8')
        }
        break
    }

    if (!haystack) {
      process.exit(0)
    }
  }

  const results = await processRules(config.rules, haystack)
  const violations = []

  for (const [ruleType, ruleResults] of Object.entries(results)) {
    for (const result of ruleResults) {
      if (result.matches) {
        violations.push(result.id)
      }
    }
  }

  if (violations.length > 0) {
    const message = `Guardian agent blocked: rules violated: ${violations.join(', ')}`

    switch (hookType) {
      case 'preToolUse':
        console.log(JSON.stringify({ decision: 'block', reason: message }))
        break
      case 'postToolUse':
        console.log(JSON.stringify({ additionalContext: message }))
        break
      case 'agentStop':
      case 'subagentStop':
        console.log(JSON.stringify({ decision: 'block', reason: message }))
        break
    }

    process.exit(1)
  }
}

export async function processRules(rules, changes) {
  const queue = {}
  const results = {}

  for (const rule of rules) {
    const ruleType = rule.type.toLowerCase()

    if (!queue[ruleType]) {
      queue[ruleType] = []
    }

    switch (ruleType) {
      case 'regex':
        queue[ruleType].push({ id: rule.id.toLowerCase(), definition: rule.definition })
        break
      default:
        console.error(`Unknown rule type: ${rule.type}`)
    }
  }

  for (const [ruleType, patterns] of Object.entries(queue)) {
    results[ruleType] = await processRegexPatterns(patterns, changes)
  }

  return results
}

export async function processRegexPatterns(patterns, haystack) {
  const maxConcurrent = Number(process.env.MAX_CONCURRENT_REGEX ?? 5)
  const results = []
  for (let i = 0; i < patterns.length; i += maxConcurrent) {
    // splice is outofbounds safe https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.splice
    const batch = patterns.slice(i, i + maxConcurrent)
    const batchResults = await Promise.all(batch.map(p => processRegex(p, haystack)))
    results.push(...batchResults)
  }
  return results
}

export async function processRegex(pattern, haystack) {
  const regex = new RegExp(pattern.definition)
  return { id: pattern.id, matches: regex.test(haystack) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
