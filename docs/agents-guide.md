# Darwin AI Agents — A Guide to Specialist Sub-Agents

## What Are Claude Code Agents?

Claude Code supports a sub-agent system where a parent Claude session can delegate tasks to specialized child agents. Each agent is defined by a markdown file with a YAML frontmatter header and a system prompt — a brief instruction document that gives the agent its identity, domain knowledge, and tool access.

Agents differ from skills (slash commands like `/pr` or `/swarm-complete`) in a fundamental way. Skills are **procedures** — step-by-step instructions Claude follows like a script. Agents are **specialists** — they have a persistent identity, a bounded domain of expertise, and the judgment to handle open-ended tasks within that domain. You invoke a skill to perform a specific workflow. You invoke an agent when you need a particular kind of thinking applied to an open-ended problem.

In practice, agents are used by the orchestrating Claude (the primary session) to run parallel or sequential sub-tasks. The orchestrator reads the agent's `description` field to decide which agent to spawn for which problem. The agent runs in isolation, does its work, and returns a result. Neither the orchestrator nor the user needs to know the details of how the agent solved the problem — just the outcome.

## The Darwin Agent Roster

The Darwin workspace has eight specialist agents, each covering a well-defined area of the stack:

| Agent | Domain | When to Use |
|-------|--------|-------------|
| `frontend-architect` | React 18 + Vite frontend, MUI v7, DnD, TanStack Query, auth | UI changes, new components, DnD mechanics, auth questions |
| `aws-architect` | AWS infrastructure, cost analysis, deployment | AWS changes, cost reviews, infrastructure decisions |
| `data-architect` | MySQL schema, Lambda-Rest API, migrations, REST conventions | Data model changes, new endpoints, migrations |
| `ai-memory-architect` | CLAUDE.md, memory files, knowledge management | Memory updates, CLAUDE.md edits, knowledge organization |
| `skills-architect` | Claude Code skills (.claude/commands/), design patterns | Creating/modifying skills, debugging execution, token costs |
| `mcp-architect` | Darwin MCP server, FastMCP, resources vs tools | MCP changes, debugging connectivity, new resources/tools |
| `darwin-architect` | Full-stack synthesis, cross-domain architecture | Complex multi-domain requirements, architectural decisions |
| `code-reviewer` | Mental simulation code review, correctness verification | PR reviews, bug hunting, pre-merge verification |

## How Agents Get Invoked

Agents are invoked through the `Agent` tool in Claude Code orchestration. The orchestrator specifies:
- `subagent_type`: the agent's `name` field from the frontmatter
- `prompt`: the task description, including relevant context the agent needs

The agent then has access to the tools listed in its frontmatter and executes with full context from its system prompt. It's equivalent to opening a fresh Claude session with a specialized briefing document — except it's automated and integrated into the workflow.

For example, a primary Claude session handling a complex requirement might spawn:
1. A `data-architect` agent to design the schema change
2. A `frontend-architect` agent to identify the affected React components
3. A `darwin-architect` agent to synthesize both inputs into a unified plan

This decomposition keeps each agent's context focused and avoids the degradation that happens when a single Claude session tries to hold deep expertise across a dozen files simultaneously.

## Agent File Format

Agents live in `.claude/agents/` in the workspace:

```
DarwinAI/.claude/agents/
├── frontend-architect.md
├── aws-architect.md
├── data-architect.md
├── ai-memory-architect.md
├── skills-architect.md
├── mcp-architect.md
├── darwin-architect.md
└── code-reviewer.md
```

Each file has this structure:

```markdown
---
name: agent-name
description: When to use this agent (routing hint for the orchestrator)
model: claude-opus-4-6
tools: Tool1, Tool2, Tool3
---

System prompt content — the agent's identity, domain knowledge,
key patterns, critical gotchas, and how to approach problems.
```

The `description` field is especially important: it's how the orchestrator decides which agent to route a task to. Write descriptions that are specific about both the domain AND the trigger condition. "Expert on Darwin's React frontend" is less useful than "Expert on Darwin's React 18 + Vite frontend — use for UI changes, new components, DnD mechanics, auth questions, or any change that touches Darwin/src/."

## Creating a New Agent

