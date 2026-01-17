# pocket-agent

A minimal AI Agent SDK with ReAct pattern and Human-in-the-loop support.

## Installation

```bash
npm install pocket-agent openai
```

**Note**: This package requires `openai` as a peer dependency. You need to install both `pocket-agent` and `openai`.

## Features

- **Tool System**: Define and execute tools
- **Model Interface**: Support any LLM
- **Built-in Model**: Official OpenAI SDK integration
- **ReAct Loop**: Thought-Action-Observation cycle
- **Human-in-Loop**: Confirm actions before execution
- **Agent as Tool**: Compose agents as tools
- **Context Sharing**: Share messages between parent and child agents
- **TypeScript**: Full TypeScript support with type definitions

## Usage

### Basic Usage

```ts
import { createAgent, Tool, Model } from "pocket-agent";

const model = new Model({
  apiKey: "your-api-key",
  model: "gpt-4"
});

const calculator: Tool = {
  type: "function",
  function: {
    name: "calculator",
    description: "Add two numbers",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" }
      },
      required: ["a", "b"]
    }
  },
  async execute(params) {
    const { a, b } = params as { a: number; b: number };
    return a + b;
  }
};

const agent = createAgent({
  model,
  tools: [calculator],
  maxIterations: 5
});

const result = await agent.run("Add 1 and 2");
```

### Human-in-the-Loop

Enable human confirmation before tool execution:

```ts
import { createAgent, Tool } from "pocket-agent";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const rl = readline.createInterface({ input, output });

const calculator: Tool = {
  type: "function",
  function: {
    name: "calculator",
    description: "Add two numbers",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" }
      },
      required: ["a", "b"]
    }
  },
  async execute(params) {
    const { a, b } = params as { a: number; b: number };
    return a + b;
  }
};

const agent = createAgent({
  model,
  tools: [calculator],
  humanInLoop: async (tool, input) => {
    console.log(`\nTool: ${tool}`);
    console.log(`Input: ${JSON.stringify(input)}`);
    const answer = await rl.question("Execute this action? (y/n): ");
    return answer.toLowerCase() === "y";
  }
});

await agent.run("Add 5 and 7");
// Will prompt: "Execute this action? (y/n):"

rl.close();
```

**Note**: The `Model` class uses the official OpenAI SDK. Optional config parameters (`baseUrl`, `temperature`, `maxTokens`, `topP`, `stream`) are preserved for backward compatibility but are not currently used. You can set a custom `baseUrl` for OpenAI-compatible APIs:

```ts
const model = new Model({
  apiKey: "your-api-key",
  baseUrl: "https://your-custom-api.com/v1",  // Optional
  model: "your-model-name"
});
```

### Agent as Tool with Context Sharing

```ts
import { createAgent, Context } from "pocket-agent";

const mathAgent = createAgent({
  model,
  tools: [calculator],
  name: "math_agent",
  description: "Performs mathematical calculations"
});

const researchAgent = createAgent({
  model,
  tools: [search],
  name: "research_agent",
  description: "Performs web searches"
});

// Sub-agents automatically inherit parent's context when called
const mainAgent = createAgent({
  model,
  tools: [mathAgent, researchAgent]
});

await mainAgent.run("Calculate 5 + 3, then search for 'AI'");

// Access context
console.log(mainAgent.getContext().getMessages());
console.log(mainAgent.getContext().getSubAgentMessages("math_agent"));

// Shared context (for multiple agents)
const sharedContext = new Context();

const agent1 = createAgent({
  model,
  tools: [calculator],
  context: sharedContext
});

const agent2 = createAgent({
  model,
  tools: [search],
  context: sharedContext
});

await agent1.run("Add 1 and 2");
await agent2.run("Search for 'AI'");

// Both agents share the same context
console.log(sharedContext.getAllSubAgentMessages());
```

**Note**: When a parent agent calls a sub-agent, the sub-agent automatically inherits the parent's context. You don't need to manually pass context objects to sub-agents.

## Build

```bash
pnpm run build
```

Outputs ESM, CJS, and UMD formats in `dist/`.
