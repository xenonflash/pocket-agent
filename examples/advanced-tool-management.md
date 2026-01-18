# Advanced Tool Management Examples

## 概述

Pocket Agent 提供了强大的工具管理系统，支持复杂的工具链、参数验证、自定义工具类型和动态工具加载。本文档展示了高级工具管理的各种模式。

## 示例 1: 动态工具链构建

### 基础工具接口

```typescript
import { Tool, Agent } from 'pocket-agent';

// 数据处理工具链
class DataProcessorChain {
  private tools: Tool[] = [];
  private toolRegistry: Map<string, Tool> = new Map();

  // 添加工具到注册表
  registerTool(tool: Tool) {
    this.toolRegistry.set(tool.function.name, tool);
  }

  // 链式构建
  buildToolChain(chainSpec: string[]): Tool[] {
    const chain: Tool[] = [];
    
    for (const toolName of chainSpec) {
      const tool = this.toolRegistry.get(toolName);
      if (tool) {
        chain.push(this.tool);
      }
    }
    
    return chain;
  }

  // 执行工具链
  async executeChain(chain: Tool[], input: any): Promise<any> {
    let currentInput = input;
    const results: any[] = [];
    
    for (const tool of chain) {
      try {
        console.log(`🔧 Executing ${tool.function.name}...`);
        const result = await tool.execute(currentInput);
        results.push({
          tool: tool.function.name,
          input: currentInput,
          output: result
        });
        currentInput = result;
      } catch (error) {
        console.error(`❌ Tool ${tool.function.name} failed:`, error);
        throw new Error(`Chain execution failed at ${tool.function.name}`);
      }
    }
    
    return { results, finalOutput: currentInput };
  }
}

// 使用示例
async function dataProcessingExample() {
  const chain = new DataProcessorChain();
  
  // 注册基础工具
  const tools = {
    // 数据验证工具
    validator: {
      type: 'function',
      function: {
        name: 'validate_data',
        description: 'Validates data integrity and format',
        parameters: {
          type: 'object',
          properties: {
            data: { type: 'any' },
            schema: { type: 'object' }
          },
          required: ['data', 'schema']
        }
      },
      async execute(params: any): Promise<any> {
        const { data, schema } = params;
        // 模拟数据验证
        return { 
          isValid: true, 
          cleaned: data,
          validationResults: { errors: [], warnings: [] }
        };
      }
    },
    
    // 数据转换工具
    transformer: {
      type: 'function',
      function: {
        name: 'transform_data',
        description: 'Transforms data according to business rules',
        parameters: {
          type: 'object',
          properties: {
            data: { type: 'any' },
            rules: { type: 'array' }
          },
          required: ['data']
        }
      },
      async execute(params: any): Promise<any> {
        const { data, rules = [] } = params;
        // 模拟数据转换
        const transformed = { ...data, processedAt: new Date().toISOString() };
        return { data: transformed, changes: rules.length };
      }
    },
    
    // 数据 enriquishment 工具  
    enricher: {
      type: 'function',
      function: {
        name: 'enrich_data',
        description: 'Adds additional metadata and context to data',
        parameters: {
          type: 'object',
          properties: {
            data: { type: 'any' },
            enrichmentSources: { type: 'array' }
          },
          required: ['data']
        }
      },
      async execute(params: any): Promise<any> {
        const { data, enrichmentSources } = params;
        // 模拟数据 enrichedment
        const enriched = {
          ...data,
          enriched: true,
          sources: enrichmentSources,
          enrichmentScore: 0.95
        };
        return enriched;
      }
    },
    
    // 数据输出工具
    outputter: {
      type: 'function',
      function: {
        name: 'format_output',
        description: 'Formats data for final output',
        parameters: {
          type: 'object',
          properties: {
            data: { type: 'any' },
            format: { type: 'string', enum: ['json', 'csv', 'xml', 'html'] },
            template: { type: 'string' }
          },
          required: ['data', 'format']
        }
      },
      async execute(params: any): Promise<any> {
        const { data, format, template } = params;
        // 模拟格式化
        return {
          formatted: `Output in ${format} format: ${JSON.stringify(data, null, 2)}`,
          format,
          hasTemplate: !!template
        };
      }
    }
  };
  
  // 注册所有工具
  Object.values(tools).forEach(tool => chain.registerTool(tool));
  
  // 构建特定的处理链
  const processingChain = chain.buildToolChain([
    'validate_data',
    'transform_data', 
    'enrich_data',
    'format_output'
  ]);
  
  // 执行完整处理链
  const rawData = {
    id: 123,
    name: "John Doe",
    email: "john@example.com",
    timestamp: Date.now()
  };
  
  const processingConfig = {
    schema: { fields: ['id', 'name', 'email'] },
    rules: ['normalize_text', 'validate_email'],
    enrichmentSources: ['address_lookup', 'demographic_data']
  };
  
  const enhancedInput = {
    ...rawData,
    config: processingConfig,
    format: 'json'
  };
  
  const result = await chain.executeChain(processingChain, enhancedInput);
  
  console.log('🎯 Chain Processing Complete:');
  console.log(`Executed ${result.results.length} steps`);
  console.log('Final Result:', result.finalOutput);
  
  return result;
}
```

