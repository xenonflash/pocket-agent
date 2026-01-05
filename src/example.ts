import { Agent, Model, Tool, createAgent } from "./index";

class MockModel implements Model {
  async chat(messages: any[]): Promise<string> {
    const last = messages[messages.length - 1];
    if (last.content.includes("add")) {
      return `Thought: I need to add two numbers\nAction: calculator\nInput: {"a": 1, "b": 2}`;
    }
    if (last.content.includes("multiply")) {
      return `Thought: I need to multiply two numbers\nAction: calculator\nInput: {"a": 3, "b": 4}`;
    }
    return "Task completed successfully";
  }
}

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
  model: new MockModel(),
  tools: [calculator, search],
  maxIterations: 5,
  humanInLoop: false
});

agent.run("Add 1 and 2").then(console.log);
