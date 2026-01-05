# Pocket Agent - Plugin System

## 概述

Pocket Agent现在支持基于hooks的插件系统，可以轻松扩展功能，同时保持核心SDK的极简设计。

## 插件结构

```
src/
  ├── index.ts           # 核心 Agent SDK
  └── plugins/           # 插件目录
      ├── index.ts        # 插件统一导出
      ├── long-context.ts # 长上下文插件
      └── logging.ts      # 日志插件
```

## Plugin类型

所有插件都实现了`Plugin`接口：

```typescript
export interface Plugin {
  name: string;
  hooks: AgentHooks;
}
```

## Hook系统

### 可用的Hooks

```typescript
export type HookContext = {
  agentName: string;
  iteration?: number;
};

export interface AgentHooks {
  beforeRun?: (data: { task: string; messages: Message[] }, context: HookContext) => Promise<{ task: string; messages: Message[] } | undefined> | { task: string; messages: Message[] } | undefined;
  beforeIteration?: (data: { iteration: number; messages: Message[] }, context: HookContext) => Promise<{ iteration: number; messages: Message[] } | undefined> | { iteration: number; messages: Message[] } | undefined;
  afterIteration?: (data: { iteration: number; messages: Message[]; response: string; thoughts: Thought[] }, context: HookContext) => Promise<{ iteration: number; messages: Message[]; response: string; thoughts: Thought[] } | undefined> | { iteration: number; messages: Message[]; response: string; thoughts: Thought[] } | undefined;
  afterRun?: (data: { task: string; messages: Message[]; result: string }, context: HookContext) => Promise<{ task: string; messages: Message[]; result: string } | undefined> | { task: string; messages: Message[]; result: string } | undefined;
  beforeModelCall?: (data: { messages: Message[] }, context: HookContext) => Promise<{ messages: Message[] } | undefined> | { messages: Message[] } | undefined;
  afterModelCall?: (data: { messages: Message[]; response: string }, context: HookContext) => Promise<{ messages: Message[]; response: string } | undefined> | { messages: Message[]; response: string } | undefined;
}
```

### Hook执行顺序

```
beforeRun -> [beforeIteration -> beforeModelCall -> model.chat -> afterModelCall -> tool执行 -> afterIteration] -> afterRun
```

### Hook设计原则

1. **失败中断**: 如果hook抛出异常，整个流程会中断
2. **异步优先**: 所有hook都是异步的
3. **类型安全**: 通过TypeScript函数签名约束返回类型
4. **上下文传递**: `HookContext`包含agentName和iteration信息
5. **可选返回**: hook可以返回undefined（不修改数据）或修改后的数据

## 内置插件

### 1. 长上下文插件

自动管理对话上下文，通过摘要和文件存储实现"无限"上下文长度。

```typescript
import { createAgent, Model } from 'pocket-agent';
import { createLongContextPlugin } from 'pocket-agent/plugins';

const model = new Model({
  apiKey: 'your-api-key',
  model: 'gpt-4o-mini'
});

const longContextPlugin = createLongContextPlugin({
  maxTokens: 8000,              // 总上下文限制
  activeBufferTokens: 4000,     // 活跃消息窗口
  summaryThreshold: 6000,      // 触发摘要的阈值
  storageDir: './storage',      // 存储目录
  conversationId: 'conv-123',   // 对话ID（用于持久化）
  model: model,                 // 用于生成摘要的模型
  tokenCounter: (text) => Math.ceil(text.length / 4)  // Token计算函数
});

const agent = createAgent({
  model,
  tools,
  hooks: [longContextPlugin]
});
```

#### 工作原理

1. **beforeRun**: 加载之前的摘要（如果存在）
2. **afterIteration**: 当token数超过`summaryThreshold`时：
   - 找出需要摘要的消息（保留最新的`activeBufferTokens`）
   - 调用LLM生成摘要
   - 将摘要保存到文件
   - 更新messages数组，用摘要替换旧消息
3. **afterRun**: 保存最终摘要

#### 文件存储结构

```
./storage/
  └── conversations/
      └── {conversationId}/
          ├── messages.json       # 被摘要的消息
          ├── summary.json        # 累积摘要
          └── index.json          # 消息索引
```

### 2. 日志插件

简单的日志记录插件。

```typescript
import { createAgent } from 'pocket-agent';
import { createLoggingPlugin } from 'pocket-agent/plugins';

const loggingPlugin = createLoggingPlugin();

const agent = createAgent({
  model,
  tools,
  hooks: [loggingPlugin]
});
```

## 组合插件

直接在hooks字段传入插件数组，会自动组合：

```typescript
import { createAgent } from 'pocket-agent';
import { createLongContextPlugin, createLoggingPlugin } from 'pocket-agent/plugins';

const longContextPlugin = createLongContextPlugin({...});
const loggingPlugin = createLoggingPlugin();

const agent = createAgent({
  model,
  tools,
  hooks: [longContextPlugin, loggingPlugin]  // 自动组合多个插件
});
```

插件会按数组顺序依次执行。也支持传入单个插件：

```typescript
const agent = createAgent({
  model,
  tools,
  hooks: [longContextPlugin]  // 单个插件也用数组
});
```

## 自定义插件

创建自定义插件非常简单：

```typescript
import type { Plugin } from 'pocket-agent';

interface MyPluginConfig {
  // 插件特有的配置
}

function createMyPlugin(config: MyPluginConfig = {}): Plugin {
  return {
    name: 'myPlugin',
    hooks: {
      async beforeIteration({ iteration, messages }, context) {
        console.log(`MyPlugin: Processing iteration ${iteration}`);
        
        // 修改messages
        const updatedMessages = [...messages];
        
        // 返回修改后的数据
        return { iteration, messages: updatedMessages };
        
        // 或者返回undefined表示不修改
        // return undefined;
      }
    }
  };
}

// 使用自定义插件
import { createAgent } from 'pocket-agent';

const myPlugin = createMyPlugin();

const agent = createAgent({
  model,
  tools,
  hooks: [myPlugin]
});
```

## 最佳实践

1. **避免副作用**: 尽量通过返回值修改数据，而不是直接修改传入的对象
2. **错误处理**: 在hook中添加适当的错误处理
3. **性能考虑**: 避免在频繁调用的hooks中执行耗时操作
4. **插件独立性**: 插件之间应该通过返回值通信，避免共享状态

## 测试

运行hook系统测试：

```bash
pnpm exec tsx src/test-hooks.ts
```

## 示例

查看 `src/plugin-example.ts` 获取完整示例。


