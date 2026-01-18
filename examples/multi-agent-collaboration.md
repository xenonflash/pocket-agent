# Multi-Agent Collaboration Examples

## 概述

Pocket Agent 支持创建多个专门化的代理，并将它们组合成强大的协作系统。每个代理都有特定的职责和工具集，可以处理复杂的多步骤任务。

## 示例 1: 研究 + 分析 + 报告生成

```typescript
import { createAgent, Model, Tool, Context } from 'pocket-agent';
import { createLoggingPlugin } from 'pocket-agent/plugins';

interface ResearchAgent extends Tool {
  runQuery(query: string): Promise<string>;
}

interface DataAnalysisAgent extends Tool {
  analyzeData(data: string): Promise<any>;
}

interface ReportGeneratorAgent extends Tool {
  generateReport(data: any, research: string): Promise<string>;
}

// 创建研究代理
const researchAgent = createAgent({
  name: 'research_agent',
  description: 'Performs web research and information gathering',
  model: model,
  tools: [searchTool, wikipediaTool],
  maxIterations: 5,
  hooks: [createLoggingPlugin({ logLevel: 'info' })]
});

// 创建数据分析代理
const dataAnalysisAgent = createAgent({
  name: 'data_analysis_agent', 
  description: 'Performs statistical analysis and data processing',
  model: model,
  tools: [statisticsTool, chartGeneratorTool],
  maxIterations: 3
});

// 创建报告生成代理
const reportGeneratorAgent = createAgent({
  name: 'report_generator_agent',
  description: 'Generates comprehensive reports and documentation',
  model: model,
  tools: [formatterTool, htmlExporterTool],
  maxIterations: 3
});

// 主代理 - 协调所有子代理
const mainAgent = createAgent({
  name: 'project_manager',
  description: 'Coordinates research, analysis, and reporting workflow',
  model: model,
  tools: [researchAgent, dataAnalysisAgent, reportGeneratorAgent],
  humanInLoop: async (tool, input) => {
    console.log(`\n🔧 Deploying ${tool} with input:`, input);
    const confirm = await inquirer.input(`Approve ${tool} execution? (y/n): `);
    return confirm.toLowerCase() === 'y';
  }
});

// 执行复杂任务
async function complexResearchProject() {
  const task = `
    Research the current state of AI in healthcare, 
    analyze trends in the data, 
    and generate a comprehensive report with recommendations.
  `;

  const result = await mainAgent.run(task);
  
  console.log('\n📊 Project Result Summary:');
  console.log(result);
  
  // 获取所有子代理的工作历史
  const researchHistory = mainAgent.getContext().getSubAgentMessages('research_agent');
  const analysisHistory = mainAgent.getContext().getSubAgentMessages('data_analysis_agent');
  const reportHistory = mainAgent.getContext().getSubAgentMessages('report_generator_agent');
  
  console.log('\n🔍 Work History:');
  console.log(`Research steps: ${researchHistory.length}`);
  console.log(`Analysis steps: ${analysisHistory.length}`);
  console.log(`Report sections: ${reportHistory.length}`);
}
```

## 示例 2: 连续任务流水线

```typescript
// 创建专门的工具链代理
class TaskPipeline {
  private agents: Record<string, Agent> = {};
  private context = new Context();

  // 数据预处理代理
  preprocessingAgent = createAgent({
    name: 'data_preprocessor',
    description: 'Cleans and preprocesses raw data',
    model: this.model,
    tools: [dataCleaner, formatConverter, validator],
    context: this.context
  });

  // 模型训练代理
  trainingAgent = createAgent({
    name: 'ml_trainer', 
    description: 'Trains machine learning models',
    model: this.model,
    tools: [modelTrainer, dataSplitter, hyperparameterTuner],
    context: this.context
  });

  // 结果评估代理
  evaluationAgent = createAgent({
    name: 'model_evaluator',
    description: 'Evaluates model performance and generates insights',
    model: this.model,
    tools: [metricsCalculator, visualization, reportGenerator],
    context: this.context
  });

  // 执行完整流水线
  async runPipeline(dataset: string, config: any) {
    console.log('🚀 Starting ML Pipeline...');
    
    // 第1阶段：数据预处理
    const preprocessedData = await this.preprocessingAgent.run(
      `Preprocess the dataset: ${dataset} using configuration: ${JSON.stringify(config)}`
    );
    
    console.log('✅ Data Preprocessing Complete');
    
    // 第2阶段：模型训练
    const trainingResults = await this.trainingAgent.run(
      `Train ML model using preprocessed data. Configuration: ${config}`
    );
    
    console.log('✅ Model Training Complete');
    
    // 第3阶段：模型评估
    const evaluationResults = await this.evaluationAgent.run(
      `Evaluate the trained model and generate comprehensive insights`
    );
    
    console.log('✅ Model Evaluation Complete');
    
    return {
      preprocessedData,
      trainingResults, 
      evaluationResults,
      fullContext: this.context.getAllSubAgentMessages()
    };
  }
}

// 使用示例
const pipeline = new TaskPipeline(model);
const results = await pipeline.runPipeline("customer_data.csv", {
  algorithm: "random_forest",
  testSize: 0.2,
  randomState: 42
});
```

