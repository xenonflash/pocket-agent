# Production Deployment & Error Handling Examples

## 概述

本文档展示了如何在生产环境中部署和运行 Pocket Agent，包括错误处理、监控、日志记录、性能优化和故障恢复等关键功能。

## 示例 1: 生产级别的错误处理和恢复

### 智能错误处理中间件

```typescript
import { Agent, ModelInterface, Tool } from 'pocket-agent';
import { EventEmitter } from 'events';

interface ErrorHandlingConfig {
  maxRetries?: number;
  retryDelay?: number;
  circuitBreakerThreshold?: number;
  enableRecovery?: boolean;
  fallbackExecutors?: Map<string, Tool>;
  errorCallback?: (error: Error, context: any) => Promise<void>;
}

interface ErrorContext {
  agentId: string;
  task: string;
  iteration: number;
  toolName?: string;
  executionTime: number;
  previousErrors: Error[];
}

// 错误类型分类
class ErrorClassifier {
  static classify(error: Error): {
    type: 'network' | 'timeout' | 'validation' | 'resource' | 'tool' | 'unknown';
    severity: 'low' | 'medium' | 'high' | 'critical';
    retryable: boolean;
    description: string;
  } {
    const message = error.message.toLowerCase();

    // 网络相关错误
    if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
      return {
        type: 'network',
        severity: 'medium',
        retryable: true,
        description: 'Network connectivity issue'
      };
    }

    // 超时错误
    if (message.includes('timeout') || message.includes('request timed out')) {
      return {
        type: 'timeout',
        severity: 'medium',
        retryable: true,
        description: 'Operation timeout'
      };
    }

    // 验证错误
    if (message.includes('validation') || message.includes('invalid') || message.includes('schema')) {
      return {
        type: 'validation',
        severity: 'low',
        retryable: false,
        description: 'Input validation failed'
      };
    }

    // 资源错误
    if (message.includes('memory') || message.includes('disk') || message.includes('cpu')) {
      return {
        type: 'resource',
        severity: 'high',
        retryable: false,
        description: 'Resource availability issue'
      };
    }

    // 工具错误
    if (message.includes('tool') || message.includes('execute')) {
      return {
        type: 'tool',
        severity: 'medium',
        retryable: message.includes('temporary'),
        description: 'Tool execution failed'
      };
    }

    return {
      type: 'unknown',
      severity: 'high',
      retryable: false,
      description: 'Unknown error occurred'
    };
  }
}

// 生产级错误处理代理包装器
class ProductionErrorHandler {
  private errorHistory: Map<string, ErrorContext[]> = new Map();
  private circuitBreakers: Map<string, {
    failures: number;
    state: 'closed' | 'open' | 'half-open';
    lastFailure: number;
  }> = new Map();
  
  private eventEmitter = new EventEmitter();
  private retryQueues: Map<string, {
    task: string;
    context: ErrorContext;
    attempts: number;
    deferred: Promise<void>;
  }[]> = new Map();

  constructor(private config: ErrorHandlingConfig = {}) {
    const defaultConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      enableRecovery: true,
      fallbackExecutors: new Map(),
      errorCallback: async (error: Error, context: any) => {
        console.error(`Global error handler: ${error.message}`, context);
      }
    };
    
    this.config = { ...defaultConfig, ...config };
  }

  // 创建带错误处理的代理
  createProtectedAgent(config: any, agentId: string): Agent {
    const originalAgent = createAgent({
      ...config,
      humanInLoop: async (tool, input) => {
        try {
          return await config.humanInLoop(tool, input);
        } catch (error) {
          await this.handleHumanInLoopError(tool, input, error as Error, agentId);
          return false; // 安全降级
        }
      }
    });

    // 包装代理方法
    const protectedAgent = new Proxy(originalAgent, {
      get(target, prop) {
        const originalMethod = target[prop as keyof Agent];
        
        if (typeof originalMethod === 'function' && prop === 'run') {
          return async (task: string) => {
            return await this.handleAgentExecution(originalAgent, task, agentId);
          };
        }
        
        return originalMethod;
      }
    });

    return protectedAgent as Agent;
  }

  // 处理代理执行
  private async handleAgentExecution(agent: Agent, task: string, agentId: string): Promise<string> {
    let lastError: Error | undefined;
    let attempts = 0;
    
    const context: ErrorContext = {
      agentId,
      task,
      iteration: 0,
      executionTime: 0,
      previousErrors: []
    };

    // 检查电路断路器
    if (this.circuitBreakers.has(agentId)) {
      const cb = this.circuitBreakers.get(agentId)!;
      
      if (cb.state === 'open') {
        if (Date.now() - cb.lastFailure < this.config.circuitBreakerThreshold! * 1000) {
          console.log(`⚡ Circuit breaker OPEN for ${agentId}, failing fast`);
          throw new Error(`Circuit breaker is open for ${agentId}`);
        } else {
          // 重置为半开状态
          cb.state = 'half-open';
          console.log(`🔄 Circuit breaker HALF-OPEN for ${agentId}`);
        }
      }
    }

    while (attempts <= this.config.maxRetries!) {
      try {
        const startTime = Date.now();
        context.executionTime = startTime;
        
        console.log(`🚀 Agent ${agentId} executing: "${task}" (attempt ${attempts + 1})`);
        
        const result = await agent.run(task);
        const endTime = Date.now();
        
        context.executionTime = endTime - startTime;
        this.recordSuccess(agentId, context);
        
        console.log(`✅ Agent ${agentId} completed successfully in ${context.executionTime}ms`);
        return result;
        
      } catch (error) {
        lastError = error as Error;
        const errorStartTime = Date.now();
        
        attempts++;
        const classification = ErrorClassifier.classify(lastError);
        
        console.log(`❌ Agent ${agentId} error (attempt ${attempts}):`, {
          message: lastError.message,
          type: classification.type,
          severity: classification.severity,
          retryable: classification.retryable
        });

        context.previousErrors.push(lastError);

        // 记录失败
        this.recordFailure(agentId, context, lastError);

        // 更新电路断路器
        this.updateCircuitBreaker(agentId, lastError);

        // 调用全局错误处理器
        await this.config.errorCallback!(lastError, {
          agentId,
          task,
          attempts,
          errorContext: context,
          classification
        });

        // 检查是否继续重试
        if (!classification.retryable || attempts > this.config.maxRetries!) {
          console.log(`🛑 Agent ${agentId} giving up after ${attempts} attempts`);
          break;
        }

        // 尝试执行降级逻辑
        if (attempts === this.config.maxRetries!) {
          const fallbackResult = await this.tryFallbackExecution(task, agentId, lastError);
          if (fallbackResult) {
            console.log(`🔄 Fallback execution succeeded for ${agentId}`);
            return fallbackResult;
          }
        }

        // 指数退避延迟
        const delay = this.config.retryDelay! * Math.pow(2, attempts - 1);
        console.log(`⏳ Retrying ${agentId} in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    // 所有重试都失败了
    throw new Error(`Agent ${agentId} failed after ${attempts} attempts: ${lastError!.message}`);
  }

  // 执行降级逻辑
  private async tryFallbackExecution(task: string, agentId: string, error: Error): Promise<string | null> {
    const primaryErrors = this.errorHistory.get(agentId) || [];
    const hasPermissionError = error.message.includes('permission') || error.message.includes('unauthorized');
    
    // 如果是权限问题，尝试降权执行
    if (hasPermissionError) {
      console.log(`🔐 Attempting degraded execution for ${agentId} due to permission error`);
      
      try {
        // 简化的降权执行
        return await this.quickExecution(task);
      } catch (fallbackError) {
        console.error(`❌ Fallback execution also failed: ${fallbackError}`);
        return null;
      }
    }

    // 检查是否有专门的降级执行器
    const fallbackExecutor = this.config.fallbackExecutors.get(agentId);
    if (fallbackExecutor) {
      try {
        console.log(`🔄 Using fallback executor for ${agentId}`);
        return await fallbackExecutor.execute({ task, originalError: error }) as string;
      } catch (fallbackError) {
        console.error(`❌ Fallback executor failed: ${fallbackError}`);
        return null;
      }
    }

    return null;
  }

  // 快速执行（降权版本）
  private async quickExecution(task: string): Promise<string> {
    // 模拟简化执行
    return `Simplified execution result for: ${task.substring(0, 50)}...`;
  }

  // 记录成功
  private recordSuccess(agentId: string, context: ErrorContext): void {
    if (!this.errorHistory.has(agentId)) {
      this.errorHistory.set(agentId, []);
    }
    
    // 清理旧记录
    const history = this.errorHistory.get(agentId)!;
    history.push({ ...context, task: 'SUCCESS: ' + context.task });
    
    if (history.length > 1000) {
      history.shift();
    }

    // 重置电路断路器
    const cb = this.circuitBreakers.get(agentId);
    if (cb) {
      cb.failures = 0;
      cb.state = 'closed';
    }
  }

  // 记录失败
  private recordFailure(agentId: string, context: ErrorContext, error: Error): void {
    if (!this.errorHistory.has(agentId)) {
      this.errorHistory.set(agentId, []);
    }
    
    const history = this.errorHistory.get(agentId)!;
    history.push({
      ...context,
      task: `ERROR: ${context.task}`,
    });
    
    if (history.length > 1000) {
      history.shift();
    }

    // 发射事件
    this.eventEmitter.emit('agentFailed', {
      agentId,
      error: error.message,
      context,
      timestamp: Date.now()
    });
  }

  // 更新电路断路器
  private updateCircuitBreaker(agentId: string, error: Error): void {
    if (!this.circuitBreakers.has(agentId)) {
      this.circuitBreakers.set(agentId, {
        failures: 0,
        state: 'closed',
        lastFailure: 0
      });
    }

    const cb = this.circuitBreakers.get(agentId)!;
    cb.failures++;
    cb.lastFailure = Date.now();

    if (cb.failures >= this.config.circuitBreakerThreshold!) {
      cb.state = 'open';
      console.log(`⚡ Circuit breaker OPEN for ${agentId} (${cb.failures} failures)`);
    }
  }

  // 处理人机交互错误
  private async handleHumanInLoopError(tool: string, input: any, error: Error, agentId: string): Promise<void> {
    console.log(`⚠️ Human-in-the-loop error for ${tool}:`, error.message);
    
    // 安全降级：自动拒绝可能是危险的工具执行
    const dangerousTools = ['delete', 'rm', 'remove', 'drop', 'exec', 'system'];
    const isDangerous = dangerousTools.some(dangerous => tool.toLowerCase().includes(dangerous));
    
    if (isDangerous) {
      console.log(`🛡️ Auto-denied dangerous tool execution: ${tool}`);
      return; // 使用默认值false
    }
    
    // 对于一般错误，记录但不拒绝
    this.eventEmitter.emit('humanInLoopError', {
      agentId,
      tool,
      input,
      error: error.message,
      timestamp: Date.now()
    });
  }

  // 健康检查
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 获取统计信息
  getHealthReport(): any {
    const totalAgents = this.circuitBreakers.size;
    const failedAgents = Array.from(this.circuitBreakers.values())
      .filter(cb => cb.state !== 'closed').length;
    
    const last24hStats = this.calculateRecentStats(24);
    
    return {
      overview: {
        totalAgents,
        failedAgents,
        healthScore: totalAgents > 0 ? ((totalAgents - failedAgents) / totalAgents) * 100 : 100
      },
      circuitBreakers: Object.fromEntries(this.circuitBreakers),
      recentFailures: last24hStats.failures,
      avgRecoveryTime: last24hStats.avgRecoveryTime,
      recommendations: this.generateRecommendations()
    };
  }

  private calculateRecentStats(hours: number): { failures: number; avgRecoveryTime: number } {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const recentErrors = Array.from(this.errorHistory.values())
      .flat()
      .filter(entry => entry.executionTime > cutoff);
    
    const failures = recentErrors.filter(entry => entry.task.startsWith('ERROR:')).length;
    const recoveryTimes = recentErrors
      .filter(entry => entry.task.startsWith('SUCCESS:'))
      .map(entry => entry.executionTime);
    
    return {
      failures,
      avgRecoveryTime: recoveryTimes.length > 0 
        ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
        : 0
    };
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    
    const openBreakers = Array.from(this.circuitBreakers.entries())
      .filter(([_, cb]) => cb.state === 'open');
    
    if (openBreakers.length > 0) {
      recommendations.push(`Address circuit breakers for: ${openBreakers.map(([id]) => id).join(', ')}`);
    }
    
    const recentFailures = this.calculateRecentStats(24).failures;
    if (recentFailures > 10) {
      recommendations.push('High failure rate detected. Consider scaling resources or reviewing error patterns.');
    }
    
    return recommendations;
  }
}
```

## 示例 2: 生产监控和日志系统

### 综合监控系统

```typescript
import { Plugin } from 'pocket-agent';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { join } from 'path';

