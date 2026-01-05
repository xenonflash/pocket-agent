# pocket-agent

A minimal AI Agent SDK with ReAct pattern and Human-in-the-loop support.

## Features

- **Tool System**: Define and execute tools
- **Model Interface**: Support any LLM
- **Built-in Model**: Simple API for OpenAI-compatible models
- **ReAct Loop**: Thought-Action-Observation cycle
- **Human-in-Loop**: Confirm actions before execution
- **Agent as Tool**: Compose agents as tools

## Usage

```ts
import { createAgent, Tool, Model } from "pocket-agent";

// Create model
const model = new Model({
  apiKey: "your-api-key",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4"
});

// Define a tool
const calculator: Tool = {
  name: "calculator",
  description: "Add two numbers",
  params: { a: "number", b: "number" },
  async execute(params) {
    const { a, b } = params as { a: number; b: number };
    return a + b;
  }
};

// Create agent
const agent = createAgent({
  model: model,
  tools: [calculator],
  maxIterations: 5,
  humanInLoop: true
});

// Run task
const result = await agent.run("Add 1 and 2");
```

## Build

```bash
pnpm run build
```

Outputs ESM, CJS, and UMD formats in `dist/`.
