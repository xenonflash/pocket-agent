# Pocket Agent - Plugin System

Pocket Agent features a minimalist, hook-based Plugin System that allows you to cleanly extend agent functionality without bloating the core SDK.

## Core Concepts

A Plugin in Pocket Agent is simply an object that implements the `Plugin` interface:

```typescript
import type { AgentHooks, Tool } from 'pocket-agent';

export interface Plugin {
  name: string;
  hooks: AgentHooks;
  tools?: Tool[]; // Optionally inject custom tools into the agent
}
```

## The Hook Lifecycle

Plugins can intercept and modify data at 6 different stages of the Agent's execution loop:

```text
beforeRun 
  │
  ├──► beforeIteration
  │      │
  │      ├──► beforeModelCall
  │      │      [ LLM Generation ]
  │      ├──► afterModelCall
  │      │
  │      └──► [ Tool Execution ]
  │
  └──► afterIteration
         │
(loop if not finished)
         │
afterRun
```

### Hook Design Principles
1. **Piping State**: Hooks receive `data` (like `messages`, `task`, `iteration`) and can return a modified copy of that data. If a hook returns `undefined`, the original data is kept.
2. **Context Passing**: Every hook receives a `HookContext` containing the `agentName` and the current `iteration` count.
3. **Async Native**: All hooks are asynchronous.
4. **Tool Injection**: Plugins can natively inject their own tools (e.g., `zoom_in_timeline`) into the Agent's execution context by supplying them in the `tools` array.

## Writing a Custom Plugin

Creating a plugin is as easy as writing a factory function:

```typescript
import type { Plugin } from 'pocket-agent';

export function createMyGuardrailPlugin(): Plugin {
  return {
    name: 'GuardrailPlugin',
    hooks: {
      async beforeModelCall({ messages }, context) {
        // Example: Inject a safety rule right before the LLM generates a response
        const newMessages = [...messages];
        newMessages.push({ role: 'system', content: 'Always reply in JSON format.' });
        
        return { messages: newMessages };
      }
    }
  };
}
```

## Built-in Plugins

Pocket Agent ships with two powerful plugins out-of-the-box:

### 1. `longContextTimeline`
Transforms the flat array of Chat messages into an infinite, "Level of Detail (LOD)" timeline. Old messages are squashed into summarized blocks to conserve tokens, while the agent is given a `zoom_in_timeline` tool to losslessly fetch old details when needed. It also features a Core Memory pin system (`pin_important_fact`) to permanently anchor critical facts across the timeline.

### 2. `logging`
A simple dev plugin that beautifully logs the Agent's internal thoughts, tool calls, and LLM responses natively to the terminal console.

## Usage

Simply pass an array of initialized plugins into your Agent's `hooks` configuration:

```typescript
import { createAgent } from 'pocket-agent';
import { createLongContextPlugin, createLoggingPlugin } from 'pocket-agent/plugins';

const agent = createAgent({
  model: myModel,
  tools: myBusinessTools,
  hooks: [
    createLongContextPlugin({ /* config */ }),
    createLoggingPlugin()
  ]
});
```
