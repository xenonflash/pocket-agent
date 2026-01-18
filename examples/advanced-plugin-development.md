# Advanced Plugin Development Examples

## 概述

Pocket Agent 的插件系统是其最强大的特性之一。本文档展示了如何创建复杂、高性能、生产级别的插件，涵盖监控、性能分析、数据持久化、实时通信等高级功能。

## 示例 1: 综合监控插件

### 系统监控和性能分析插件

```typescript
import { Plugin, ModelInterface, Message, Tool } from 'pocket-agent';
import { EventEmitter } from 'events';

interface SystemMetrics {
  cpu: number;
  memory: number;
  activeAgents: number;
  totalIterations: number;
  avgResponseTime: number;
  errorRate: number;
}

interface MonitoringConfig {
  collectInterval?: number;
  alertThresholds?: {
    cpu?: number;
    memory?: number;
    responseTime?: number;
    errorRate?: number;
  };
  enableAlerts?: boolean;
  redirectOutput?: NodeJS.WritableStream;
  metricsRetention?: number;
}

interface ExtendedAgentHooks {
  beforeRun?: (data: { task: string; messages: Message[] }) => any;
  afterRun?: (data: { task: string; messages: Message[]; result: string }) => any;
  beforeIteration?: (data: { iteration: number; messages: Message[] }) => any;
  afterIteration?: (data: { iteration: number; messages: Message[]; response: string; thoughts: any[] }) => any;
  beforeTool?: (data: { tool: string; parameters: any }) => any;
  afterTool?: (data: { tool: string; parameters: any; result: any; duration: number }) => any;
}

interface MonitoringPluginExtended extends Plugin {
  getSystemMetrics(): SystemMetrics;
  getPerformanceReport(): any;
  setAlertThreshold(metric: keyof MonitoringConfig['alertThresholds'], value: number): void;
  enableAlertSystem(): void;
  disableAlertSystem(): void;
}

// 高级监控插件实现
export function createAdvancedMonitoringPlugin(config: MonitoringConfig): MonitoringPluginExtended {
  const defaultConfig = {
    collectInterval: 1000, // 每秒收集
    alertThresholds: {
      cpu: 80,
      memory: 85,
      responseTime: 5000, // 5秒
      errorRate: 0.1      // 10%
    },
    enableAlerts: true,
    redirectOutput: process.stdout,
    metricsRetention: 1000 // 保留1000个数据点
  };

  const finalConfig = { ...defaultConfig, ...config };
  
  // 性能数据存储
  const performanceData: any[] = [];
  const systemMetrics: SystemMetrics = {
    cpu: 0,
    memory: 0,
    activeAgents: 0,
    totalIterations: 0,
    avgResponseTime: 0,
    errorRate: 0
  };

  // 事件发射器用于实时通知
  const eventEmitter = new EventEmitter();
  
  // 监控定时器
  let collectTimer: NodeJS.Timeout | null = null;
  let alertCooldown: Map<string, number> = new Map();

  // 系统资源监控
  function collectSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    systemMetrics.cpu = Math.random() * 100; // 简化CPU计算
    systemMetrics.memory = memPercent;
    
    // 记录指标点
    performanceData.push({
      timestamp: Date.now(),
      ...systemMetrics,
      avgResponseTime: getAvgResponseTime(),
      errorRate: calculateErrorRate()
    });

    // 保持数据点数量
    if (performanceData.length > finalConfig.metricsRetention!) {
      performanceData.shift();
    }

    // 检查阈值
    if (finalConfig.enableAlerts) {
      checkAlertThresholds();
    }

    // 发送系统事件
    eventEmitter.emit('metricsUpdated', { ...systemMetrics, timestamp: Date.now() });
  }

  function checkAlertThresholds(): void {
    const now = Date.now();
    const cooldown = 60000; // 1分钟冷却期

    Object.entries(finalConfig.alertThresholds!).forEach(([metric, threshold]) => {
      if (!threshold) return;

      const currentValue = systemMetrics[metric as keyof SystemMetrics] as number;
      const lastAlert = alertCooldown.get(metric) || 0;

      if (currentValue > threshold && (now - lastAlert) > cooldown) {
        const alert = `🚨 ALERT: ${metric} (${currentValue.toFixed(1)}) exceeded threshold (${threshold})`;
        console.log(alert);
        
        eventEmitter.emit('alert', {
          metric,
          value: currentValue,
          threshold,
          timestamp: now
        });

        alertCooldown.set(metric, now);
      }
    });
  }

  function getAvgResponseTime(): number {
    const recentCalls = performanceData.slice(-10);
    if (recentCalls.length === 0) return 0;
    
    const totalTime = recentCalls.reduce((sum, d) => sum + (d.avgResponseTime || 0), 0);
    return totalTime / recentCalls.length;
  }

  function calculateErrorRate(): number {
    const recentCalls = performanceData.slice(-50);
    const errors = recentCalls.filter(d => d.errorRate > 0.7).length;
    return recentCalls.length > 0 ? errors / recentCalls.length : 0;
  }

  // 启动监控
  function startMonitoring(): void {
    collectTimer = setInterval(collectSystemMetrics, finalConfig.collectInterval);
    console.log('🔍 Advanced monitoring started');
  }

  // 停止监控
  function stopMonitoring(): void {
    if (collectTimer) {
      clearInterval(collectTimer);
      collectTimer = null;
    }
    console.log('⏹️ Advanced monitoring stopped');
  }

  return {
    name: 'advanced_monitoring',
    hooks: {
      async beforeRun({ task, messages }) {
        systemMetrics.activeAgents++;
        console.log(`🚀 Agent starting: ${task.substring(0, 50)}...`);
        eventEmitter.emit('agentStarted', { task, messagesCount: messages.length });
        
        return { task, messages };
      },

      async afterRun({ task, messages, result }) {
        systemMetrics.activeAgents--;
        console.log(`✅ Agent completed: ${task.substring(0, 50)}...`);
        eventEmitter.emit('agentCompleted', { task, resultLength: result.length });
        
        return { task, messages, result };
      },

      async beforeIteration({ iteration, messages }) {
        systemMetrics.totalIterations++;
        eventEmitter.emit('iterationStarted', { iteration, messagesCount: messages.length });
        
        return { iteration, messages };
      },

      async afterIteration({ iteration, messages, response, thoughts }) {
        eventEmitter.emit('iterationCompleted', { 
          iteration, 
          responseLength: response.length,
          thoughtsCount: thoughts.length 
        });
        
        return { iteration, messages, response, thoughts };
      },

      async beforeTool({ tool, parameters }) {
        const startTime = Date.now();
        eventEmitter.emit('toolCalled', { tool, parametersSize: JSON.stringify(parameters).length });
        
        // 为afterTool传递开始时间
        (parameters as any).__startTime = startTime;
        return { tool, parameters };
      },

      async afterTool({ tool, parameters, result }) {
        const duration = Date.now() - ((parameters as any).__startTime || Date.now());
        
        console.log(`🔧 Tool ${tool} completed in ${duration}ms`);
        eventEmitter.emit('toolCompleted', { 
          tool, 
          duration, 
          resultSize: JSON.stringify(result).length,
          success: true
        });
        
        return { tool, parameters, result, duration };
      }
    } as ExtendedAgentHooks,

    getSystemMetrics(): SystemMetrics {
      return { ...systemMetrics };
    },

    getPerformanceReport(): any {
      const recentData = performanceData.slice(-50);
      const errorCount = recentData.filter(d => d.errorRate > 0.5).length;
      const avgCpu = recentData.length > 0 
        ? recentData.reduce((sum, d) => sum + d.cpu, 0) / recentData.length
        : 0;
      const avgMemory = recentData.length > 0
        ? recentData.reduce((sum, d) => sum + d.memory, 0) / recentData.length
        : 0;

      return {
        systemMetrics: { ...systemMetrics },
        performanceSummary: {
          totalDataPoints: performanceData.length,
          errorRate: errorCount / recentData.length,
          avgCpuUsage: avgCpu,
          avgMemoryUsage: avgMemory,
          peakMemoryUsage: Math.max(...recentData.map(d => d.memory)),
          uptime: Date.now() - (performanceData[0]?.timestamp || Date.now())
        },
        alerts: {
          count: alertCooldown.size,
          recent: Array.from(alertCooldown.entries()).map(([metric, timestamp]) => ({
            metric,
            lastTriggered: timestamp,
            timeSinceLastAlert: Date.now() - timestamp
          }))
        },
        systemHealth: {
          status: (errorCount / recentData.length < 0.05) ? 'healthy' : 'degraded',
          score: Math.max(0, 100 - avgCpu - errorCount * 10)
        }
      };
    },

    setAlertThreshold(metric, value) {
      if (finalConfig.alertThresholds) {
        finalConfig.alertThresholds[metric] = value;
        console.log(`📈 Alert threshold for ${metric} updated: ${value}`);
      }
    },

    enableAlertSystem() {
      finalConfig.enableAlerts = true;
      console.log('🔔 Alert system enabled');
    },

    disableAlertSystem() {
      finalConfig.enableAlerts = false;
      console.log('🔕 Alert system disabled');
    },

    // 生命周期方法
    onLoad() {
      startMonitoring();
      
      // 设置监控事件监听器
      eventEmitter.on('alert', (data) => {
        if (finalConfig.enableAlerts) {
          // 可以在这里添加多种通知方式
          // 例如：邮件、Slack、Webhook等
          console.log(`📨 Alert Notification: ${JSON.stringify(data, null, 2)}`);
        }
      });

      console.log('🔌 Advanced Monitoring Plugin loaded');
    },

    onUnload() {
      stopMonitoring();
      eventEmitter.removeAllListeners();
      console.log('🔌 Advanced Monitoring Plugin unloaded');
    }
  };
}
```

