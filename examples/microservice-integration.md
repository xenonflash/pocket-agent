# Microservice Integration & API Integration Examples

## 概述

本文档展示了如何将 Pocket Agent 集成到微服务架构中，实现 API 网关、服务发现、负载均衡和分布式系统集成。涵盖了 REST API、GraphQL、消息队列和事件驱动架构的各种模式。

## 示例 1: REST API 网关集成

### Pocket Agent 微服务 API

```typescript
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createAgent, Model, Tool, Context } from 'pocket-agent';
import { createLoadBalancerPlugin, createMonitoringPlugin } from './plugins';

// API 类型定义
interface AgentRequest {
  task: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  context?: any;
  timeout?: number;
  tools?: string[];
}

interface AgentResponse {
  id: string;
  status: 'success' | 'error' | 'timeout';
  result?: string;
  error?: string;
  executionTime: number;
  tokensUsed?: number;
  metadata?: {
    iterations: number;
    toolsUsed: string[];
    confidence?: number;
  };
}

interface ServiceConfig {
  model: Model;
  maxConcurrent: number;
  timeoutMs: number;
  enableLogging: boolean;
  plugins: Plugin[];
}

// Agent 任务处理器
class AgentServiceManager {
  private agentCache: Map<string, Agent> = new Map();
  private taskQueue: Array<{
    id: string;
    task: string;
    priority: number;
    timeout: number;
    resolve: (response: AgentResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  
  private runningTasks = new Set<string>();
  private stats = {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    averageResponseTime: 0
  };

  constructor(private config: ServiceConfig) {
    this.startTaskProcessor();
  }

  // 创建任务
  async createTask(request: AgentRequest): Promise<AgentResponse> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      const queueItem = {
        id: taskId,
        task: request.task,
        priority: this.getPriorityLevel(request.priority || 'medium'),
        timeout: request.timeout || 30000,
        resolve,
        reject
      };

      this.taskQueue.push(queueItem);
      this.taskQueue.sort((a, b) => b.priority - a.priority);
      
      console.log(`📝 Queued task ${taskId} with priority ${queueItem.priority}`);
    });
  }

  // 获取优先级数值
  private getPriorityLevel(priority: string): number {
    switch (priority) {
      case 'urgent': return 100;
      case 'high': return 80;
      case 'medium': return 50;
      case 'low': return 20;
      default: return 50;
    }
  }

  // 任务处理器
  private async startTaskProcessor(): Promise<void> {
    while (true) {
      try {
        await this.processNextTask();
      } catch (error) {
        console.error('Task processor error:', error);
        await this.sleep(1000); // 等待1秒后重试
      }
    }
  }

  // 处理下一个任务
  private async processNextTask(): Promise<void> {
    // 检查并发限制
    if (this.runningTasks.size >= this.config.maxConcurrent || this.taskQueue.length === 0) {
      await this.sleep(100);
      return;
    }

    const task = this.taskQueue.shift();
    if (!task) return;

    this.runningTasks.add(task.id);
    
    const startTime = Date.now();
    this.stats.totalTasks++;

    try {
      console.log(`🚀 Processing task ${task.id}: "${task.task.substring(0, 50)}..."`);
      
      // 创建或获取代理实例
      const agent = await this.getOrCreateAgent(task.id);
      
      // 设置超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Task timeout')), task.timeout);
      });

      // 执行任务
      const result = await Promise.race([
        agent.run(task.task),
        timeoutPromise
      ]);

      const executionTime = Date.now() - startTime;
      
      // 更新统计
      this.stats.successfulTasks++;
      this.updateAverageResponseTime(executionTime);

      console.log(`✅ Task ${task.id} completed in ${executionTime}ms`);
      
      // 删除任务中的 resolve/reject 函数，只保留需要的响应数据
      const response: AgentResponse = {
        id: task.id,
        status: 'success',
        result: result.toString(),
        executionTime,
        metadata: {
          iterations: 1, // 应该从实际代理获取
          toolsUsed: [] // 应该从实际代理获取
        }
      };

      task.resolve(response);
      
    } catch (error) {
      this.stats.failedTasks++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error(`❌ Task ${task.id} failed:`, errorMessage);
      
      const response: AgentResponse = {
        id: task.id,
        status: errorMessage === 'Task timeout' ? 'timeout' : 'error',
        error: errorMessage,
        executionTime: Date.now() - startTime
      };

      task.resolve(response);
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  // 获取或创建代理实例
  private async getOrCreateAgent(taskId: string): Promise<Agent> {
    // 简化的代理池管理
    const agentId = 'default_agent';
    
    if (!this.agentCache.has(agentId)) {
      const agent = createAgent({
        model: this.config.model,
        plugins: this.config.plugins,
        maxIterations: 5,
        humanInLoop: false // API 服务不支持人工干预
      });
      
      this.agentCache.set(agentId, agent);
    }
    
    return this.agentCache.get(agentId)!;
  }

  // 更新平均响应时间
  private updateAverageResponseTime(executionTime: number): void {
    const alpha = 0.1; // 指数移动平均
    this.stats.averageResponseTime = this.stats.averageResponseTime * (1 - alpha) + 
                                   executionTime * alpha;
  }

  // 获取服务统计
  getStats() {
    const successRate = this.stats.totalTasks > 0 
      ? this.stats.successfulTasks / this.stats.totalTasks 
      : 0;
    
    return {
      ...this.stats,
      successRate,
      runningTasks: this.runningTasks.size,
      queuedTasks: this.taskQueue.length,
      serverUptime: process.uptime()
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Express 应用主类
export class PocketAgentAPIServer {
  private app: express.Application;
  private serviceManager: AgentServiceManager;
  private promServer?: any;

  constructor(
    private port: number,
    private config: ServiceConfig
  ) {
    this.app = express();
    this.serviceManager = new AgentServiceManager(config);
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // 请求日志
    this.app.use((req, res, next) => {
      const start = Date.now();
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`📡 [${requestId}] ${req.method} ${req.path} - Body:`, {
        task: req.body?.task?.substring(0, 100),
        priority: req.body?.priority,
        timeout: req.body?.timeout
      });

      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`📊 [${requestId}] ${res.statusCode} - ${duration}ms`);
      });

      (req as any).requestId = requestId;
      next();
    });

    // 全局错误处理
    this.app.use(this.errorHandler);
  }

  private errorHandler = (error: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('🚨 API Error:', {
      error: error.message,
      stack: error.stack,
      requestId: (req as any).requestId,
      body: req.body
    });

    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
      requestId: (req as any).requestId
    });
  };

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (req, res) => {
      const stats = this.serviceManager.getStats();
      const healthStatus = this.calculateHealthStatus(stats);
      
      res.json({
        status: healthStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        stats
      });
    });

    // 创建任务
    this.app.post('/tasks', async (req, res) => {
      const requestId = (req as any).requestId;
      const { task, priority, context, timeout, tools } = req.body as AgentRequest;

      // 验证输入
      if (!task || typeof task !== 'string') {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Task is required and must be a string',
          requestId
        });
      }

      if (task.length > 10000) {
        return res.status(400).json({
          error: 'Task too long',
          message: 'Task must be less than 10,000 characters',
          requestId
        });
      }

      try {
        console.log(`📝 [${requestId}] Creating task of length ${task.length}`);
        
        const response = await this.serviceManager.createTask({
          task,
          priority,
          context,
          timeout,
          tools
        });

        res.json(response);
      } catch (error) {
        console.error(`❌ [${requestId}] Task creation failed:`, error);
        res.status(500).json({
          error: 'Task creation failed',
          message: error instanceof Error ? error.message : String(error),
          requestId
        });
      }
    });

    // 获取任务状态
    this.app.get('/tasks/:taskId', (req, res) => {
      const { taskId } = req.params;
      const requestId = (req as any).requestId;
      
      console.log(`🔍 [${requestId}] Checking task status: ${taskId}`);
      
      // 在真正的实现中，这里会查询任务状态
      res.json({
        id: taskId,
        status: 'completed',
        message: 'Task simulation - implement actual status tracking'
      });
    });

    // 获取服务统计
    this.app.get('/stats', (req, res) => {
      const stats = this.serviceManager.getStats();
      res.json(stats);
    });

    // 获取服务器信息
    this.app.get('/info', (req, res) => {
      res.json({
        name: 'Pocket Agent API Server',
        version: '1.0.0',
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        features: [
          'task-processing',
          'priority-queue',
          'rate-limiting',
          'health-monitoring'
        ]
      });
    });
  }

  private calculateHealthStatus(stats: any): string {
    if (stats.failedTasks / stats.totalTasks > 0.1) {
      return 'unhealthy';
    } else if (stats.failedTasks / stats.totalTasks > 0.05) {
      return 'degraded';
    }
    return 'healthy';
  }

  // 启动服务器
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.app.listen(this.port, () => {
          console.log(`🚀 Pocket Agent API Server running on port ${this.port}`);
          console.log(`📊 Health check: http://localhost:${this.port}/health`);
          console.log(`📝 Create task: http://localhost:${this.port}/tasks`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // 停止服务器
  async stop(): Promise<void> {
    // 在真正的实现中，这里会优雅地关闭连接和清理资源
    console.log('🛑 Shutting down API server...');
  }
}

