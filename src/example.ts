import { Agent, Model, Tool, createAgent } from "./index";

const model = new Model({
  apiKey: "your-api-key",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4",
  temperature: 0.7,
  maxTokens: 1000,
  topP: 0.9,
  stream: false
});

const calculator: Tool = {
  name: "calculator",
  description: "Perform basic math operations",
  params: { a: "number", b: "number" },
  async execute(params: unknown) {
    const { a, b } = params as { a: number; b: number };
    return a + b;
  }
};

const search: Tool = {
  name: "search",
  description: "Search the web",
  params: { query: "string" },
  async execute(params: unknown) {
    const { query } = params as { query: string };
    return `Results for: ${query}`;
  }
};

const agent = createAgent({
  model: model,
  tools: [calculator, search],
  maxIterations: 5,
  humanInLoop: async (tool: string, input: unknown) => {
    console.log(`Execute ${tool} with input ${JSON.stringify(input)}? (y/n): `);
    return true;
  }
});

agent.run("Add 1 and 2").then(console.log);
