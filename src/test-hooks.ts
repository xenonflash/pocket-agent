import { createAgent, Model, Tool, Plugin } from './index';
import { createLoggingPlugin } from './plugins';

async function testHookSystem() {
  console.log('Testing Hook System...\n');

  const model = new Model({
    apiKey: process.env.OPENAI_API_KEY || 'test-key',
    model: 'gpt-4o-mini'
  });

  const testTool: Tool = {
    type: 'function',
    function: {
        name: 'test_tool',
        description: 'A simple test tool',
        parameters: { 
            type: 'object',
            properties: {
                input: { type: 'string' }
            },
            required: ['input']
        }
    },
    async execute(params: unknown): Promise<unknown> {
      const { input } = params as { input: string };
      return `Processed: ${input}`;
    }
  };

  let hookCallCount = 0;

  const testPlugin: Plugin = {
    name: 'testPlugin',
    hooks: {
      async beforeIteration({ iteration, messages }) {
        hookCallCount++;
        console.log(`Hook ${hookCallCount}: beforeIteration called, iteration=${iteration}, messages=${messages.length}`);
        return { iteration, messages };
      },
      async afterIteration({ iteration, messages }) {
        hookCallCount++;
        console.log(`Hook ${hookCallCount}: afterIteration called, iteration=${iteration}, messages=${messages.length}`);
        return { iteration, messages, response: '', thoughts: [] };
      },
      async beforeRun({ task, messages }) {
        hookCallCount++;
        console.log(`Hook ${hookCallCount}: beforeRun called, task="${task}", messages=${messages.length}`);
        return { task, messages };
      },
      async afterRun({ task, messages, result }) {
        hookCallCount++;
        console.log(`Hook ${hookCallCount}: afterRun called, result="${result.substring(0, 50)}..."`);
        return { task, messages, result };
      }
    }
  };

  const loggingPlugin = createLoggingPlugin();

  const agent = createAgent({
    model,
    tools: [testTool],
    maxIterations: 2,
    hooks: [testPlugin, loggingPlugin]
  });

  try {
    const result = await agent.run('Test hook system');
    console.log(`\n✓ All hooks executed successfully (total: ${hookCallCount} calls)`);
    console.log(`✓ Agent result: ${result.substring(0, 100)}...`);
  } catch (error) {
    console.error(`\n✗ Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

testHookSystem();