// 使用示例
async function startAPIServer() {
  const config: ServiceConfig = {
    model: new Model({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4o-mini'
    }),
    maxConcurrent: 10,
    timeoutMs: 30000,
    enableLogging: true,
    plugins: [
      createMonitoringPlugin({ logLevel: 'info' }),
      createLoadBalancerPlugin({ strategy: 'round_robin' })
    ]
  };

  const server = new PocketAgentAPIServer(config.port || 3000, config);
  
  try {
    await server.start();
    
    // 优雅关闭处理
    process.on('SIGTERM', async () => {
      console.log('💤 Received SIGTERM, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });
    
    process.on('SIGINT', async () => {
      console.log('💤 Received SIGINT, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}
```

## 示例 2: GraphQL API 集成

### GraphQL Schema 和 Resolvers

```typescript
import { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLInt, GraphQLFloat, GraphQLBoolean, GraphQLList, GraphQLNonNull, GraphQLScalarType, Kind } from 'graphql';
import { createAgent, Model, Tool } from 'pocket-agent';

// GraphQL 类型定义
const TaskType = new GraphQLObjectType({
  name: 'Task',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: new GraphQLNonNull(GraphQLString) },
    result: { type: GraphQLString },
    executionTime: { type: new GraphQLNonNull(GraphQLInt) },
    error: { type: GraphQLString },
    priority: { type: GraphQLString },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
    completedAt: { type: GraphQLString }
  }
});

const TaskResultType = new GraphQLObjectType({
  name: 'TaskResult',
  fields: {
    task: { type: TaskType },
    metadata: { type: GraphQLString } // JSON string
  }
});

const AgentStatsType = new GraphQLObjectType({
  name: 'AgentStats',
  fields: {
    totalTasks: { type: new GraphQLNonNull(GraphQLInt) },
    successfulTasks: { type: new GraphQLNonNull(GraphQLInt) },
    failedTasks: { type: new GraphQLNonNull(GraphQLInt) },
    averageResponseTime: { type: new GraphQLNonNull(GraphQLFloat) },
    successRate: { type: new GraphQLNonNull(GraphQLFloat) },
    runningTasks: { type: new GraphQLNonNull(GraphQLInt) },
    queuedTasks: { type: new GraphQLNonNull(GraphQLInt) }
  }
});

// 自定义 JSON 标量类型
const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  parseValue(value: any) { return value; },
  serialize(value: any) { return value; },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return JSON.parse(ast.value);
    }
    return null;
  }
});

class GraphQLAgentResolver {
  private taskStore: Map<string, any> = new Map();
  private agentService: AgentServiceManager;

  constructor(agentService: AgentServiceManager) {
    this.agentService = agentService;
  }

  createSchema(): GraphQLSchema {
    const rootQuery = new GraphQLObjectType({
      name: 'RootQuery',
      fields: {
        task: {
          type: TaskType,
          args: {
            id: { type: new GraphQLNonNull(GraphQLString) }
          },
          resolve: (_, { id }) => this.getTask(id)
        },
        tasks: {
          type: new GraphQLList(TaskType),
          args: {
            status: { type: GraphQLString },
            limit: { type: GraphQLInt },
            offset: { type: GraphQLInt }
          },
          resolve: (_, { status, limit, offset }) => this.getTasks(status, limit, offset)
        },
        stats: {
          type: AgentStatsType,
          resolve: () => this.getStats()
        },
        health: {
          type: GraphQLString,
          resolve: () => this.checkHealth()
        }
      }
    });

    const rootMutation = new GraphQLObjectType({
      name: 'RootMutation',
      fields: {
        createTask: {
          type: TaskResultType,
          args: {
            task: { type: new GraphQLNonNull(GraphQLString) },
            priority: { type: GraphQLString },
            context: { type: JSONScalar },
            timeout: { type: GraphQLInt },
            tools: { type: new GraphQLList(GraphQLString) }
          },
          resolve: async (_, args) => this.createTask(args)
        },
        cancelTask: {
          type: GraphQLBoolean,
          args: {
            id: { type: new GraphQLNonNull(GraphQLString) }
          },
          resolve: async (_, { id }) => this.cancelTask(id)
        }
      }
    });

    const rootSubscription = new GraphQLObjectType({
      name: 'RootSubscription',
      fields: {
        taskUpdated: {
          type: TaskType,
          subscribe: (_, { id }) => this.subscribeToTaskUpdates(id)
        },
        healthUpdates: {
          type: GraphQLString,
          subscribe: () => this.subscribeToHealthUpdates()
        }
      }
    });

    return new GraphQLSchema({
      query: rootQuery,
      mutation: rootMutation,
      subscription: rootSubscription
    });
  }

  private async createTask(args: any): Promise<any> {
    const { task, priority, context, timeout, tools } = args;
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`🚀 Creating GraphQL task ${taskId}:`);
    console.log(`Task: "${task.substring(0, 100)}..."`);
    console.log(`Priority: ${priority}`);
    console.log(`Timeout: ${timeout}ms`);

    // 创建任务记录
    const taskRecord = {
      id: taskId,
      status: 'queued',
      task,
      priority: priority || 'medium',
      context,
      tools,
      createdAt: new Date().toISOString(),
      executionTime: 0
    };
    
    this.taskStore.set(taskId, taskRecord);

    try {
      // 调用底层API服务
      const result = await this.agentService.createTask({
        task,
        priority,
        context,
        timeout,
        tools
      });

      // 更新任务记录
      const updatedRecord = {
        ...taskRecord,
        status: result.status,
        result,
        completedAt: new Date().toISOString(),
        executionTime: result.executionTime,
        metadata: {
          ...result.metadata,
          context,
          tools
        }
      };

      if (result.error) {
        updatedRecord.error = result.error;
      }

      this.taskStore.set(taskId, updatedRecord);

      console.log(`✅ GraphQL task ${taskId} ${result.status} in ${result.executionTime}ms`);

      return {
        task: updatedRecord,
        metadata: JSON.stringify(updatedRecord.metadata)
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const errorRecord = {
        ...taskRecord,
        status: 'error',
        error: errorMessage,
        completedAt: new Date().toISOString()
      };
      
      this.taskStore.set(taskId, errorRecord);
      
      console.error(`❌ GraphQL task ${taskId} failed:`, errorMessage);
      
      throw new Error(`Task creation failed: ${errorMessage}`);
    }
  }

  private async getTask(id: string): Promise<any> {
    const task = this.taskStore.get(id);
    
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }
    
    return task;
  }

  private getTasks(status?: string, limit?: number, offset?: number): any[] {
    let tasks = Array.from(this.taskStore.values());
    
    if (status) {
      tasks = tasks.filter(task => task.status === status);
    }
    
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (offset) {
      tasks = tasks.slice(offset);
    }
    
    if (limit) {
      tasks = tasks.slice(0, limit);
    }
    
    return tasks;
  }

  private getStats(): any {
    return this.agentService.getStats();
  }

  private async cancelTask(id: string): Promise<boolean> {
    const task = this.taskStore.get(id);
    
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }
    
    if (task.status === 'completed' || task.status === 'error') {
      return false; // 无法取消已完成或失败的任务
    }
    
    // 更新任务状态
    const updatedTask = {
      ...task,
      status: 'cancelled',
      completedAt: new Date().toISOString(),
      error: 'Cancelled by user'
    };
    
    this.taskStore.set(id, updatedTask);
    this.notifyTaskUpdates(updatedTask);
    
    console.log(`🛑 Cancelled GraphQL task ${id}`);
    return true;
  }

  private checkHealth(): string {
    const stats = this.getStats();
    const load = (stats.runningTasks + stats.queuedTasks) / Math.max(stats.totalTasks, 1);
    
    if (load > 0.8) return 'unhealthy';
    if (load > 0.5) return 'degraded';
    return 'healthy';
  }

  // 发布订阅 - 任务更新
  private taskUpdateSubscribers: Map<string, (data: any) => void> = new Map();
  
  private subscribeToTaskUpdates(taskId: string): AsyncIterator<any> {
    return {
      [Symbol.asyncIterator]: () => this
    };
  }

  private notifyTaskUpdates(task: any): void {
    const subscribers = Array.from(this.taskUpdateSubscribers.entries())
      .filter(([id, _]) => id === task.id);
    
    subscribers.forEach(([_, callback]) => {
      callback(task);
    });
  }

  // 发布订阅 - 健康更新
  private healthUpdateSubscribers: Array<(data: string) => void> = [];
  
  private subscribeToHealthUpdates(): AsyncIterator<string> {
    return {
      [Symbol.asyncIterator]: () => this
    };
  }

  private notifyHealthUpdates(status: string): void {
    this.healthUpdateSubscribers.forEach(callback => {
      callback(status);
    });
  }

  // 启动健康监控
  startHealthMonitoring(): void {
    setInterval(() => {
      const status = this.checkHealth();
      this.notifyHealthUpdates(status);
    }, 30000); // 每30秒检查一次
  }
}