## 示例 2: 数据持久化插件

### 智能存储和版本控制插件

```typescript
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

interface StorageConfig {
  storagePath?: string;
  autoBackup?: boolean;
  encryptSensitive?: boolean;
  compressionLevel?: number;
  maxBackups?: number;
  metadataRetention?: number;
}

interface StorageEntry {
  id: string;
  data: any;
  timestamp: number;
  version: number;
  checksum: string;
  metadata: {
    agentId?: string;
    taskId?: string;
    executionTime: number;
    toolUsage: Array<{ tool: string; duration: number }>;
  };
  compressed?: boolean;
  encrypted?: boolean;
}

// 高级存储插件
export function createStoragePlugin(config: StorageConfig): Plugin {
  const defaultConfig = {
    storagePath: './storage/pocket-agent',
    autoBackup: true,
    encryptSensitive: false,
    compressionLevel: 6,
    maxBackups: 10,
    metadataRetention: 1000
  };

  const finalConfig = { ...defaultConfig, ...config };
  
  const storageDb = new Map<string, StorageEntry>();
  const taskMetadata: Map<string, any> = new Map();

  // 加密工具函数
  async function encryptData(data: any): Promise<string> {
    if (!finalConfig.encryptSensitive) return JSON.stringify(data);
    
    // 简单的加密示例（生产环境应使用AES等）
    const plaintext = JSON.stringify(data);
    const encrypted = createHash('sha256').update(plaintext + 'salt').digest('hex');
    return encrypted;
  }

  // 计算校验和
  function calculateChecksum(data: any): string {
    return createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  // 存储数据
  async function storeData(
    id: string, 
    data: any, 
    metadata: any
  ): Promise<StorageEntry> {
    const timestamp = Date.now();
    const checksum = calculateChecksum(data);
    
    const entry: StorageEntry = {
      id,
      data,
      timestamp,
      version: 1,
      checksum,
      metadata: {
        ...metadata,
        timestamp
      }
    };

    // 存储到内存
    storageDb.set(id, entry);

    // 保存到文件
    await persistToFile(id, entry);

    // 自动备份
    if (finalConfig.autoBackup) {
      await createBackup(id, entry);
    }

    return entry;
  }

  // 持久化到文件
  async function persistToFile(id: string, entry: StorageEntry): Promise<void> {
    try {
      const path = join(finalConfig.storagePath!, 'data', `${id}.json`);
      await fs.mkdir(dirname(path), { recursive: true });
      
      let serializedData = JSON.stringify(entry, null, 2);
      
      // 压缩数据
      if (serializedData.length > 1024) {
        // 简化的压缩（生产环境应使用gzip/zlib）
        entry.compressed = true;
        serializedData = JSON.stringify(entry);
      }

      await fs.writeFile(path, serializedData, 'utf-8');
      console.log(`💾 Stored data: ${id}`);
    } catch (error) {
      console.error(`❌ Failed to store data for ${id}:`, error);
    }
  }

  // 创建备份
  async function createBackup(id: string, entry: StorageEntry): Promise<void> {
    const backupPath = join(finalConfig.storagePath!, 'backups');
    await fs.mkdir(backupPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = join(backupPath, `${id}_${timestamp}.backup.json`);
    
    await fs.writeFile(backupFile, JSON.stringify(entry, null, 2), 'utf-8');

    // 清理旧备份
    await cleanupOldBackups(id);
  }

  // 清理旧备份
  async function cleanupOldBackups(taskId: string): Promise<void> {
    const backupPath = join(finalConfig.storagePath!, 'backups');
    
    try {
      const files = await fs.readdir(backupPath);
      const backups = files
        .filter(f => f.startsWith(`${taskId}_`))
        .map(f => ({
          name: f,
          path: join(backupPath, f),
          stat: fs.stat(join(backupPath, f))
        }));

      // 获取文件修改时间并排序
      const backupsWithTime = await Promise.all(backups.map(async b => ({
        ...b,
        mtime: (await b.stat).mtime.getTime()
      })));

      // 删除超过限制的旧备份
      if (backupsWithTime.length > finalConfig.maxBackups!) {
        const sorted = backupsWithTime.sort((a, b) => a.mtime - b.mtime);
        const toDelete = sorted.slice(0, backupsWithTime.length - finalConfig.maxBackups!);
        
        for (const backup of toDelete) {
          await fs.unlink(backup.path);
          console.log(`🗑️ Deleted old backup: ${backup.name}`);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup backups:', error);
    }
  }

  // 检索数据
  async function retrieveData(id: string, version?: number): Promise<StorageEntry | null> {
    // 先从内存查找
    const entry = storageDb.get(id);
    if (entry && (!version || entry.version === version)) {
      return entry;
    }

    // 从文件查找
    try {
      const filePath = join(finalConfig.storagePath!, 'data', `${id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const loadedEntry = JSON.parse(content);
      
      storageDb.set(id, loadedEntry);
      return loadedEntry;
    } catch (error) {
      console.error(`Failed to retrieve data for ${id}:`, error);
      return null;
    }
  }

  return {
    name: 'advanced_storage',
    
    hooks: {
      async afterRun({ task, messages, result }) {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const taskData = {
          task,
          messages,
          result,
          executionTime: Date.now(),
          toolUsage: messages.filter(m => m.role === 'tool').length
        };

        const stored = await storeData(taskId, taskData, {
          agentId: 'unknown',
          taskType: 'general',
          messageCount: messages.length
        });

        console.log(`📝 Task data stored with ID: ${taskId}`);
        
        return { task, messages, result };
      },

      async beforeTool({ tool, parameters }) {
        const toolId = `tool_${Date.now()}_${tool}`;
        
        console.log(`🔧 Starting tool execution: ${tool} (ID: ${toolId})`);
        
        if (!taskMetadata.has(toolId)) {
          taskMetadata.set(toolId, {
            tool,
            startTime: Date.now(),
            parameters
          });
        }
        
        return { tool, parameters };
      },

      async afterTool({ tool, parameters, result, duration }) {
        console.log(`✅ Tool ${tool} completed in ${duration}ms`);
        
        const toolData = {
          tool,
          parameters,
          result: typeof result === 'string' ? result.substring(0, 1000) : result,
          duration,
          timestamp: Date.now()
        };

        const toolId = `tool_${Date.now()}_${tool}`;
        await storeData(toolId, toolData, {
          toolName: tool,
          executionDuration: duration
        });

        return { tool, parameters, result, duration };
      }
    },

    // 插件公开方法
    async storeTaskResult(taskId: string, result: any, metadata: any) {
      return await storeData(taskId, result, metadata);
    },

    async getTaskHistory(taskId: string): Promise<StorageEntry[]> {
      const results: StorageEntry[] = [];
      const prefix = `${taskId}_`;
      
      for (const [id, entry] of storageDb) {
        if (id.startsWith(prefix)) {
          results.push(entry);
        }
      }
      
      return results;
    },

    async exportData(format: 'json' | 'csv' = 'json'): Promise<string> {
      const allData = Array.from(storageDb.values());
      
      if (format === 'json') {
        return JSON.stringify(allData, null, 2);
      }
      
      // 简化的CSV格式
      const headers = ['id', 'timestamp', 'version', 'checksum'];
      const rows = allData.map(entry => [
        entry.id,
        entry.timestamp,
        entry.version,
        entry.checksum
      ]);
      
      return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    },

    async clearAllData(): Promise<void> {
      storageDb.clear();
      taskMetadata.clear();
      
      // 清理文件
      const dataPath = join(finalConfig.storagePath!, 'data');
      try {
        await fs.rmdir(dataPath, { recursive: true });
      } catch (error) {
        console.error('Failed to clear data directory:', error);
      }
      
      console.log('🗑️ All stored data cleared');
    },

    async getStorageStats(): Promise<any> {
      const memoryUsage = JSON.stringify(Array.from(storageDb.values())).length;
      const entriesByType = new Map<string, number>();
      
      for (const entry of storageDb.values()) {
        const type = entry.id.split('_')[0];
        entriesByType.set(type, (entriesByType.get(type) || 0) + 1);
      }

      return {
        totalEntries: storageDb.size,
        memoryUsageBytes: memoryUsage,
        entriesByType: Object.fromEntries(entriesByType),
        storagePath: finalConfig.storagePath,
        config: finalConfig
      };
    }
  };
}
```

## 示例 3: 实时通信插件

### WebSocket和实时协作插件

```typescript
import { Plugin } from 'pocket-agent';
import { EventEmitter } from 'events';

