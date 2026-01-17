import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { Message, ModelInterface, AgentHooks, Plugin, Tool } from '../index';

export interface LongContextPluginConfig {
  maxTokens?: number;
  activeBufferTokens?: number;
  summaryThreshold?: number;
  storageDir?: string;
  conversationId?: string;
  model?: ModelInterface; // Required for summary generation
  tokenCounter?: (text: string) => number;
}

interface StoredState {
  summary: string;
  recentMessages: Message[];
}

class SimpleMessageStore {
  constructor(private storageDir: string) {}

  private getFilePath(conversationId: string, type: 'history' | 'state'): string {
    const dir = join(this.storageDir, 'conversations', conversationId);
    return join(dir, `${type}.json`);
  }

  async appendHistory(conversationId: string, messages: Message[]): Promise<void> {
    const filePath = this.getFilePath(conversationId, 'history');
    await fs.mkdir(dirname(filePath), { recursive: true });
    
    let history: Message[] = [];
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      history = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid, start new
    }

    history.push(...messages);
    await fs.writeFile(filePath, JSON.stringify(history, null, 2));
  }

  async saveState(conversationId: string, state: StoredState): Promise<void> {
    const filePath = this.getFilePath(conversationId, 'state');
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2));
  }

  async loadState(conversationId: string): Promise<StoredState | null> {
    try {
      const filePath = this.getFilePath(conversationId, 'state');
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async searchHistory(conversationId: string, query: string): Promise<Message[]> {
    try {
      const filePath = this.getFilePath(conversationId, 'history');
      const content = await fs.readFile(filePath, 'utf-8');
      const history: Message[] = JSON.parse(content);
      
      const queryLower = query.toLowerCase();
      return history
        .filter(msg => msg.content && msg.content.toLowerCase().includes(queryLower));
    } catch {
      return [];
    }
  }
}

function calculateTotalTokens(messages: Message[], tokenCounter: (text: string) => number): number {
  return messages.reduce((sum, msg) => sum + tokenCounter(msg.content), 0);
}

async function generateSummary(messages: Message[], model?: ModelInterface): Promise<string> {
  if (!model) return "Summarized messages";
  
  const summaryPrompt = `Summarize the following conversation concisely. Capture key details, decisions, and context that should be preserved:\n\n${messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}\n\nSummary:`;
  
  const response = await model.chat([
    { role: "system", content: "You are a helpful assistant that summarizes conversations." },
    { role: "user", content: summaryPrompt }
  ]);
  
  return (response.content || "").trim();
}

function mergeSummaries(oldSummary: string, newSummary: string): string {
  if (!oldSummary) return newSummary;
  if (!newSummary) return oldSummary;
  return `Prior Context: ${oldSummary}\n\nRecent Developments: ${newSummary}`;
}

export function createLongContextPlugin(config: LongContextPluginConfig = {}): Plugin {
  const maxTokens = config.maxTokens || 8000; // Limit for safe keeping
  const activeBufferTokens = config.activeBufferTokens || 4000; // Keep this many tokens in active memory
  const summaryThreshold = config.summaryThreshold || 6000; // Trigger summary when context hits this
  const tokenCounter = config.tokenCounter || ((text) => Math.ceil(text.length / 4));
  const storageDir = config.storageDir || './storage';
  
  let summaryBuffer = "";
  const store = new SimpleMessageStore(storageDir);

  const recallTool: Tool = {
    type: 'function',
    function: {
        name: 'recall_memory',
        description: 'Search through the full conversation history for specific details that might have been summarized. Use this when you need to recall code snippets, specific instructions, or details from earlier in the conversation that are not in your current context.',
        parameters: { 
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The keyword or phrase to search for in past messages' 
                }
            },
            required: ['query']
        }
    },
    execute: async ({ query }: { query: string }) => {
      if (!config.conversationId) return "No conversation ID configured, cannot search history.";
      const results = await store.searchHistory(config.conversationId, query);
      if (results.length === 0) return "No matching messages found in history.";

      // Safety Guard: Prevent context explosion
      const TOTAL_CHAR_LIMIT = 12000; // ~3k tokens
      const SINGLE_MSG_LIMIT = 3000;  // ~750 tokens

      console.log(`\x1b[36m[LongContext] Recalling memory for query: "${query}"...\x1b[0m`);

      let output = `Found ${results.length} matches in history:\n`;
      let currentLength = output.length;
      let truncated = false;

      for (const msg of results) {
        let content = msg.content || '';
        if (content.length > SINGLE_MSG_LIMIT) {
          content = content.slice(0, SINGLE_MSG_LIMIT) + `\n... [Content Truncated, original length: ${msg.content.length} chars]`;
        }
        
        const entry = `\n---\n[${msg.role}]: ${content}`;
        
        if (currentLength + entry.length > TOTAL_CHAR_LIMIT) {
          truncated = true;
          break;
        }
        
        output += entry;
        currentLength += entry.length;
      }

      if (truncated) {
        output += `\n\n[System Warning]: Output truncated because it exceeds the size limit. Please refine your query "${query}" to be more specific (e.g., add date, file name, or more keywords).`;
      }

      return output;
    }
  };
  
  return {
    name: 'longContext',
    tools: [recallTool],
    hooks: {
      async beforeRun({ task, messages }, context) {
        if (!config.conversationId) return { task, messages };

        const state = await store.loadState(config.conversationId);
        
        let newMessages: Message[] = [messages[0]]; // Always keep the Agent's original System Prompt first
        
        // 1. Load History Candidates
        const historyCandidates: Message[] = [];
        if (state) {
          if (state.summary) {
            summaryBuffer = state.summary;
            historyCandidates.push({ 
              role: 'system', 
              content: `PREVIOUS CONVERSATION SUMMARY:\n${state.summary}` 
            });
          }
          if (state.recentMessages && state.recentMessages.length > 0) {
            historyCandidates.push(...state.recentMessages);
          }
        }

        // 2. Identify User Input (Assume last message)
        let userInput = messages.length > 1 ? messages[messages.length - 1] : null;

        // 3. Smart Context Assembly (Token Management)
        const systemTokens = tokenCounter(messages[0].content);
        let currentTokens = systemTokens;
        
        // Reserve space for User Input?
        // Let's iterate backwards from [User Input, ...History Candidates]
        // But we MUST keep System Prompt.
        
        const finalMessages: Message[] = [messages[0]];
        
        let pendingMessages: Message[] = [...historyCandidates];
        if (userInput) {
            pendingMessages.push(userInput);
        }
        
        // Strategy: 
        // 1. Calculate tokens for User Input. If > available, truncate User Input.
        // 2. Fill remaining space with History (newest to oldest).
        
        const availableTokens = activeBufferTokens - systemTokens;
        
        if (userInput) {
             const inputTokens = tokenCounter(userInput.content);
             
             if (inputTokens > availableTokens) {
                 // CASE: User Input is HUGE.
                 // Action: Clear history from context, and Truncate User Input.
                 
                 // Save full input to history archive first
                 await store.appendHistory(config.conversationId, [userInput]);
                 
                 const keepChars = (availableTokens - 200) * 3; // Estimate simplified
                 const truncatedContent = userInput.content.slice(0, keepChars) + 
                    `\n... [SYSTEM WARNING: This input was too long (${inputTokens} tokens) and has been truncated to fit the context window. The full content has been archived to history.]`;
                    
                 finalMessages.push({
                     role: userInput.role,
                     content: truncatedContent
                 });
                 // No history candidates added
             } else {
                 // CASE: User Input fits. Check how much history fits.
                 let historyBudget = availableTokens - inputTokens;
                 
                 // PRIORITY: Summary (if exists)
                 // historyCandidates[0] IS the Summary if it exists.
                 // We should try to lock it in first.
                 
                 let summaryMessage: Message | null = null;
                 let recentMessagesCandidates: Message[] = [...historyCandidates];
                 
                 if (state?.summary && historyCandidates.length > 0 && historyCandidates[0].role === 'system') {
                     // Extract Summary
                     summaryMessage = historyCandidates[0];
                     recentMessagesCandidates = historyCandidates.slice(1);
                 }
                 
                 if (summaryMessage) {
                     const summaryTokens = tokenCounter(summaryMessage.content);
                     if (summaryTokens <= historyBudget) {
                         // Summary fits!
                         historyBudget -= summaryTokens;
                     } else {
                         // Summary doesn't fit? This is dire. 
                         // We skip Summary to save space? Or we truncate Summary?
                         // Agent relies on Summary. Let's force it but it might eat into User Input space (which we already validated fits).
                         // Actually, if Summary > historyBudget, it means Summary + User > activeBuffer.
                         // We must drop Summary if we want to honor strict token limits.
                         summaryMessage = null;
                     }
                 }
                 
                 const fittingHistory: Message[] = [];
                 let usedHistoryTokens = 0;
                 
                 // Reverse iteration for Recent Messages
                 const reverseCandidates = [...recentMessagesCandidates].reverse();
                 
                 for (const msg of reverseCandidates) {
                     const t = tokenCounter(msg.content);
                     if (usedHistoryTokens + t <= historyBudget) {
                         fittingHistory.unshift(msg);
                         usedHistoryTokens += t;
                     } else {
                         // Message state: Dropped due to context limit
                     }
                 }
                 
                 if (summaryMessage) {
                     finalMessages.push(summaryMessage);
                 }
                 finalMessages.push(...fittingHistory);
                 finalMessages.push(userInput);
             }
        } else {
            // No user input? Just standard history fill
             finalMessages.push(...historyCandidates);
        }
        
        return { task, messages: finalMessages };
      },
      
      async afterIteration({ iteration, messages, response, thoughts }, context) {
        let updatedMessages = [...messages];
        const totalTokens = calculateTotalTokens(updatedMessages, tokenCounter);
        
        if (totalTokens > summaryThreshold) {
          // Identify messages to keep (newest) vs summarize (oldest)
          // Always keep index 0 (System Prompt) and potentially index 1 (Summary if exists)
          // We only summarize "content" messages from the middle.
          
          let startIndex = 1;
          if (updatedMessages[1]?.role === 'system' && updatedMessages[1].content.startsWith('PREVIOUS CONVERSATION SUMMARY')) {
            startIndex = 2;
          }

          const candidates = updatedMessages.slice(startIndex);
          // We iterate from newest to oldest to collect "toKeep" until buffer is full
          const candidatesReverse = [...candidates].reverse();
          
          let currentTokens = 0;
          const toKeep: Message[] = [];
          const toSummarize: Message[] = [];
          
          for (const msg of candidatesReverse) {
             const t = tokenCounter(msg.content);
             if (currentTokens + t <= activeBufferTokens) {
               toKeep.unshift(msg);
               currentTokens += t;
             } else {
               toSummarize.unshift(msg);
             }
          }

          if (toSummarize.length > 0) {
            console.log(`\x1b[33m[LongContext] Creating summary for ${toSummarize.length} old messages...\x1b[0m`);
            const newSummary = await generateSummary(toSummarize, config.model);
            summaryBuffer = mergeSummaries(summaryBuffer, newSummary);
            
             if (config.conversationId) {
               await store.appendHistory(config.conversationId, toSummarize);
             }

            // Reconstruct messages
            updatedMessages = [
              updatedMessages[0],
              { role: 'system', content: `PREVIOUS CONVERSATION SUMMARY:\n${summaryBuffer}` },
              ...toKeep
            ];
          }
        }
        
        return { iteration, messages: updatedMessages, response, thoughts };
      },
      
      async afterRun({ task, messages, result }, context) {
        if (config.conversationId) {
          // Add the final result as an assistant message to the state
          const fullMessages = [...messages];
          const lastMsg = fullMessages[fullMessages.length - 1];
          if (lastMsg.role !== 'assistant' || lastMsg.content !== result) {
             fullMessages.push({ role: 'assistant', content: result });
          }

          // Filter out System Prompts and Summary to get "Recent Messages"
          const recentMessages = fullMessages.filter((msg, index) => {
             if (index === 0 && msg.role === 'system') return false; // Main System Prompt
             if (msg.role === 'system' && msg.content.startsWith('PREVIOUS CONVERSATION SUMMARY')) return false; // Summary
             return true; 
          });

          await store.saveState(config.conversationId, {
            summary: summaryBuffer,
            recentMessages: recentMessages
          });
        }
        return { task, messages, result };
      }
    }
  };
}