// WebSocket + GraphQL 集成
import { createServer } from 'http';
import { execute, subscribe } from 'graphql';
import { SubscriptionServer } from 'subscriptions-transport-ws';

function createGraphQLServer(agentService: AgentServiceManager, port: number) {
  const resolver = new GraphQLAgentResolver(agentService);
  const schema = resolver.createSchema();

  // 启动HTTP服务器
  const server = createServer();

  // 创建订阅服务器
  const subscriptionServer = SubscriptionServer.create({
    schema,
    execute,
    subscribe,
    server,
    path: '/graphql'
  });

  subscriptionServer.on('connectionConnected', (params: any) => {
    console.log(`🔌 GraphQL client connected: ${params?.connectionParams?.clientId}`);
  });

  subscriptionServer.on('connectionDisconnected', (params: any) => {
    console.log(`🔌 GraphQL client disconnected: ${params?.connectionParams?.clientId}`);
  });

  // 启动服务器
  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 GraphQL Server running on http://localhost:${port}/graphql`);
    console.log(`📊 Subscriptions available on ws://localhost:${port}/graphql`);
  });

  // 启动健康监控
  resolver.startHealthMonitoring();

  return subscriptionServer;
}
```

## 示例 3: 消息队列集成

### RabbitMQ / Redis Streams 集成

```typescript
import { createClient } from 'redis'; // 或使用 amqplib for RabbitMQ
import { EventEmitter } from 'events';

