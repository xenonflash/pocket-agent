export interface Tool {
  name: string;
  description: string;
  params: Record<string, unknown>;
  execute: (params: unknown) => Promise<unknown>;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface Model {
  chat(messages: Message[]): Promise<string>;
}

export type Thought =
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; input: unknown }
  | { type: "observation"; output: unknown };

export interface AgentConfig {
  model: Model;
  tools: Tool[];
  maxIterations?: number;
  humanInLoop?: boolean;
}

export class Agent implements Tool {
  name = "agent";
  description = "AI agent that can reason and use tools";
  params = { task: "string" };

  constructor(private config: AgentConfig) {}

  async run(task: string): Promise<string> {
    const messages: Message[] = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: task }
    ];

    for (let i = 0; i < (this.config.maxIterations || 10); i++) {
      const response = await this.config.model.chat(messages);
      const thoughts = this.parseResponse(response);

      for (const thought of thoughts) {
        if (thought.type === "thought") {
          continue;
        }
        if (thought.type === "action") {
          const tool = this.config.tools.find((t) => t.name === thought.tool);
          if (!tool) continue;

          if (this.config.humanInLoop) {
            const confirmed = await this.confirmAction(thought.tool, thought.input);
            if (!confirmed) continue;
          }

          const output = await tool.execute(thought.input);
          messages.push({
            role: "assistant",
            content: `Used tool ${thought.tool} with input ${JSON.stringify(thought.input)}\nResult: ${JSON.stringify(output)}`
          });
        }
      }

      if (this.isComplete(response)) return response;
    }

    return "Max iterations reached";
  }

  async execute(params: unknown): Promise<unknown> {
    return this.run((params as { task: string }).task);
  }

  private buildSystemPrompt(): string {
    const tools = this.config.tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");
    return `You are a helpful agent with access to tools:
${tools}

Think step by step. Format your response as:
Thought: <your reasoning>
Action: <tool_name>
Input: <JSON input>

Or respond directly when done.`;
  }

  private parseResponse(response: string): Thought[] {
    const thoughts: Thought[] = [];
    const lines = response.split("\n");
    let current: Partial<Thought> = {};

    for (const line of lines) {
      const thoughtMatch = line.match(/^Thought:\s*(.+)/);
      const actionMatch = line.match(/^Action:\s*(.+)/);
      const inputMatch = line.match(/^Input:\s*(.+)/);

      if (thoughtMatch) {
        thoughts.push({ type: "thought", content: thoughtMatch[1] });
      }
      if (actionMatch) {
        current = { type: "action", tool: actionMatch[1] };
      }
      if (inputMatch && current.type === "action") {
        thoughts.push({
          type: "action",
          tool: current.tool!,
          input: JSON.parse(inputMatch[1])
        });
        current = {};
      }
    }

    return thoughts;
  }

  private isComplete(response: string): boolean {
    return !response.includes("Action:") && !response.includes("Input:");
  }

  private async confirmAction(tool: string, input: unknown): Promise<boolean> {
    process.stdout.write(`Execute ${tool} with input ${JSON.stringify(input)}? (y/n): `);
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => resolve(data.toString().trim()));
    });
    return answer.toLowerCase() === "y";
  }
}

export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}