// 日志级别定义
enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical'
}

// 日志条目
interface LogEntry {
  timestamp: number;
  level: LogLevel;
  agentId: string;
  component: string;
  message: string;
  metadata?: any;
  stack?: string;
  performance?: {
    duration: number;
    memory: number;
    cpu?: number;
  };
}

// 监控指标
interface Metrics {
  agents: {
    total: number;
    running: number;
    failed: number;
    avgResponseTime: number;
  };
  tools: {
    total: number;
    executions: number;
    failures: number;
    avgExecutionTime: number;
  };
  system: {
    uptime: number;
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
  };
}

// 日志格式化器
class LogFormatter {
  static format(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(8);
    const agent = entry.agentId.charAt(0).toUpperCase() + entry.agentId.slice(1).padEnd(15);
    const component = entry.component.charAt(0).toUpperCase() + entry.component.slice(1).padEnd(15);
    
    let formatted = `[${timestamp}] ${level} [${agent}] [${component}] ${entry.message}`;
    
    if (entry.metadata) {
      formatted += ` | Metadata: ${JSON.stringify(entry.metadata)}`;
    }
    
    if (entry.performance) {
      formatted += ` | Performance: ${JSON.stringify(entry.performance)}`;
    }
    
    return formatted;
  }
}

// 生产监控插件
export function createProductionMonitoringPlugin(config: {
  logPath?: string;
  metricsPath?: string;
  logRotation?: boolean;
  logRetention?: number;
  sampleRate?: number;
  enablePerformanceTracking?: boolean;
  alerts?: {
    highResponseTime?: number;
    highErrorRate?: number;
    lowMemoryThreshold?: number;
  };
}): Plugin {
  const defaultConfig = {
    logPath: './logs/pocket-agent',
    metricsPath: './metrics',
    logRotation: true,
    logRetention: 7, // 7天
    sampleRate: 1.0, // 记录所有日志
    enablePerformanceTracking: true,
    alerts: {
      highResponseTime: 10000, // 10秒
      highErrorRate: 0.1,      // 10%
      lowMemoryThreshold: 80   // 80%
    }
  };

  const finalConfig = { ...defaultConfig, ...config };
  
  // 日志和指标存储
  const logBuffer: LogEntry[] = [];
  const metricsHistory: Metrics[] = [];
  const agents = new Map<string, {
    startTime: number;
    executionCount: number;
    errorCount: number;
    totalTime: number;
    health: 'healthy' | 'degraded' | 'failed';
  }>();
  
  private eventEmitter = new EventEmitter();
  private logWriters: NodeJS.WritableStream[] = [];
  private alertSystem = new Map<string, number>(); // 防止重复告警
  
  // 初始化日志系统
  async function initializeLogging(): Promise<void> {
    await fs.mkdir(finalConfig.logPath!, { recursive: true });
    await fs.mkdir(finalConfig.metricsPath!, { recursive: true });
    
    // 创建多个日志输出目标
    logWriters.push(
      // 控制台输出
      process.stdout,
      // 文件输出（轮转）
      await createLogFile(finalConfig.logPath!, 'app')
    );
    
    console.log('📊 Production monitoring initialized');
  }

  // 创建日志文件
  async function createLogFile(path: string, prefix: string): Promise<NodeJS.WritableStream> {
    const today = new Date().toISOString().split('T')[0];
    const filename = `${prefix}_${today}.log`;
    const filepath = join(path, filename);
    
    try {
      return await fs.createWriteStream(filepath, { flags: 'a' });
    } catch (error) {
      console.error(`Failed to create log file: ${filepath}`, error);
      return process.stdout;
    }
  }

  // 记录日志
  function log(level: LogLevel, agentId: string, component: string, message: string, metadata?: any, performance?: any): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      agentId,
      component,
      message,
      metadata,
      stack: level === LogLevel.ERROR || level === LogLevel.CRITICAL ? new Error().stack : undefined,
      performance: finalConfig.enablePerformanceTracking ? performance : undefined
    };

    // 采样控制
    if (Math.random() > finalConfig.sampleRate!) {
      return;
    }

    logBuffer.push(entry);
    
    // 限制缓冲区大小
    if (logBuffer.length > 10000) {
      logBuffer.shift();
    }

    // 立即写入日志
    const formattedLog = LogFormatter.format(entry);
    logWriters.forEach(writer => writer.write(formattedLog + '\n'));

    // 检查告警条件
    checkAlerts(entry);

    // 发射事件
    eventEmitter.emit('log', entry);
  }

  // 检查告警条件
  private checkAlerts(entry: LogEntry): void {
    const now = Date.now();
    
    // 高响应时间告警
    if (entry.performance?.duration > finalConfig.alerts!.highResponseTime!) {
      this.triggerAlert('HIGH_RESPONSE_TIME', {
        agentId: entry.agentId,
        duration: entry.performance.duration,
        threshold: finalConfig.alerts!.highResponseTime!
      });
    }

    // 高错误率告警（基于最近100个操作）
    if (entry.level === LogLevel.ERROR) {
      const recentErrors = logBuffer
        .slice(-100)
        .filter(l => l.level === LogLevel.ERROR).length;
      
      if (recentErrors / 100 > finalConfig.alerts!.highErrorRate!) {
        this.triggerAlert('HIGH_ERROR_RATE', {
          errorCount: recentErrors,
          threshold: finalConfig.alerts!.highErrorRate! * 100
        });
      }
    }

    // 系统资源告警
    if (entry.component === 'system' && entry.performance?.memory) {
      if (entry.performance.memory > finalConfig.alerts!.lowMemoryThreshold!) {
        this.triggerAlert('LOW_MEMORY', {
          memoryUsage: entry.performance.memory,
          threshold: finalConfig.alerts!.lowMemoryThreshold!
        });
      }
    }
  }

  // 触发告警
  private triggerAlert(type: string, data: any): void {
    const cooldown = 60000; // 1分钟冷却期
    const lastAlert = this.alertSystem.get(type) || 0;
    
    if (Date.now() - lastAlert < cooldown) {
      return; // 在冷却期内，不重复告警
    }

    this.alertSystem.set(type, Date.now());
    
    const alert = {
      type,
      timestamp: Date.now(),
      data,
      message: this.generateAlertMessage(type, data)
    };

    console.log(`🚨 ALERT: ${alert.message}`);
    console.log(`🚨 Data:`, JSON.stringify(data, null, 2));

    eventEmitter.emit('alert', alert);
  }

  // 生成告警消息
  private generateAlertMessage(type: string, data: any): string {
    switch (type) {
      case 'HIGH_RESPONSE_TIME':
        return `Agent ${data.agentId} response time (${data.duration}ms) exceeded threshold (${data.threshold}ms)`;
      case 'HIGH_ERROR_RATE':
        return `Error rate (${data.errorCount}%) exceeded threshold (${data.threshold}%)`;
      case 'LOW_MEMORY':
        return `Memory usage (${data.memoryUsage}%) exceeded threshold (${data.threshold}%)`;
      default:
        return `Unknown alert type: ${type}`;
    }
  }

  // 记录执行开始
  function recordExecutionStart(agentId: string, task: string): number {
    if (!agents.has(agentId)) {
      agents.set(agentId, {
        startTime: Date.now(),
        executionCount: 0,
        errorCount: 0,
        totalTime: 0,
        health: 'healthy'
      });
    }

    const agent = agents.get(agentId)!;
    agent.executionCount++;
    
    log(LogLevel.INFO, agentId, 'execution', `Started: ${task}`);
    
    return Date.now();
  }

  // 记录执行完成
  function recordExecutionEnd(agentId: string, startTime: number, success: boolean, result?: any): void {
    const agent = agents.get(agentId);
    if (!agent) return;

    const endTime = Date.now();
    const duration = endTime - startTime;
    agent.totalTime += duration;

    if (!success) {
      agent.errorCount++;
      agent.health = agent.errorCount / agent.executionCount > 0.1 ? 'degraded' : 'healthy';
    }

    log(
      success ? LogLevel.INFO : LogLevel.WARN,
      agentId,
      'execution',
      `Completed in ${duration}ms (${success ? 'success' : 'failure'})`,
      { executionCount: agent.executionCount, errorRate: agent.errorCount / agent.executionCount },
      { duration }
    );

    // 更新指标历史
    updateMetrics();
  }

  // 记录工具执行
  function recordToolExecution(agentId: string, toolName: string, startTime: number, success: boolean, result?: any): void {
    const duration = Date.now() - startTime;
    
    log(
      success ? LogLevel.DEBUG : LogLevel.ERROR,
      agentId,
      'tool',
      `${toolName} executed in ${duration}ms`,
      { toolName, success }, 
      { duration }
    );
  }

  // 更新系统指标
  function updateMetrics(): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    const metrics: Metrics = {
      agents: {
        total: agents.size,
        running: Array.from(agents.values()).filter(a => a.health !== 'failed').length,
        failed: Array.from(agents.values()).filter(a => a.health === 'failed').length,
        avgResponseTime: agents.size > 0 
          ? Array.from(agents.values())
              .filter(a => a.executionCount > 0)
              .reduce((sum, a) => sum + (a.totalTime / a.executionCount), 0) / 
            Array.from(agents.values()).filter(a => a.executionCount > 0).length
          : 0
      },
      tools: {
        total: new Set(Array.from(logBuffer.filter(l => l.component === 'tool').map(l => l.metadata?.toolName))).size,
        executions: logBuffer.filter(l => l.component === 'tool').length,
        failures: logBuffer.filter(l => l.component === 'tool' && l.level === LogLevel.ERROR).length,
        avgExecutionTime: 0 // 需要进一步实现
      },
      system: {
        uptime: process.uptime(),
        memoryUsage: (memUsage.used / memUsage.total) * 100,
        cpuUsage: 0, // 简化计算
        activeConnections: 0
      }
    };

    metricsHistory.push({
      ...metrics,
      timestamp: Date.now()
    });

    // 限制历史长度
    if (metricsHistory.length > 1440) { // 保留1天的数据（每分钟一个）
      metricsHistory.shift();
    }

    // 记录系统指标
    log(LogLevel.DEBUG, 'system', 'metrics', 'System metrics updated', metrics, {
      duration: 0,
      memory: memUsage.used,
      cpu: 0
    });
  }

  // 定期刷新日志
  function startLogRotation(): void {
    if (!finalConfig.logRotation) return;

    setInterval(async () => {
      try {
        // 轮转日志文件
        const newWriter = await createLogFile(finalConfig.logPath!, 'app');
        
        // 关闭旧写入器
        logWriters[1]?.end();
        logWriters[1] = newWriter;
        
        // 清理过期日志
        await cleanupOldLogs();
        
        console.log('🔄 Log rotation completed');
      } catch (error) {
        log(LogLevel.ERROR, 'system', 'logrotation', 'Log rotation failed', { error: error.message });
      }
    }, 60 * 60 * 1000); // 每小时轮转一次
  }

  // 清理过期日志
  async function cleanupOldLogs(): Promise<void> {
    const retentionMs = finalConfig.logRetention! * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;
    
    // 清理内存中的旧日志
    const recentLogs = logBuffer.filter(entry => entry.timestamp > cutoff);
    logBuffer.splice(0, logBuffer.length, ...recentLogs);
    
    // 清理内存中的过期指标
    const recentMetrics = metricsHistory.filter(m => m.timestamp > cutoff);
    metricsHistory.splice(0, metricsHistory.length, ...recentMetrics);
  }

  return {
    name: 'production_monitoring',
    
    hook: {
      async beforeRun({ task, messages }) {
        const agentId = 'unknown'; // 应该从上下文中获取
        recordExecutionStart(agentId, task);
        
        return { task, messages };
      },

      async afterRun({ task, messages, result }) {
        const agentId = 'unknown';
        // 这里应该获取实际的执行开始时间
        recordExecutionEnd(agentId, Date.now(), true, result);
        
        return { task, messages, result };
      },

      async beforeTool({ tool, parameters }) {
        const agentId = 'unknown';
        const startTime = Date.now();
        
        // 将开始时间传递给 afterTool
        (parameters as any).__executionStartTime = startTime;
        
        log(LogLevel.DEBUG, agentId, 'tool', `Calling tool: ${tool}`, { parameters });
        
        return { tool, parameters };
      },

      async afterTool({ tool, parameters, result, duration }) {
        const agentId = 'unknown';
        const startTime = (parameters as any).__executionStartTime || Date.now();
        
        recordToolExecution(agentId, tool, startTime, true, result);
        
        return { tool, parameters, result, duration };
      }
    },

    // 公共方法
    getCurrentMetrics(): Metrics {
      return metricsHistory[metricsHistory.length - 1] || {
        agents: { total: 0, running: 0, failed: 0, avgResponseTime: 0 },
        tools: { total: 0, executions: 0, failures: 0, avgExecutionTime: 0 },
        system: { uptime: 0, memoryUsage: 0, cpuUsage: 0, activeConnections: 0 }
      };
    },

    getHealthReport(): any {
      const currentMetrics = this.getCurrentMetrics();
      const recentLogs = logBuffer.slice(-100);
      
      return {
        status: this.calculateSystemStatus(),
        metrics: currentMetrics,
        alerts: Array.from(this.alertSystem.entries()).map(([type, timestamp]) => ({
          type,
          lastTriggered: timestamp,
          timeSinceLastAlert: Date.now() - timestamp
        })),
        logSummary: {
          total: logBuffer.length,
          recentErrors: recentLogs.filter(l => l.level === LogLevel.ERROR).length,
          recentWarnings: recentLogs.filter(l => l.level === LogLevel.WARN).length
        },
        agentHealth: Object.fromEntries(agents)
      };
    },

    getSystemStatus(): 'healthy' | 'degraded' | 'failed' {
      return this.calculateSystemStatus();
    },

    calculateSystemStatus(): 'healthy' | 'degraded' | 'failed' {
      const currentMetrics = this.getCurrentMetrics();
      const recentLogs = logBuffer.slice(-100).filter(l => 
        l.timestamp > Date.now() - 60000 // 最近1分钟
      );
      
      const errorRate = recentLogs.filter(l => l.level === LogLevel.ERROR).length / recentLogs.length;
      const memoryUsage = currentMetrics.system.memoryUsage;
      
      if (errorRate > 0.2 || memoryUsage > 90) {
        return 'failed';
      } else if (errorRate > 0.05 || memoryUsage > 75) {
        return 'degraded';
      }
      
      return 'healthy';
    },

    // 生命周期方法
    onLoad() {
      initializeLogging().then(() => {
        startLogRotation();
        setInterval(updateMetrics, 60000); // 每分钟更新指标
      });
      
      eventEmitter.on('alert', (alert) => {
        // 这里可以集成SLACK、邮件、或PAGERDUTY等告警系统
        console.log(`🚨 Production Alert: ${JSON.stringify(alert, null, 2)}`);
      });
      
      console.log('📈 Production monitoring plugin loaded');
    },

    onUnload() {
      // 清理资源
      logWriters.forEach(writer => writer.end());
      logBuffer.length = 0;
      metricsHistory.length = 0;
      
      console.log('📈 Production monitoring plugin unloaded');
    }
  };
}
```

## 示例 3: 性能和可扩展性优化

### 集群部署和负载均衡

```typescript
import { Agent, ModelInterface } from 'pocket-agent';
import { EventEmitter } from 'events';

