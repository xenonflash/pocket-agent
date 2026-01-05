import { createAgent, Model, createLongContextPlugin, createLoggingPlugin, combineHooks } from './index';

async function example() {
  const model = new Model({
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
    model: 'gpt-4o-mini'
  });

  const calculator = {
    name: 'calculator',
    description: 'Perform mathematical calculations',
    params: { expression: 'string' },
    async execute(params: unknown): Promise<unknown> {
      const { expression } = params as { expression: string };
      try {
        const result = eval(expression);
        return result.toString();
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  };

  const longContextPlugin = createLongContextPlugin({
    maxTokens: 8000,
    activeBufferTokens: 4000,
    summaryThreshold: 6000,
    storageDir: './storage',
    conversationId: 'example-conversation-1',
    model: model,
    tokenCounter: (text) => Math.ceil(text.length / 4)
  });

  const loggingPlugin = createLoggingPlugin();

  const agent = createAgent({
    model,
    tools: [calculator],
    hooks: combineHooks(longContextPlugin, loggingPlugin)
  });

  const result = await agent.run('Calculate 2 + 2, then multiply the result by 3');
  console.log('Result:', result);
}

example().catch(console.error);