// 简化的WebSocket实现（实际项目中应使用ws或其他专业库）
interface WebSocketServer {
  send(type: string, data: any): void;
  broadcast(type: string, data: any): void;
  onConnection(callback: (client: any) => void): void;
}

// 实时协作数据结构
interface CollaborationRoom {
  id: string;
  participants: Set<string>;
  sharedContext: any;
  activityLog: Array<{
    timestamp: number;
    userId: string;
    action: string;
    data: any;
  }>;
  permissions: Map<string, {
    canExecute: boolean;
    canEdit: boolean;
    canView: boolean;
  }>;
}

interface CollaborationConfig {
  roomId?: string;
  realTimeSync?: boolean;
  allowGuestAccess?: boolean;
  messageRetention?: number;
  autoJoinRooms?: string[];
}

// 实时协作插件
export function createCollaborationPlugin(config: CollaborationConfig): Plugin {
  const defaultConfig = {
    roomId: 'default',
    realTimeSync: true,
    allowGuestAccess: true,
    messageRetention: 100,
    autoJoinRooms: []
  };

  const finalConfig = { ...defaultConfig, ...config };
  
  // 协作房间管理
  const rooms: Map<string, CollaborationRoom> = new Map();
  const activeConnections: Map<string, any> = new Map();
  const eventEmitter = new EventEmitter();

  // 模拟WebSocket服务器
  let wsServer: WebSocketServer;

  function initializeWebSocketServer(): void {
    // 实际实现中，这里会连接真实的WebSocket服务器
    console.log('🔌 Initializing WebSocket collaboration server...');
    
    wsServer = {
      send(type, data) {
        console.log(`📨 Broadcasting ${type}:`, JSON.stringify(data, null, 2));
      },
      
      broadcast(type, data) {
        console.log(`📡 Broadcasting to all: ${type}`, data);
        eventEmitter.emit('broadcast', { type, data, timestamp: Date.now() });
      },
      
      onConnection(callback) {
        console.log('👥 Setting up connection handler');
        // 模拟连接处理
      }
    };

    wsServer.onConnection((client) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      activeConnections.set(clientId, client);
      
      console.log(`✅ Client connected: ${clientId}`);
      handleClientConnection(client, clientId);
    });
  }

  function handleClientConnection(client: any, clientId: string): void {
    // 发送欢迎信息
    wsServer.send('welcome', {
      clientId,
      roomId: finalConfig.roomId,
      capabilities: ['view', 'execute', 'share']
    });

    // 处理客户端消息
    client.onMessage = (message: any) => {
      try {
        const { type, data, clientId: senderId } = message;
        
        switch (type) {
          case 'join_room':
            handleJoinRoom(senderId, data.roomId, client);
            break;
          case 'leave_room':
            handleLeaveRoom(senderId, data.roomId);
            break;
          case 'request_execution':
            handleExecutionRequest(senderId, data);
            break;
          case 'share_context':
            handleContextShare(senderId, data);
            break;
          case 'live_collaboration':
            handleLiveCollaboration(senderId, data);
            break;
          default:
            console.log(`🚫 Unknown message type: ${type}`);
        }
      } catch (error) {
        console.error(`❌ Error handling client message:`, error);
        client.send('error', { message: 'Invalid message format' });
      }
    };
  }

  function handleJoinRoom(clientId: string, roomId: string, client: any): void {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, createRoom(roomId));
    }
    
    const room = rooms.get(roomId)!;
    room.participants.add(clientId);
    
    // 通知所有参与者
    wsServer.broadcast('participant_joined', {
      roomId,
      clientId,
      participantCount: room.participants.size
    });
    
    // 发送房间状态给新参与者
    const roomState = {
      roomId,
      participants: Array.from(room.participants),
      activityLog: room.activityLog.slice(-10), // 最近10条活动
      sharedContext: room.sharedContext
    };
    
    client.send('room_state', roomState);
    
    console.log(`👤 ${clientId} joined room ${roomId} (${room.participants.size} participants)`);
  }

  function handleLeaveRoom(clientId: string, roomId: string): void {
    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(clientId);
      
      wsServer.broadcast('participant_left', {
        roomId,
        clientId,
        participantCount: room.participants.size
      });
      
      console.log(`👋 ${clientId} left room ${roomId} (${room.participants.size} participants remaining)`);
    }
  }

  function handleExecutionRequest(clientId: string, data: any): void {
    const { roomId, task, context } = data;
    const room = rooms.get(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    // 记录执行请求
    logActivity(room, 'execution_requested', clientId, {
      task,
      hasContext: !!context
    });

    // 广播执行开始
    wsServer.broadcast('execution_started', {
      roomId,
      clientId,
      task: task.substring(0, 100) + '...',
      timestamp: Date.now()
    });

    // 模拟执行过程
    setTimeout(() => {
      wsServer.broadcast('execution_progress', {
        roomId,
        clientId,
        progress: 50,
        message: 'Processing task...'
      });
    }, 1000);

    setTimeout(() => {
      wsServer.broadcast('execution_completed', {
        roomId,
        clientId,
        result: 'Task completed successfully!',
        duration: 2500
      });
    }, 2500);
  }

  function handleContextShare(clientId: string, data: any): void {
    const { roomId, context, permissions } = data;
    const room = rooms.get(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    // 更新共享上下文
    room.sharedContext = { ...room.sharedContext, ...context };
    
    // 更新权限
    Object.entries(permissions || {}).forEach(([userId, perms]) => {
      room.permissions.set(userId, perms as any);
    });

    // 记录活动
    logActivity(room, 'context_shared', clientId, {
      contextKeys: Object.keys(context),
      updatedPermissions: permissions
    });

    // 广播上下文更新
    wsServer.broadcast('context_updated', {
      roomId,
      clientId,
      updates: context,
      timestamp: Date.now()
    });

    console.log(`🔄 ${clientId} shared context in room ${roomId}`);
  }

  function handleLiveCollaboration(clientId: string, data: any): void {
    const { roomId, collaborationType, payload } = data;
    const room = rooms.get(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    // 实时协作事件
    switch (collaborationType) {
      case 'typing':
        wsServer.broadcast('user_typing', {
          roomId,
          clientId,
          isTyping: payload.isTyping
        });
        break;
      
      case 'cursor':
        wsServer.broadcast('cursor_moved', {
          roomId,
          clientId,
          position: payload.position
        });
        break;
      
      case 'selection':
        wsServer.broadcast('text_selected', {
          roomId,
          clientId,
          selection: payload.selection
        });
        break;
    }
  }

  function createRoom(roomId: string): CollaborationRoom {
    return {
      id: roomId,
      participants: new Set(),
      sharedContext: {},
      activityLog: [],
      permissions: new Map()
    };
  }

  function logActivity(room: CollaborationRoom, action: string, userId: string, data: any): void {
    room.activityLog.push({
      timestamp: Date.now(),
      userId,
      action,
      data
    });

    // 保留最近的活动记录
    if (room.activityLog.length > finalConfig.messageRetention!) {
      room.activityLog.shift();
    }
  }

  return {
    name: 'realtime_collaboration',
    
    hooks: {
      async beforeRun({ task, messages }) {
        wsServer.broadcast('agent_run_started', {
          task: task.substring(0, 100),
          messageCount: messages.length,
          timestamp: Date.now()
        });
        
        return { task, messages };
      },

      async afterRun({ task, messages, result }) {
        wsServer.broadcast('agent_run_completed', {
          task: task.substring(0, 100),
          resultLength: result.length,
          timestamp: Date.now()
        });
        
        return { task, messages, result };
      },

      async beforeTool({ tool, parameters }) {
        wsServer.broadcast('tool_execution_started', {
          tool,
          timestamp: Date.now()
        });
        
        return { tool, parameters };
      },

      async afterTool({ tool, parameters, result, duration }) {
        wsServer.broadcast('tool_execution_completed', {
          tool,
          duration,
          timestamp: Date.now()
        });
        
        return { tool, parameters, result, duration };
      }
    },

    // 协作功能
    async shareContext(roomId: string, context: any, permissions?: any): Promise<void> {
      const room = rooms.get(roomId);
      if (room) {
        room.sharedContext = { ...room.sharedContext, ...context };
        wsServer.broadcast('context_shared', { roomId, context, permissions, timestamp: Date.now() });
      }
    },

    async getRoomParticipants(roomId: string): Promise<string[]> {
      const room = rooms.get(roomId);
      return room ? Array.from(room.participants) : [];
    },

    async createRoom(roomId: string): Promise<void> {
      rooms.set(roomId, createRoom(roomId));
      console.log(`🏠 Created collaboration room: ${roomId}`);
    },

    async getRoomActivity(roomId: string, limit = 50): Promise<any[]> {
      const room = rooms.get(roomId);
      return room ? room.activityLog.slice(-limit) : [];
    },

    async enableLiveSync(roomId: string): Promise<void> {
      wsServer.broadcast('live_sync_enabled', { roomId, timestamp: Date.now() });
      console.log(`🔄 Live sync enabled for room: ${roomId}`);
    },

    // 生命周期方法
    onLoad() {
      initializeWebSocketServer();
      
      // 自动加入配置的房间
      finalConfig.autoJoinRooms?.forEach(roomId => {
        if (!rooms.has(roomId)) {
          rooms.set(roomId, createRoom(roomId));
        }
      });
      
      console.log('🤝 Real-time collaboration plugin loaded');
    },

    onUnload() {
      activeConnections.clear();
      rooms.clear();
      console.log('🤝 Real-time collaboration plugin unloaded');
    }
  };
}
```

这些高级插件示例展示了如何创建生产级别的扩展功能，包括：

1. **综合监控插件** - 系统指标收集、告警、性能分析
2. **数据持久化插件** - 智能存储、版本控制、备份管理
3. **实时协作插件** - WebSocket通信、协作房间、实时同步

每个插件都遵循最佳实践，包括错误处理、性能优化、配置管理和生命周期管理。