To add a new agent, create a new `.md` file in `.claude/agents/` with the format above. Key decisions:

**Model selection**: Use `claude-opus-4-6` for agents that need deep reasoning, broad synthesis, or complex judgment. Use `claude-sonnet-4-6` for agents doing well-defined, repetitive, or mechanical tasks where quality over speed isn't critical.

**Tool scoping**: Give agents only the tools they need. A read-only analysis agent (like `code-reviewer`) doesn't need `Edit` or `Write`. A documentation agent doesn't need `Bash`. Tight tool scoping reduces accident surface area — an agent that can't write files can't accidentally overwrite something.

**System prompt depth**: The system prompt is the agent's entire knowledge base for its domain. Don't be sparse. Include:
- The agent's core role and purpose
- The specific files, patterns, and conventions it needs to know
- Critical gotchas that would cause bugs or mistakes if missed
- How to approach problems in this domain
- What NOT to do (anti-patterns that look plausible but are wrong)

The system prompt doesn't need to cover the whole codebase — only the agent's domain. A UI agent doesn't need to know about Lambda internals. Focused context = better responses.

**Description precision**: The description is a routing signal. Be specific about what triggers this agent's use. Include domain terms that naturally come up when someone needs this agent. If an agent's domain overlaps with another, distinguish them clearly in the description.

## Editing an Existing Agent

Edit the `.md` file directly. Changes take effect immediately — there's no compilation step. When editing:

- **Update the description** if the domain has evolved or you want different routing behavior
- **Update the system prompt** when you discover new patterns, gotchas, or conventions the agent should know
- **Update tools** if the agent's responsibilities have grown or shrunk
- **Commit the change** to the DarwinAI-Config repo (via `/save-primary-claude`) so the update persists across sessions

Think of agent files as living documentation. They should be updated whenever you discover something important about their domain that would have helped you avoid a problem or make a better decision. The code-reviewer agent should know about the bugs you actually caught. The data-architect should know about the schema gotchas you ran into. Each session's discoveries should flow back into the agents.

## Best Practices

**Describe the agent's perspective, not just its knowledge.** A good system prompt doesn't just list facts — it tells the agent how to think about its domain. The `darwin-architect` agent isn't just told "know the full stack" — it's told to think in trade-offs, to find the simplest correct solution, and to delegate depth to specialists while synthesizing at the architectural level.

**Critical gotchas deserve emphasis.** If something has caused bugs, broken deployments, or wasted hours — it belongs in the agent file with emphasis. Don't bury it. The `frontend-architect` has `## Critical Gotchas` as its own section because the React 18 state updater issue and the `invalidateQueries` ordering issue have bitten real code.

**Keep the system prompt scannable.** Agents read their own system prompt as part of their context. Dense walls of text are less useful than clear sections with headers. The agent should be able to orient itself quickly within its domain prompt.

**Agents compose naturally.** A `darwin-architect` agent can spawn `data-architect` and `frontend-architect` agents to get domain-specific analysis, then synthesize the results. This composition pattern (one synthesizer + multiple specialists) handles requirements that genuinely span multiple domains without any single agent needing to be expert in everything.

**The description is a contract.** When you write `description: Use for X, Y, Z`, the orchestrator will route X, Y, and Z tasks to this agent. Make sure the agent's system prompt actually prepares it for X, Y, and Z. A mismatch between the description and the system prompt content is the most common failure mode in agent design.

## The Relationship Between Agents and Skills

Skills and agents solve different problems:

**Skills** are deterministic workflows. `/pr` always does: check changes → create branch → commit → push → open PR. The steps are fixed. The value is consistency and not having to remember the workflow.

**Agents** are judgment-enabled specialists. The `code-reviewer` doesn't follow a fixed procedure — it reads the changed code, constructs mental test cases, and applies informed judgment to find bugs. The procedure varies with the input.

A useful heuristic: if you could write the complete logic as a numbered step list and it would work correctly every time — use a skill. If the "right thing to do" depends on what the code actually says — use an agent.

Some workflows use both. `/swarm-complete` is a skill that orchestrates a workflow, and part of that workflow might invoke a `code-reviewer` agent for a pre-merge check. The skill provides the structure; the agent provides the judgment within a step.
