// 验证新的Plugin API是否简洁易用

import { createAgent, Model, type Plugin } from './index';
import { createLongContextPlugin, createLoggingPlugin } from './plugins';

// 示例1：单个插件
const model = new Model({
  apiKey: 'test',
  model: 'gpt-4'
});

const agent1 = createAgent({
  model,
  tools: [],
  hooks: [createLoggingPlugin()]  // 单个插件也用数组
});

// 示例2：多个插件（自动组合）
const agent2 = createAgent({
  model,
  tools: [],
  hooks: [
    createLongContextPlugin({ model }),
    createLoggingPlugin()
  ]
});

// 示例3：自定义插件
const customPlugin: Plugin = {
  name: 'custom',
  hooks: {
    async beforeIteration({ iteration, messages }) {
      console.log(`Custom: iteration ${iteration}`);
      return { iteration, messages };
    }
  }
};

const agent3 = createAgent({
  model,
  tools: [],
  hooks: [customPlugin, createLoggingPlugin()]
});

console.log('Plugin API验证通过！');