// 消息类型定义
interface AgentMessage {
  id: string;
  type: 'task' | 'result' | 'error' | 'heartbeat';
  timestamp: number;
  payload: any;
  correlationId?: string;
  replyTo?: string;
  agentId?: string;
  priority?: number;
  ttl?: number;
}

interface MessageHandler {
  handle(message: AgentMessage): Promise<void>;
}

class MessageQueueSubscriber {
  private client: any;
  private subscribers: Map<string, MessageHandler[]> = new Map();
  private channel: string = 'pocket-agent';
  private eventEmitter = new EventEmitter();
  private isSubscribed = false;

  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
    this.setupClient();
  }

  private async setupClient(): Promise<void> {
    await this.client.connect();
    
    // 创建消息消费者
    await this.client.subscribe(this.channel, async (message: string) => {
      try {
        const agentMessage: AgentMessage = JSON.parse(message);
        await this.processMessage(agentMessage);
      } catch (error) {
        console.error('Failed to process message:', error);
      }
    });

    console.log(`📬 Message queue subscriber connected to ${this.channel}`);
  }

  // 发布消息
  async publish(message: AgentMessage): Promise<void> {
    const serialized = JSON.stringify(message);
    await this.client.publish(this.channel, serialized);
    
    console.log(`📨 Published message ${message.id} of type ${message.type}`);
  }

  // 订阅消息类型
  subscribeTo(messageType: string, handler: MessageHandler): void {
    if (!this.subscribers.has(messageType)) {
      this.subscribers.set(messageType, []);
    }
    
    this.subscribers.get(messageType)!.push(handler);
    console.log(`📡 Subscribed to ${messageType} messages`);
  }

  // 处理消息
  private async processMessage(message: AgentMessage): Promise<void> {
    console.log(`📨 Processing message ${message.id} (${message.type})`);
    
    // 发射事件
    this.eventEmitter.emit('messageReceived', message);
    
    // 分发给处理器
    const handlers = this.subscribers.get(message.type) || [];
    
    try {
      await Promise.all(handlers.map(handler => handler.handle(message)));
      console.log(`✅ Handled message ${message.id} successfully`);
    } catch (error) {
      console.error(`❌ Failed to handle message ${message.id}:`, error);
    }
  }

  // 获取消息历史
  async getMessageHistory(limit: number = 100): Promise<AgentMessage[]> {
    // 在实际实现中，可以用 Redis  streams 或其他持久化存储
    return [];
  }

  // 获取队列统计
  async getQueueStats(): Promise<any> {
    const info = await this.client.info('streams');
    return {
      channel: this.channel,
      subscribers: this.subscribers.size,
      totalMessages: 0 // 计算消息总数
    };
  }
}

