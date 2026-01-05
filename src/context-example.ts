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
  tools: [calculator, search, mathAgent, researchAgent],
  maxIterations: 5,
  context: context
});

async function runExample() {
  console.log("=== Running agent with context sharing ===\n");
  
  const result = await mainAgent.run("Calculate 5 + 3, then search for 'AI'");
  
  console.log("\n=== Result ===");
  console.log(result);
  
  console.log("\n=== Main Agent Messages ===");
  console.log(context.getMessages());
  
  console.log("\n=== Math Agent Messages ===");
  console.log(context.getSubAgentMessages("math_agent"));
  
  console.log("\n=== Research Agent Messages ===");
  console.log(context.getSubAgentMessages("research_agent"));
  
  console.log("\n=== All Sub Agents ===");
  console.log(context.getAllSubAgentMessages());
  
  console.log("\n=== Context Management ===");
  context.addMessage({ role: "system", content: "Additional context" });
  console.log("After adding message:", context.getMessages().length, "messages");
  
  context.reset();
  console.log("After reset:", context.getMessages().length, "messages");
}

runExample().catch(console.error);