// 代理实例信息
interface AgentInstance {
  id: string;
  agent: Agent;
  status: 'active' | 'busy' | 'overloaded' | 'failed';
  load: number; // 0-100
  capabilities: string[];
  health: number; // 0-100
  lastHeartbeat: number;
}

// 工作负载配置
interface LoadBalancingConfig {
  maxConcurrentTasks?: number;
  healthCheckInterval?: number;
  scaling?: {
    minInstances?: number;
    maxInstances?: number;
    scaleUpThreshold?: number;
    scaleDownThreshold?: number;
  };
}

// 负载均衡代理管理器
class AgentLoadBalancer {
  private instances: Map<string, AgentInstance> = new Map();
  private taskQueue: Array<{
    task: string;
    callback: (result: string) => void;
    priority: number;
  }> = [];
  private eventEmitter = new EventEmitter();
  private scalingEnabled = true;

  constructor(private config: LoadBalancingConfig = {}) {
    const defaultConfig = {
      maxConcurrentTasks: 10,
      healthCheckInterval: 30000,
      scaling: {
        minInstances: 1,
        maxInstances: 10,
        scaleUpThreshold: 80,
        scaleDownThreshold: 20
      }
    };
    
    this.config = { ...defaultConfig, ...config };
  }

  // 注册代理实例
  registerInstance(instance: AgentInstance): void {
    this.instances.set(instance.id, {
      ...instance,
      lastHeartbeat: Date.now()
    });
    
    console.log(`🔄 Registered agent instance: ${instance.id}`);
    this.eventEmitter.emit('instanceRegistered', instance);
  }