## 示例 2: 条件工具执行

```typescript
// 智能工具选择器
class ConditionalToolExecutor {
  private conditionRules: Array<{
    condition: (input: any) => boolean;
    tools: Tool[];
    priority: number;
  }> = [];

  // 添加条件规则
  addRule(matcher: (input: any) => boolean, tools: Tool[], priority = 0) {
    this.conditionRules.push({
      condition: matcher,
      tools,
      priority
    });
    
    // 按优先级排序
    this.conditionRules.sort((a, b) => b.priority - a.priority);
  }

  // 智能执行
  async execute(input: any): Promise<any> {
    for (const rule of this.conditionRules) {
      try {
        if (rule.condition(input)) {
          console.log(`✅ Conditions met, using ${rule.tools.length} tools`);
          
          // 并行执行符合条件的工具
          const results = await Promise.all(
            rule.tools.map(tool => this.executeSingleTool(tool, input))
          );
          
          return {
            selectedTools: rule.tools.map(t => t.function.name),
            results,
            metadata: {
              matchedCondition: true,
              executionTime: Date.now()
            }
          };
        }
      } catch (error) {
        console.log(`⚠️ Rule failed: ${error}. Trying next rule...`);
        continue;
      }
    }
    
    throw new Error('No matching conditions found for input');
  }

  private async executeSingleTool(tool: Tool, input: any): Promise<any> {
    const startTime = Date.now();
    const result = await tool.execute(input);
    
    return {
      toolName: tool.function.name,
      result,
      executionTime: Date.now() - startTime,
      inputSize: JSON.stringify(input).length
    };
  }
}

// 使用示例
async function conditionalExecutionExample() {
  const executor = new ConditionalToolExecutor();
  
  // 定义工具
  const tools = {
    // 小数据处理
    quickProcessor: {
      type: 'function',
      function: {
        name: 'quick_process',
        description: 'Fast processing for small datasets',
        parameters: {
          type: 'object',
          properties: {
            dataSize: { type: 'number' },
            complexity: { type: 'number' }
          },
          required: ['dataSize']
        }
      },
      async execute(params: any): Promise<any> {
        const { dataSize, complexity = 1 } = params;
        // 模拟快速处理
        await new Promise(resolve => setTimeout(resolve, 100));
        return { processed: true, method: 'quick', dataSize, complexity };
      }
    },
    
    // 大数据处理
    bulkProcessor: {
      type: 'function',
      function: {
        name: 'bulk_process',
        description: 'Efficient processing for large datasets',
        parameters: {
          type: 'object',
          properties: {
            dataSize: { type: 'number' },
            chunkSize: { type: 'number' }
          },
          required: ['dataSize']
        }
      },
      async execute(params: any): Promise<any> {
        const { dataSize, chunkSize = 1000 } = params;
        // 模拟批量处理
        const chunks = Math.ceil(dataSize / chunkSize);
        const data = Array(dataSize).fill(0).map((_, i) => ({ id: i }));
        
        for (let i = 0; i < chunks; i++) {
          const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
          console.log(`Processing chunk ${i + 1}/${chunks} with ${chunk.length} items`);
        }
        
        return {
          processed: true,
          method: 'bulk',
          chunksProcessed: chunks,
          totalItems: dataSize
        };
      }
    },
    
    // 复杂数据分析
    advancedAnalyzer: {
      type: 'function',
      function: {
        name: 'advanced_analysis',
        description: 'Complex analysis for complex data',
        parameters: {
          type: 'object',
          properties: {
            dataSize: { type: 'number' },
            complexity: { type: 'number' },
            analysisType: { type: 'string' }
          },
          required: ['dataSize', 'complexity']
        }
      },
      async execute(params: any): Promise<any> {
        const { dataSize, complexity, analysisType } = params;
        
        if (complexity < 5) {
          throw new Error('Complexity too low for advanced analysis');
        }
        
        // 模拟高级分析
        return {
          analysis: {
            type: analysisType,
            insights: [
              'Data distribution is normal',
              `${complexity * 10}% variance detected`,
              `${complexity / 2} major patterns found`
            ],
            confidence: Math.min(complexity * 20, 95),
            processingTime: complexity * 100
          },
          metadata: { tool: 'advanced_analyzer', complexity, dataSize }
        };
      }
    }
  };
  
  // 添加条件规则
  executor.addRule(
    (input) => input.dataSize <= 1000 && input.complexity <= 3,
    [tools.quickProcessor],
    1
  );
  
  executor.addRule(
    (input) => input.dataSize > 1000 && input.dataSize <= 10000,
    [tools.bulkProcessor],
    2
  );
  
  executor.addRule(
    (input: any) => input.complexity > 5 && input.analysisType !== 'basic',
    [tools.advancedAnalyzer],
    3
  );
  
  // 测试各种场景
  const testCases = [
    {
      scenario: 'Small simple data',
      input: { dataSize: 500, complexity: 2 }
    },
    {
      scenario: 'Medium bulk data',
      input: { dataSize: 5000, complexity: 2, chunkSize: 500 }
    },
    {
      scenario: 'Complex analysis',
      input: { dataSize: 2000, complexity: 7, analysisType: 'pattern_recognition' }
    }
  ];
  
  for (const { scenario, input } of testCases) {
    console.log(`\n🧪 Testing: ${scenario}`);
    console.log(`Input:`, input);
    
    try {
      const result = await executor.execute(input);
      console.log('✅ Success:', result);
    } catch (error) {
      console.log('❌ Failed:', error instanceof Error ? error.message : String(error));
    }
  }
}
```

