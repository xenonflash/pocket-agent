import OpenAI from 'openai';

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

export type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

export class Context {
  private messages: Message[] = [];
  private subAgentMessages: Map<string, Message[]> = new Map();

  getMessages(): Message[] {
    return [...this.messages];
  }

  setMessages(messages: Message[]): void {
    this.messages = messages;
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  getSubAgentMessages(agentName: string): Message[] {
    return [...(this.subAgentMessages.get(agentName) || [])];
  }

  setSubAgentMessages(agentName: string, messages: Message[]): void {
    this.subAgentMessages.set(agentName, messages);
  }

  getAllSubAgentMessages(): Record<string, Message[]> {
    const result: Record<string, Message[]> = {};
    for (const [name, msgs] of this.subAgentMessages.entries()) {
      result[name] = [...msgs];
    }
    return result;
  }

  reset(): void {
    this.messages = [];
    this.subAgentMessages.clear();
  }
}

export interface ModelInterface {
  chat(messages: Message[]): Promise<string>;
}

export interface ModelConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
}

export class Model implements ModelInterface {
  private client: OpenAI;
  private modelName: string;

  constructor(config: ModelConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || "https://api.openai.com/v1"
    });
    this.modelName = config.model;
  }

  async chat(messages: Message[]): Promise<string> {
    const openaiMessages: OpenAIMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content
    }));

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: openaiMessages
      });

      return response.choices[0].message.content || "";
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new Error(`OpenAI API error: ${error.message} (status: ${error.status})`);
      }
      throw error;
    }
  }
}

export type Thought =
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; input: unknown }
  | { type: "observation"; output: unknown };

export interface AgentConfig {
  model: ModelInterface;
  tools: Tool[];
  maxIterations?: number;
  humanInLoop?: (tool: string, input: unknown) => Promise<boolean>;
  context?: Context;
  name?: string;
  description?: string;
}

export class Agent implements Tool {
  name: string;
  description: string;
  params = { task: "string" };

  private context: Context;

  constructor(private config: AgentConfig) {
    this.name = config.name || "agent";
    this.description = config.description || "AI agent that can reason and use tools";
    this.context = config.context || new Context();
  }

  getContext(): Context {
    return this.context;
  }

  async run(task: string): Promise<string> {
    const messages: Message[] = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: task }
    ];

    this.context.setMessages(messages);

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
            const confirmed = await this.config.humanInLoop(thought.tool, thought.input);
            if (!confirmed) continue;
          }

          const isSubAgent = tool instanceof Agent;
          const agentName = isSubAgent ? tool.name : thought.tool;

          if (isSubAgent) {
            (tool as Agent).setContext(this.context);
          }

          const output = await tool.execute(thought.input);

          if (isSubAgent) {
            this.context.setSubAgentMessages(agentName, (tool as Agent).getContext().getMessages());
          }

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

  setContext(context: Context): void {
    this.context = context;
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
}

export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}
