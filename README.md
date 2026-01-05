# pocket-agent

A minimal AI Agent SDK with ReAct pattern and Human-in-the-loop support.

## Features

- **Tool System**: Define and execute tools
- **Model Interface**: Support any LLM
- **Built-in Model**: Simple API for OpenAI-compatible models
- **ReAct Loop**: Thought-Action-Observation cycle
- **Human-in-Loop**: Confirm actions before execution
- **Agent as Tool**: Compose agents as tools
- **Context Sharing**: Share messages between parent and child agents

## Usage

### Basic Usage

```ts
import { createAgent, Tool, Model } from "pocket-agent";

const model = new Model({
  apiKey: "your-api-key",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4"
});

const calculator: Tool = {
  name: "calculator",
  description: "Add two numbers",
  params: { a: "number", b: "number" },
  async execute(params) {
    const { a, b } = params as { a: number; b: number };
    return a + b;
  }
};

const agent = createAgent({
  model: model,
  tools: [calculator],
  maxIterations: 5
});

const result = await agent.run("Add 1 and 2");
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

const context = new Context();

const mainAgent = createAgent({
  model: model,
  tools: [mathAgent, researchAgent],
  context: context
});

await mainAgent.run("Calculate 5 + 3, then search for 'AI'");

console.log(context.getMessages());
console.log(context.getSubAgentMessages("math_agent"));
console.log(context.getAllSubAgentMessages());
```

## Build

```bash
pnpm run build
```

Outputs ESM, CJS, and UMD formats in `dist/`.