## 示例 3: 工具性能和缓存系统

```typescript
// 智能缓存工具代理
class CachedToolProxy implements Tool {
  private tool: Tool;
  private cache: Map<string, { result: any; timestamp: number }> = new Map();
  private readonly cacheTTL = 5 * 60 * 1000; // 5分钟
  private hitCount = 0;
  private missCount = 0;

  constructor(tool: Tool, private cacheStrategy: 'memory' | 'file' | 'redis' = 'memory') {
    this.tool = tool;
  }

  // 获取缓存键
  private getCacheKey(params: any): string {
    return JSON.stringify(params);
  }

  // 检查缓存
  private getCachedResult(key: string): any | null {
    if (!this.cache.has(key)) {
      this.missCount++;
      return null;
    }

    const cached = this.cache.get(key)!;
    // 检查TTL
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    this.hitCount++;
    return cached.result;
  }

  // 设置缓存
  private setCacheResult(key: string, result: any): void {
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  // 工具性能监控
  private performanceMetrics: any[] = [];

  async execute(params: any): Promise<any> {
    const cacheKey = this.getCacheKey(params);
    
    // 先检查缓存
    const cached = this.getCachedResult(cacheKey);
    if (cached !== null) {
      console.log(`💾 Cache HIT for ${this.tool.function.name}`);
      return { ...cached, cached: true };
    }

    const startTime = Date.now();
    console.log(`⚡ Executing ${this.tool.function.name}`);

    try {
      const result = await this.tool.execute(params);
      const executionTime = Date.now() - startTime;

      // 记录性能指标
      this.performanceMetrics.push({
        tool: this.tool.function.name,
        executionTime,
        cacheHit: false,
        timestamp: Date.now(),
        inputSize: JSON.stringify(params).length,
        outputSize: JSON.stringify(result).length
      });

      // 缓存结果
      this.setCacheResult(cacheKey, result);

      return { ...result, cached: false, executionTime };
    } catch (error) {
      // 即使失败也记录性能指标
      this.performanceMetrics.push({
        tool: this.tool.function.name,
        executionTime: Date.now() - startTime,
        error: true,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      
      throw error;
    }
  }

  // 获取性能报告
  getPerformanceReport(): any {
    const metrics = this.performanceMetrics;
    const successful = metrics.filter(m => !m.error);
    
    return {
      toolName: this.tool.function.name,
      totalExecutions: metrics.length,
      cacheHits: this.hitCount,
      cacheMisses: this.missCount,
      cacheHitRatio: this.hitCount / (this.hitCount + this.missCount) || 0,
      avgExecutionTime: successful.length > 0 
        ? successful.reduce((sum, m) => sum + m.executionTime, 0) / successful.length
        : 0,
      errorCount: metrics.filter(m => m.error).length,
      performanceSummary: {
        slowestExecution: Math.max(...successful.map(m => m.executionTime)),
        fastestExecution: Math.min(...successful.map(m => m.executionTime))
      }
    };
  }

  // 清理缓存
  clearCache(): void {
    this.cache.clear();
    console.log(`🗑️ Cache cleared for ${this.tool.function.name}`);
  }
}

// 使用示例
async function cachedToolExample() {
  // 创建一个模拟的昂贵操作工具
  const slowTool: Tool = {
    type: 'function',
    function: {
      name: 'expensive_calculations',
      description: 'Performs expensive numerical computations',
      parameters: {
        type: 'object',
        properties: {
          problem: { type: 'string' },
          iterations: { type: 'number' },
          precision: { type: 'number' }
        },
        required: ['problem']
      }
    },
    async execute(params: any): Promise<any> {
      const { problem, iterations = 1000, precision = 2 } = params;
      
      // 模拟昂贵的计算
      console.log(`🧮 Starting expensive calculation: ${problem}`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // 模拟2秒计算
      
      const result = Math.random() * iterations * precision;
      return {
        problem,
        result: parseFloat(result.toFixed(precision)),
        computationDetails: {
          iterations,
          precision,
          complexity: 'high',
          estimatedTime: '2-3 seconds'
        }
      };
    }
  };

  // 创建缓存包装器
  const cachedTool = new CachedToolProxy(slowTool, 'memory');

  const agent = createAgent({
    model,
    tools: [cachedTool],
    maxIterations: 3
  });

  // 第一次执行（应该较慢，无缓存）
  const start1 = Date.now();
  const result1 = await agent.run('Calculate fibonacci(20) with high precision');
  const time1 = Date.now() - start1;

  console.log(`\n⏱️ First execution took: ${time1}ms`);
  console.log('Result:', result1);

  // 第二次执行相同任务（应该很快，有缓存）
  const start2 = Date.now();
  const result2 = await agent.run('Calculate fibonacci(20) with high precision');
  const time2 = Date.now() - start2;

  console.log(`\n💫 Second execution took: ${time2}ms (should be much faster)`);
  console.log('Cached result:', result2);

  // 第三次执行类似但不同的任务
  const start3 = Date.now();
  const result3 = await agent.run('Calculate fibonacci(25) with medium precision');
  const time3 = Date.now() - start3;

  console.log(`\n🆕 Different task took: ${time3}ms`);
  console.log('New result:', result3);

  // 性能报告
  console.log('\n📊 Performance Report:');
  const report = cachedTool.getPerformanceReport();
  console.log(JSON.stringify(report, null, 2));
}
```

这些高级工具管理示例展示了如何构建灵活、强大和高效的工具系统，充分利用 Pocket Agent 的扩展性和性能优化特性。
