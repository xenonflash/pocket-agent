import { promises as fs } from 'fs';
import { join } from 'path';
import type { Message, ModelInterface, AgentHooks, HookContext } from '../index';

export interface LongContextPluginConfig {
  maxTokens?: number;
  activeBufferTokens?: number;
  summaryThreshold?: number;
  storageDir?: string;
  conversationId?: string;
  model?: ModelInterface;
  tokenCounter?: (text: string) => number;
}

interface MessageEntry {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokens: number;
  timestamp: number;
  summarized?: boolean;
}

interface MessageIndex {
  conversationId: string;
  messages: MessageEntry[];
  summary?: string;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
}

class FileMessageStore {
  constructor(private storageDir: string) {}

  private getFilePath(conversationId: string, type: 'messages' | 'summary' | 'index'): string {
    const dir = join(this.storageDir, 'conversations', conversationId);
    return join(dir, `${type}.json`);
  }

  async saveSummary(conversationId: string, summary: string): Promise<void> {
    const filePath = this.getFilePath(conversationId, 'summary');
    await fs.mkdir(join(filePath, '..'), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(summary, null, 2));
  }

  async loadSummary(conversationId: string): Promise<string | null> {
    try {
      const filePath = this.getFilePath(conversationId, 'summary');
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async saveIndex(conversationId: string, index: MessageIndex): Promise<void> {
    const filePath = this.getFilePath(conversationId, 'index');
    await fs.mkdir(join(filePath, '..'), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(index, null, 2));
  }

  async loadIndex(conversationId: string): Promise<MessageIndex | null> {
    try {
      const filePath = this.getFilePath(conversationId, 'index');
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async saveMessages(conversationId: string, messages: MessageEntry[]): Promise<void> {
    const filePath = this.getFilePath(conversationId, 'messages');
    await fs.mkdir(join(filePath, '..'), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(messages, null, 2));
  }

  async loadMessages(conversationId: string): Promise<MessageEntry[]> {
    try {
      const filePath = this.getFilePath(conversationId, 'messages');
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function calculateTotalTokens(messages: Message[], tokenCounter: (text: string) => number): number {
  return messages.reduce((sum, msg) => sum + tokenCounter(msg.content), 0);
}

async function generateSummary(messages: Message[], model?: ModelInterface): Promise<string> {
  if (!model) return "Summarized messages";
  
  const summaryPrompt = `Summarize the following conversation concisely:\n\n${messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}\n\nSummary:`;
  
  const response = await model.chat([
    { role: "system", content: "You are a helpful assistant that summarizes conversations." },
    { role: "user", content: summaryPrompt }
  ]);
  
  return response.trim();
}

function splitMessages(messages: Message[], activeBufferTokens: number, tokenCounter: (text: string) => number): { toSummarize: Message[]; toKeep: Message[] } {
  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  
  let currentTokens = 0;
  const toKeep: Message[] = [...systemMessages];
  const toSummarize: Message[] = [];
  
  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    const msg = nonSystemMessages[i];
    const tokens = tokenCounter(msg.content);
    
    if (currentTokens + tokens <= activeBufferTokens) {
      toKeep.unshift(msg);
      currentTokens += tokens;
    } else {
      toSummarize.unshift(msg);
    }
  }
  
  return { toSummarize, toKeep };
}

function mergeSummaries(oldSummary: string, newSummary: string): string {
  if (!oldSummary) return newSummary;
  if (!newSummary) return oldSummary;
  return `Previous context: ${oldSummary}\n\nRecent: ${newSummary}`;
}

export function createLongContextPlugin(config: LongContextPluginConfig = {}): { name: string; hooks: AgentHooks } {
  const maxTokens = config.maxTokens || 8000;
  const activeBufferTokens = config.activeBufferTokens || 4000;
  const summaryThreshold = config.summaryThreshold || 6000;
  const tokenCounter = config.tokenCounter || ((text) => Math.ceil(text.length / 4));
  const storageDir = config.storageDir || './storage';
  
  let summaryBuffer = "";
  const messageStore = new FileMessageStore(storageDir);
  
  return {
    name: 'longContext',
    hooks: {
      async beforeRun({ task, messages }, context) {
        const updatedMessages = [...messages];
        if (config.conversationId) {
          const savedSummary = await messageStore.loadSummary(config.conversationId);
          if (savedSummary) {
            summaryBuffer = savedSummary;
            updatedMessages.splice(1, 0, { role: 'system', content: savedSummary });
          }
        }
        return { task, messages: updatedMessages };
      },
      
      async afterIteration({ iteration, messages, response, thoughts }, context) {
        const updatedMessages = [...messages];
        const totalTokens = calculateTotalTokens(updatedMessages, tokenCounter);
        
        if (totalTokens > summaryThreshold) {
          const { toSummarize, toKeep } = splitMessages(updatedMessages, activeBufferTokens, tokenCounter);
          
          if (toSummarize.length > 0) {
            const newSummary = await generateSummary(toSummarize, config.model);
            summaryBuffer = mergeSummaries(summaryBuffer, newSummary);
            
            if (config.conversationId) {
              const entries: MessageEntry[] = toSummarize.map((msg) => ({
                id: generateId(),
                role: msg.role,
                content: msg.content,
                tokens: tokenCounter(msg.content),
                timestamp: Date.now(),
                summarized: true
              }));
              
              await messageStore.saveMessages(config.conversationId, entries);
              await messageStore.saveSummary(config.conversationId, summaryBuffer);
            }
            
            updatedMessages.splice(0, updatedMessages.length,
              updatedMessages[0],
              { role: 'system', content: summaryBuffer },
              ...toKeep
            );
          }
        }
        
        return { iteration, messages: updatedMessages, response, thoughts };
      },
      
      async afterRun({ task, messages, result }, context) {
        if (config.conversationId) {
          await messageStore.saveSummary(config.conversationId, summaryBuffer);
        }
        return { task, messages, result };
      }
    }
  };
}
