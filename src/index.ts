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

export type HookContext = {
  agentName: string;
  iteration?: number;
};

export interface Plugin {
  name: string;
  hooks: AgentHooks;
}

export interface AgentHooks {
  beforeRun?: (data: { task: string; messages: Message[] }, context: HookContext) => Promise<{ task: string; messages: Message[] } | undefined> | { task: string; messages: Message[] } | undefined;
  beforeIteration?: (data: { iteration: number; messages: Message[] }, context: HookContext) => Promise<{ iteration: number; messages: Message[] } | undefined> | { iteration: number; messages: Message[] } | undefined;
  afterIteration?: (data: { iteration: number; messages: Message[]; response: string; thoughts: Thought[] }, context: HookContext) => Promise<{ iteration: number; messages: Message[]; response: string; thoughts: Thought[] } | undefined> | { iteration: number; messages: Message[]; response: string; thoughts: Thought[] } | undefined;
  afterRun?: (data: { task: string; messages: Message[]; result: string }, context: HookContext) => Promise<{ task: string; messages: Message[]; result: string } | undefined> | { task: string; messages: Message[]; result: string } | undefined;
  beforeModelCall?: (data: { messages: Message[] }, context: HookContext) => Promise<{ messages: Message[] } | undefined> | { messages: Message[] } | undefined;
  afterModelCall?: (data: { messages: Message[]; response: string }, context: HookContext) => Promise<{ messages: Message[]; response: string } | undefined> | { messages: Message[]; response: string } | undefined;
}

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
  hooks?: Plugin | Plugin[];
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

  private getCombinedHooks(): Plugin | undefined {
    if (!this.config.hooks) return undefined;
    
    if (Array.isArray(this.config.hooks)) {
      if (this.config.hooks.length === 0) return undefined;
      if (this.config.hooks.length === 1) return this.config.hooks[0];
      return combineHooks(...this.config.hooks);
    }
    
    return this.config.hooks;
  }

  getContext(): Context {
    return this.context;
  }

  private async runHook<T>(hookName: keyof AgentHooks, data: T, context: HookContext): Promise<T> {
    const combinedHooks = this.getCombinedHooks();
    const hook = combinedHooks?.hooks[hookName];
    if (!hook) return data;

    try {
      const result = await (hook as any)(data, context);
      return result === undefined ? data : result;
    } catch (error) {
      throw new Error(`Hook ${hookName} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async run(task: string): Promise<string> {
    const hookContext: HookContext = { agentName: this.name };

    let messages: Message[] = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: task }
    ];

    this.context.setMessages(messages);

    let hookData = await this.runHook('beforeRun', { task, messages }, hookContext);
    task = hookData.task;
    messages = hookData.messages;

    for (let i = 0; i < (this.config.maxIterations || 10); i++) {
      hookContext.iteration = i;

      let beforeIterData = await this.runHook('beforeIteration', { iteration: i, messages }, hookContext);
      messages = beforeIterData.messages;

      let beforeCallData = await this.runHook('beforeModelCall', { messages }, hookContext);
      messages = beforeCallData.messages;

      const response = await this.config.model.chat(messages);

      let afterCallData = await this.runHook('afterModelCall', { messages, response }, hookContext);
      messages = afterCallData.messages;
      const processedResponse = afterCallData.response;

      const thoughts = this.parseResponse(processedResponse);

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

          const newMessage: Message = {
            role: "assistant",
            content: `Used tool ${thought.tool} with input ${JSON.stringify(thought.input)}\nResult: ${JSON.stringify(output)}`
          };
          messages.push(newMessage);
        }
      }

      await this.runHook('afterIteration', { iteration: i, messages, response: processedResponse, thoughts }, hookContext);

      if (this.isComplete(processedResponse)) {
        let result = processedResponse;
        let afterRunData = await this.runHook('afterRun', { task, messages, result }, hookContext);
        return afterRunData.result;
      }
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

function combineHooks(...plugins: Plugin[]): Plugin {
  const combined: AgentHooks = {};
  
  for (const plugin of plugins) {
    for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
      const existingHook = combined[hookName as keyof AgentHooks];
      if (existingHook) {
        combined[hookName as keyof AgentHooks] = async (data: any, context: HookContext) => {
          let result = await (existingHook as any)(data, context);
          return await (hookFn as any)(result, context);
        };
      } else {
        combined[hookName as keyof AgentHooks] = hookFn;
      }
    }
  }
  
  return {
    name: 'combined',
    hooks: combined
  };
}

export * from './plugins';
export * from "./plugins";