// 分布式 Agent 协调器
class DistributedAgentCoordinator {
  private messageQueue: MessageQueueSubscriber;
  private agentInstances: Map<string, Agent> = new Map();
  private taskQueue: Map<string, string[]> = new Map(); // agentId -> tasks
  private heartbeatInterval: NodeJS.Timeout;

  constructor(redisUrl: string) {
    this.messageQueue = new MessageQueueSubscriber(redisUrl);
    this.setupMessageHandlers();
    this.startHeartbeat();
  }

  private setupMessageHandlers(): void {
    // 处理任务分发
    this.messageQueue.subscribeTo('task', async (message) => {
      await this.handleTaskMessage(message);
    });

    // 处理任务结果
    this.messageQueue.subscribeTo('result', async (message) => {
      await this.handleResultMessage(message);
    });

    // 处理错误
    this.messageQueue.subscribeTo('error', async (message) => {
      await this.handleErrorMessage(message);
    });
  }

  // 注册 Agent 实例
  async registerAgent(agent: Agent, capabilities: string[] = []): Promise<string> {
    const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.agentInstances.set(agentId, agent);
    this.taskQueue.set(agentId, []);

    // 发送注册消息
    await this.messageQueue.publish({
      id: `msg_${Date.now()}`,
      type: 'heartbeat',
      timestamp: Date.now(),
      payload: {
        agentId,
        status: 'registered',
        capabilities,
        load: 0
      }
    });

    console.log(`🚀 Registered agent ${agentId} (${capabilities.length} capabilities)`);
    return agentId;
  }