  // 注销代理实例
  unregisterInstance(instanceId: string): void {
    this.instances.delete(instanceId);
    console.log(`❌ Unregistered agent instance: ${instanceId}`);
  }

  // 智能分配任务
  async dispatchTask(task: string, requirements?: {
    capabilities?: string[];
    priority?: number;
  }): Promise<string> {
    const priority = requirements?.priority || 5;
    
    return new Promise(async (resolve, reject) => {
      // 选择最佳实例
      const bestInstance = this.findBestInstance(requirements?.capabilities);
      
      if (!bestInstance) {
        console.log('🔄 No available instance, queuing task');
        this.taskQueue.push({
          task,
          callback: resolve,
          priority
        });
        
        // 尝试扩容
        if (this.scalingEnabled) {
          await this.attemptScaleOut();
        }
        
        return;
      }

      try {
        console.log(`📤 Dispatching task to ${bestInstance.id} (load: ${bestInstance.load}%)`);
        
        const startTime = Date.now();
        bestInstance.status = 'busy';
        
        const result = await bestInstance.agent.run(task);
        
        const duration = Date.now() - startTime;
        this.updateInstanceMetrics(bestInstance.id, duration, true);
        
        resolve(result);
      } catch (error) {
        this.updateInstanceMetrics(bestInstance.id, 0, false);
        reject(error);
      }
    });
  }

