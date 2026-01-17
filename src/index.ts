import OpenAI from 'openai';

export interface Tool {
  type: 'function';
  function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
  };
  execute: (params?: any) => Promise<any>;
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
export type OpenAIToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

export type HookContext = {
  agentName: string;
  iteration?: number;
};

export interface Plugin {
  name: string;
  hooks: AgentHooks;
  tools?: Tool[];
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

export interface ModelResponse {
    content: string | null;
    toolCalls?: OpenAIToolCall[];
}

export interface ModelInterface {
  chat(messages: Message[], tools?: Tool[]): Promise<ModelResponse>;
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

  async chat(messages: Message[], tools?: Tool[]): Promise<ModelResponse> {
    const openaiMessages: OpenAIMessage[] = messages.map((m) => {
        const msg: any = {
            role: m.role,
            content: m.content
        };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.name) msg.name = m.name;
        return msg;
    });

    // console.log("Sending messages to model:", openaiMessages.length);
    
    // Tools are already in OpenAI format (mostly), just strip the 'execute' property
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] | undefined = tools?.map(t => ({
        type: 'function',
        function: t.function
    }));

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: openaiMessages,
        tools: openaiTools && openaiTools.length > 0 ? openaiTools : undefined
      });

      const choice = response.choices[0];
      return {
          content: choice.message.content,
          toolCalls: choice.message.tool_calls
      };
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
  type: 'function' = 'function';
  function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
  };

  private context: Context;

  constructor(private config: AgentConfig) {
    this.function = {
        name: config.name || "agent",
        description: config.description || "AI agent that can reason and use tools",
        parameters: { 
            type: 'object',
            properties: {
                task: { type: 'string' }
            },
            required: ['task']
        }
    };
    this.context = config.context || new Context();

    // Merge tools from plugins
    const pluginTools: Tool[] = [];
    if (this.config.hooks) {
      const plugins = Array.isArray(this.config.hooks) ? this.config.hooks : [this.config.hooks];
      for (const plugin of plugins) {
        if (plugin.tools) {
          pluginTools.push(...plugin.tools);
        }
      }
    }
    this.config.tools = [...this.config.tools, ...pluginTools];
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
    const hookContext: HookContext = { agentName: this.function.name };

    let messages: Message[] = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: task }
    ];

    this.context.setMessages(messages);

    let hookData = await this.runHook('beforeRun', { task, messages }, hookContext);
    task = hookData.task;
    messages = hookData.messages;

    let emptyResponseCount = 0;

    for (let i = 0; i < (this.config.maxIterations || 10); i++) {
        // console.log(`\n--- Iteration ${i + 1} ---`);
      hookContext.iteration = i;

      let beforeIterData = await this.runHook('beforeIteration', { iteration: i, messages }, hookContext);
      messages = beforeIterData.messages;

      let beforeCallData = await this.runHook('beforeModelCall', { messages }, hookContext);
      messages = beforeCallData.messages;
      
      // console.log("last Messages sent to model:", messages[messages.length - 2]);

      // Call model with native tools
      const modelResponse = await this.config.model.chat(messages, this.config.tools);
      
      let afterCallData = await this.runHook('afterModelCall', { messages, response: modelResponse.content || "" }, hookContext);
      messages = afterCallData.messages;
      
      const responseMsg: Message = {
          role: "assistant",
          content: modelResponse.content,
          tool_calls: modelResponse.toolCalls
      };
      
      messages.push(responseMsg);
      // For hook compatibility, we pass the content string
      const processedResponse = modelResponse.content || "";

      // Logic for tool execution
      const toolCalls = modelResponse.toolCalls;
      const thoughts: Thought[] = []; // Deprecated concept in new structure but kept for hooks

      if (toolCalls && toolCalls.length > 0) {
          emptyResponseCount = 0; // Reset error counter on successful tool usage
          for (const toolCall of toolCalls) {
              const toolName = toolCall.function.name;
              const toolInputStr = toolCall.function.arguments;
              let toolInput: any;
              try {
                  toolInput = JSON.parse(toolInputStr);
              } catch(e) {
                  toolInput = {}; // Parse error
              }

              // Compatibility thought
              thoughts.push({ type: 'action', tool: toolName, input: toolInput });

              // console.log(`Executing tool ${toolName} with input`, toolInput);
              
              const tool = this.config.tools.find((t) => t.function.name === toolName);
              let output;
              
              if (!tool) {
                  output = `Tool ${toolName} not found`;
              } else {
                  if (this.config.humanInLoop) {
                      const confirmed = await this.config.humanInLoop(toolName, toolInput);
                      if (!confirmed) output = "User denied execution";
                      else {
                           try {
                                output = await tool.execute(toolInput);
                           } catch (error) {
                                output = `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`;
                           }
                      }
                  } else {
                        // Subagent logic
                        const isSubAgent = tool instanceof Agent;
                        const agentName = isSubAgent ? tool.function.name : toolName;

                        if (isSubAgent) {
                            (tool as Agent).setContext(this.context);
                        }

                        try {
                            output = await tool.execute(toolInput);
                        } catch (error) {
                            output = `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`;
                        }

                        if (isSubAgent) {
                            this.context.setSubAgentMessages(agentName, (tool as Agent).getContext().getMessages());
                        }
                  }
              }

              // Append Tool Result
              const toolOutput = typeof output === 'string' ? output : JSON.stringify(output);
              // console.log(`Tool ${toolName} output:`, toolOutput.slice(0, 100) + (toolOutput.length > 100 ? '...' : ''));

              messages.push({
                  role: "tool",
                  content: toolOutput || "Success", // Ensure content is never null completely if the tool succeeded but returned nothing
                  tool_call_id: toolCall.id,
                  name: toolName
              });
          }
      } else {
          // No tools called, regular thought
           thoughts.push({ type: 'thought', content: processedResponse });
      }

      const afterIterData = await this.runHook('afterIteration', { iteration: i, messages, response: processedResponse, thoughts }, hookContext);
      if (afterIterData) {
        messages = afterIterData.messages;
        this.context.setMessages(messages);
      }

      if (!toolCalls || toolCalls.length === 0) {
        // If the model returns no content and no tool calls, it's likely a glitch.
        // We shouldn't exit; instead, we prompt the model to try again.
        if (!processedResponse || processedResponse.trim().length === 0) {
            emptyResponseCount++;
            if (emptyResponseCount > 3) {
                console.error("Model returned empty response too many times. Aborting.");
                return "Error: Model returned empty response too many times. Please check your model configuration or input.";
            }

            console.log(`Empty response received (count: ${emptyResponseCount}). Prompting model to continue...`);
            messages.push({
                role: "user",
                content: "Your response was empty. Please provide a valid answer or execute a command."
            });
            continue;
        }
        
        emptyResponseCount = 0; // Reset counter on valid response

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
    let prompt = this.config.description 
        ? `You are ${this.config.description}.`
        : `You are a helpful agent.`;
    
    prompt += `\nThink step by step.`;

    if (this.config.tools && this.config.tools.length > 0) {
        prompt += `\nYou have access to tools. When possible, you should use these tools to perform actions (like writing files, executing commands) to COMPLETE the task. Do not just describe the solution; IMPLEMENT it using the tools. Do not ask for confirmation unless absolutely necessary.`;
    }

    return prompt;
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

export * from "./plugins";