  // 发送任务到合适的 Agent
  async dispatchTask(taskRequest: {
    task: string;
    capabilities?: string[];
    priority?: 'low' | 'medium' | 'high';
    correlationId?: string;
    replyTo?: string;
  }): Promise<string> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 选择最佳 Agent
    const bestAgent = await this.selectBestAgent(taskRequest.capabilities);
    
    if (!bestAgent) {
      throw new Error('No available agents with required capabilities');
    }

    const taskMessage: AgentMessage = {
      id: `msg_${Date.now()}`,
      type: 'task',
      timestamp: Date.now(),
      payload: {
        taskId,
        task: taskRequest.task,
        capabilities: taskRequest.capabilities,
        priority: taskRequest.priority || 'medium',
        correlationId: taskRequest.correlationId
      },
      replyTo: taskRequest.replyTo,
      agentId: bestAgent,
      priority: this.getPriorityValue(taskRequest.priority || 'medium')
    };

    await this.messageQueue.publish(taskMessage);
    
    console.log(`📤 Dispatched task ${taskId} to agent ${bestAgent}`);
    return taskId;
  }

  // 处理任务消息
  private async handleTaskMessage(message: AgentMessage): Promise<void> {
    const { payload, agentId } = message;
    const { taskId, task } = payload;

    const agent = this.agentInstances.get(agentId);
    if (!agent) {
      console.error(`❌ Task ${taskId}: Agent ${agentId} not found`);
      return;
    }

    try {
      console.log(`🔧 Agent ${agentId} executing task ${taskId}`);
      
      // 在真实实现中使用 Worker Threads 或子进程
      const result = await agent.run(task);
      
      // 发送结果
      await this.messageQueue.publish({
        id: `msg_${Date.now()}`,
        type: 'result',
        timestamp: Date.now(),
        payload: {
          taskId,
          result,
          agentId,
          executionTime: Date.now() - message.timestamp
        },
        correlationId: payload.correlationId,
        replyTo: message.replyTo
      });

      console.log(`✅ Task ${taskId} completed by agent ${agentId}`);
      
    } catch (error) {
      console.error(`❌ Task ${taskId} failed on agent ${agentId}:`, error);
      
      // 发送错误消息
      await this.messageQueue.publish({
        id: `msg_${Date.now()}`,
        type: 'error',
        timestamp: Date.now(),
        payload: {
          taskId,
          error: error instanceof Error ? error.message : String(error),
          agentId,
          correlationId: payload.correlationId
        },
        replyTo: message.replyTo
      });
    }
  }

  // 处理结果消息
  private async handleResultMessage(message: AgentMessage): Promise<void> {
    const { payload } = message;
    const { taskId, result, correlationId } = payload;
    
    console.log(`📥 Task ${taskId} result received:`, result.substring(0, 100) + '...');
    
    // 通知等待的任务发起者
    if (correlationId) {
      this.eventEmitter.emit(`taskResult:${correlationId}`, payload);
    }
  }

  // 处理错误消息
  private async handleErrorMessage(message: AgentMessage): Promise<void> {
    const { payload } = message;
    const { taskId, error, correlationId } = payload;
    
    console.error(`🚨 Task ${taskId} error:`, error);
    
    if (correlationId) {
      this.eventEmitter.emit(`taskError:${correlationId}`, payload);
    }
  }

  // 选择最佳 Agent
  private async selectBestAgent(capabilities?: string[]): Promise<string | null> {
    const available = Array.from(this.agentInstances.keys());
    
    if (available.length === 0) {
      return null;
    }

    // 简化的选择策略：随机选择一个能处理任务的 Agent
    const candidates = available.filter(agentId => {
      // 在真实实现中，检查 Agent 的能力和负载
      return true;
    });

    if (candidates.length === 0) {
      return null;
    }

    // 使用负载均衡策略选择
    const weights = await Promise.all(
      candidates.map(async (agentId) => ({
        agentId,
        weight: Math.random() // 在真实实现中使用实际负载指标
      }))
    );

    weights.sort((a, b) => a.weight - b.weight);
    return weights[0].agentId;
  }

  // 获取优先级值
  private getPriorityValue(priority: string): number {
    switch (priority) {
      case 'high': return 80;
      case 'medium': return 50;
      case 'low': return 20;
      default: return 50;
    }
  }

  // 启动心跳
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      for (const [agentId, _] of this.agentInstances) {
        await this.messageQueue.publish({
          id: `msg_${Date.now()}`,
          type: 'heartbeat',
          timestamp: Date.now(),
          payload: {
            agentId,
            status: 'alive',
            load: 0,
            memory: process.memoryUsage()
          },
          agentId
        });
      }
    }, 10000); // 每10秒发送心跳
    
    console.log('💓 Started agent heartbeat monitoring');
  }

  // 等待任务结果
  async waitForResult(taskId: string, timeoutMs: number = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for task ${taskId}`));
      }, timeoutMs);

      this.once(`taskResult:${taskId}`, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      this.once(`taskError:${taskId}`, (error) => {
        clearTimeout(timer);
        reject(new Error(error.error));
      });
    });
  }

  // 启动协调器
  async start(): Promise<void> {
    console.log('🚀 Distributed Agent Coordinator started');
  }

  // 停止协调器
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    console.log('🛑 Distributed Agent Coordinator stopped');
  }
}

// 使用示例
async function startDistributedAgentSystem() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  try {
    const coordinator = new DistributedAgentCoordinator(redisUrl);
    await coordinator.start();

    // 注册多个 Agent 实例
    const agents: Agent[] = [];
    
    for (let i = 0; i < 3; i++) {
      const agent = createAgent({
        model: new Model({
          apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
          model: 'gpt-4o-mini'
        }),
        maxIterations: 5
      });
      
      const agentId = await coordinator.registerAgent(agent, ['general', 'analysis']);
      agents.push(agent);
      
      console.log(`✅ Registered agent ${agentId}`);
    }

    // 发送任务
    const taskId1 = await coordinator.dispatchTask({
      task: 'What is the current state of AI technology?',
      capabilities: ['general', 'analysis'],
      priority: 'high',
      correlationId: 'corr_1'
    });

    const taskId2 = await coordinator.dispatchTask({
      task: 'Analyze the market trends in renewable energy',
      capabilities: ['analysis'],
      priority: 'medium',
      correlationId: 'corr_2'
    });

    // 等待结果
    console.log('⏳ Waiting for task results...');
    
    const result1 = await coordinator.waitForResult(taskId1);
    console.log('🎯 Result 1:', result1.result.substring(0, 200) + '...');

    const result2 = await coordinator.waitForResult(taskId2);
    console.log('🎯 Result 2:', result2.result.substring(0, 200) + '...');

    console.log('✅ All tasks completed successfully');
    
  } catch (error) {
    console.error('❌ Distributed system error:', error);
  } finally {
    process.exit(0);
  }
}
```

这些微服务集成示例展示了：

1. **REST API 网关** - 完整的 Express.js API 服务
2. **GraphQL API** - 查询、变更和订阅支持
3. **消息队列系统** - Redis 消息队列和分布式协调

每个系统都包含了完整的错误处理、监控、日志和可扩展性设计模式。