  // 查找最佳实例
  private findBestInstance(capabilities?: string[]): AgentInstance | null {
    const candidates = Array.from(this.instances.values())
      .filter(instance => {
        // 检查实例状态
        if (instance.status === 'failed' || instance.health < 50) {
          return false;
        }
        
        // 检查负载
        if (instance.load >= this.config.maxConcurrentTasks!) {
          return false;
        }
        
        // 检查能力需求
        if (capabilities && capabilities.length > 0) {
          const hasAllCapabilities = capabilities.every(req => 
            instance.capabilities.includes(req)
          );
          if (!hasAllCapabilities) {
            return false;
          }
        }
        
        return true;
      });

    if (candidates.length === 0) {
      return null;
    }

    // 使用加权随机选择，考虑负载和健康状况
    return this.selectBestCandidate(candidates);
  }

  // 选择最佳候选实例
  private selectBestCandidate(candidates: AgentInstance[]): AgentInstance {
    const totalScore = candidates.reduce((sum, instance) => {
      const loadScore = 100 - instance.load;
      const healthScore = instance.health;
      const availabilityScore = (this.config.maxConcurrentTasks! - instance.load) * 10;
      
      return sum + (loadScore + healthScore + availabilityScore);
    }, 0);

    let random = Math.random() * totalScore;
    
    for (const candidate of candidates) {
      const loadScore = 100 - candidate.load;
      const healthScore = candidate.health;
      const availabilityScore = (this.config.maxConcurrentTasks! - candidate.load) * 10;
      
      const candidateScore = loadScore + healthScore + availabilityScore;
      
      if (random <= candidateScore) {
        return candidate;
      }
      
      random -= candidateScore;
    }

    return candidates[0];
  }

