# OtterBot
🦦 OtterBot — A personal coding agent built from scratch for learning purpose.

- Agent Loop
  - Tool Call
  - Safety Controls
- LLM Client
- Tool Registry
  - Security
- Context Manager
  - Sliding Window
  - Summarisation
  - Pinned Messages
  - Semantic Retrieval (RAG)
- Planner
  - Task Decomposition
  - Plan Tracking
  - Re-planning

```
┌──────────────────────────────────────────────────────┐
│                     Agent                            │
│                                                      │
│  ┌──────────────┐        ┌───────────────────────┐   │
│  │   Planner    │───────▶│      Agent Loop       │   │
│  └──────────────┘        └──────┬────────────────┘   │
│                                 │                    │
│              ┌──────────────────┴──────────────┐     │
│              ▼                                  ▼    │
│  ┌────────────────────┐        ┌─────────────────┐   │
│  │    LLM Client      │        │  Tool Registry  │   │
│  │  GitHub Copilot    │        │ read/write/shell│   │
│  └────────────────────┘        └─────────────────┘   │
│              │                                       │
│              ▼                                       │
│  ┌────────────────────┐                              │
│  │   Context Manager  │                              │
│  └────────────────────┘                              │
└──────────────────────────────────────────────────────┘

