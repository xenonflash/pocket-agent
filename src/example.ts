import { Agent, Model, Tool, createAgent, Context } from "./index";

const model = new Model({
  apiKey: "your-api-key",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4",
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

const subAgent = createAgent({
  model,
  tools: [calculator],
  name: "math_agent",
  description: "Performs mathematical calculations"
});

const context = new Context();

const mainAgent = createAgent({
  model: model,
  tools: [calculator, search, subAgent],
  maxIterations: 5,
  context: context
});

mainAgent.run("Calculate 5 + 3, then search for 'AI'").then((result) => {
  console.log("Result:", result);
  console.log("\n--- Main Agent Messages ---");
  console.log(context.getMessages());
  console.log("\n--- Sub Agent Messages ---");
  console.log(context.getSubAgentMessages("math_agent"));
  console.log("\n--- All Sub Agents ---");
  console.log(context.getAllSubAgentMessages());
});