  // 更新实例指标
  private updateInstanceMetrics(instanceId: string, duration: number, success: boolean): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    instance.lastHeartbeat = Date.now();
    
    // 更新负载（简化计算）
    if (success) {
      const avgDuration = 5000; // 假设平均5秒执行时间
      const loadIncrease = Math.min(duration / avgDuration * 10, 25);
      instance.load = Math.max(0, Math.min(100, instance.load + loadIncrease));
    } else {
      instance.load = Math.max(0, instance.load - 5);
    }

    // 更新健康状态
    if (!success) {
      instance.health = Math.max(0, instance.health - 10);
      if (instance.health < 30) {
        instance.status = 'failed';
      }
    } else {
      instance.health = Math.min(100, instance.health + 5);
      instance.status = 'active';
    }

    console.log(`📊 Updated ${instanceId}: load=${instance.load}%, health=${instance.health}%`);
  }

  // 尝试水平扩容
  private async attemptScaleOut(): Promise<void> {
    if (this.candidateQueue.length > this.config.scaling!.minInstances!) {
      return;
    }

    if (this.instances.size >= this.config.scaling!.maxInstances!) {
      return;
    }

    const queueLoad = this.taskQueue.length;
    const avgLoad = this.calculateAverageLoad();
    
    if (queueLoad > 0 || avgLoad > this.config.scaling!.scaleUpThreshold!) {
      await this.createNewInstance();
    }
  }

  // 计算平均负载
  private calculateAverageLoad(): number {
    if (this.instances.size === 0) return 0;
    
    const totalLoad = Array.from(this.instances.values())
      .reduce((sum, instance) => sum + instance.load, 0);
    
    return totalLoad / this.instances.size;
  }

  // 创建新实例
  private async createNewInstance(): Promise<void> {
    const instanceId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // 创建一个新的代理实例
      const instance: AgentInstance = {
        id: instanceId,
        agent: createAgent({
          // 这里应该加载适当的配置
          model: this.config.model,
          tools: this.config.tools,
          maxIterations: 5
        }),
        status: 'active',
        load: 0,
        capabilities: ['general'],
        health: 100,
        lastHeartbeat: Date.now()
      };

      this.registerInstance(instance);
      
      console.log(`🚀 Scaled out: created ${instanceId}`);
      
    } catch (error) {
      console.error(`❌ Failed to scale out:`, error);
    }
  }

  // 健康检查
  startHealthChecks(): void {
    setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval!);
  }

  private performHealthCheck(): void {
    const now = Date.now();
    
    Array.from(this.instances.entries()).forEach(([id, instance]) => {
      // 检查心跳超时
      if (now - instance.lastHeartbeat > 120000) { // 2分钟超时
        console.log(`🚨 Instance ${id} appears to be unresponsive`);
        instance.status = 'failed';
        instance.health = 0;
      }
      
      // 尝试故障恢复
      if (instance.status === 'failed' && instance.health < 20) {
        this.attemptRecovery(id);
      }
    });
  }

  // 尝试故障恢复
  private attemptRecovery(instanceId: string): void {
    console.log(`🔄 Attempting recovery for ${instanceId}`);
    
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    try {
      // 重置实例
      instance.health = 50;
      instance.load = 0;
      instance.lastHeartbeat = Date.now();
      
      console.log(`✅ Recovery initiated for ${instanceId}`);
    } catch (error) {
      console.error(`❌ Recovery failed for ${instanceId}:`, error);
      this.unregisterInstance(instanceId);
    }
  }

  // 获取系统状态报告
  getSystemReport(): any {
    const instances = Array.from(this.instances.values());
    const avgLoad = this.calculateAverageLoad();
    const avgHealth = instances.length > 0 
      ? instances.reduce((sum, i) => sum + i.health, 0) / instances.length
      : 0;

    const scaling = this.calculateScalingRecommendation(avgLoad);

    return {
      overview: {
        totalInstances: instances.length,
        activeInstances: instances.filter(i => i.status === 'active').length,
        busyInstances: instances.filter(i => i.status === 'busy').length,
        failedInstances: instances.filter(i => i.status === 'failed').length,
        queueSize: this.taskQueue.length
      },
      performance: {
        averageLoad: avgLoad,
        averageHealth: avgHealth,
        utilization: instances.length > 0 
          ? instances.reduce((sum, i) => sum + i.load, 0) / instances.length / 100
          : 0
      },
      scaling: {
        current: instances.length,
        recommendation: scaling.recommendation,
        decision: scaling.decision,
        reasoning: scaling.reasoning
      },
      instances: instances.map(instance => ({
        id: instance.id,
        status: instance.status,
        load: instance.load,
        health: instance.health,
        capabilities: instance.capabilities,
        lastHeartbeat: instance.lastHeartbeat
      }))
    };
  }

  private calculateScalingRecommendation(avgLoad: number): {
    recommendation: number;
    decision: 'scale_up' | 'scale_down' | 'no_change';
    reasoning: string;
  } {
    const currentInstances = this.instances.size;
    
    if (avgLoad > this.config.scaling!.scaleUpThreshold!) {
      if (currentInstances < this.config.scaling!.maxInstances!) {
        return {
          recommendation: currentInstances + 1,
          decision: 'scale_up',
          reasoning: `Average load (${avgLoad}%) exceeds threshold (${this.config.scaling!.scaleUpThreshold}%)`
        };
      }
      return {
        recommendation: currentInstances,
        decision: 'no_change',
        reasoning: 'Already at maximum instances'
      };
    } else if (avgLoad < this.config.scaling!.scaleDownThreshold! && currentInstances > this.config.scaling!.minInstances!) {
      return {
        recommendation: currentInstances - 1,
        decision: 'scale_down',
        reasoning: `Average load (${avgLoad}%) below threshold (${this.config.scaling!.scaleDownThreshold}%)`
      };
    }
    
    return {
      recommendation: currentInstances,
      decision: 'no_change',
      reasoning: 'Load within acceptable range'
    };
  }

  // 处理队列任务
  private processQueuedTasks(): void {
    if (this.taskQueue.length === 0) return;

    const freeInstance = this.findBestInstance();
    if (freeInstance) {
      const task = this.taskQueue.shift()!;
      console.log(`🔄 Processing queued task with ${freeInstance.id}`);
      
      this.dispatchTask(task.task).then(
        task.callback,
        (error) => console.error('Queued task failed:', error)
      );
    }
  }
}
```

这些生产部署示例展示了：

1. **智能错误处理** - 错误分类、重试逻辑、故障恢复
2. **综合监控日志** - 日志轮转、告警系统、性能指标
3. **负载均衡集群** - 自动扩缩容、健康检查、任务分发

这些系统设计遵循了企业级应用的可靠性、可扩展性和可观测性原则。