## 示例 3: 并行协作代理

```typescript
interface ParallelTeamCoordinator extends Tool {
  deployTeam(tasks: string[]): Promise<string[]>;
}

async function parallelTeamExample() {
  // 创建多个专业代理
  const agents = {
    researcher: createAgent({
      name: 'web_researcher',
      model: model,
      tools: [search, scraper, aggregator],
      maxIterations: 3
    }),
    analyst: createAgent({
      name: 'data_analyst', 
      model: model,
      tools: [dataProcessor, statisticsTool, chartTool],
      maxIterations: 2
    }),
    writer: createAgent({
      name: 'content_writer',
      model: model, 
      tools: [textProcessor, formatter, spellChecker],
      maxIterations: 2
    }),
    reviewer: createAgent({
      name: 'quality_reviewer',
      model: model,
      tools: [grammarChecker, plagiarismChecker, factChecker],
      maxIterations: 2
    })
  };

  // 协调员代理使用所有其他代理
  const coordinator = createAgent({
    name: 'parallel_coordinator',
    description: 'Manages parallel workflow and quality control',
    model: model,
    tools: Object.values(agents),
    hooks: [createLoggingPlugin()],
    humanInLoop: async (tool, input) => {
      console.log(`\n⚡ Parallel task: ${tool}`);
      console.log(`Input size: ${JSON.stringify(input).length} characters`);
      const confirm = await promptUser('Execute parallel task? (y/n): ');
      return confirm === 'y';
    }
  });

  // 执行并行内容创建项目
  const contentProject = await coordinator.run(`
    Create comprehensive market analysis report:
    1. Research market trends for AI in 2024
    2. Analyze competitive landscape 
    3. Write executive summary
    4. Review for accuracy and quality
    Coordinate tasks to maximize efficiency through parallel processing.
  `);

  // 检查协调效果
  const context = coordinator.getContext();
  console.log('📋 Collaboration Summary:');
  console.log(`Total interactions: ${context.getMessages().length}`);
  console.log(`Research agent work: ${context.getSubAgentMessages('web_researcher').length} steps`);
  console.log(`Analysis work: ${context.getSubAgentMessages('data_analyst').length} steps`);
  console.log(`Writing work: ${context.getSubAgentMessages('content_writer').length} steps`);
  console.log(`Quality work: ${context.getSubAgentMessages('quality_reviewer').length} steps`);
}
```

## 最佳实践

### 1. 代理命名规范
- 使用描述性的名字（如 `data_preprocessor` 而不是 `agent1`）
- 包含功能描述（如 `ml_trainer`, `content_reviewer`）
- 保持命名一致性（ kebab-case 或 camelCase）

### 2. 工具分配策略
- 每个代理专注于相关的一组工具
- 避免工具重复，除非必要
- 考虑代理之间的数据传递需求

### 3. 错误处理
```typescript
const resilient = createAgent({
  // ... config
  humanInLoop: async (tool, input) => {
    try {
      return await confirmExecution(tool, input);
    } catch (error) {
      console.error('Human-in-loop error:', error);
      return false; // Fail safely
    }
  }
});
```

### 4. 上下文管理
```typescript
const sharedContext = new Context();

// 所有代理共享同一上下文
agents.forEach(agent => {
  agent.setContext(sharedContext);
});

// 定期清理和优化
sharedContext.reset();
```

这些示例展示了如何构建复杂的多代理协作系统，充分利用 Pocket Agent 的模块化和可扩展特性。
