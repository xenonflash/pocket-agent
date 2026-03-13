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

interface TimelineEvent {
  id: string; // e.g., "evt_12345"
  timestamp: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string; // Lossless full text
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[]; // Keep tool calls for assistant role to avoid OpenAI 400 errors
  is_pinned?: boolean; // Protects this event from LOD squashing (Core Memory)
}

interface TimelineBlock {
  block_id: string; // e.g., "blk_67890"
  start_event_id: string;
  end_event_id: string;
  lod1_summary: string;
}

interface StoredContext {
  events: TimelineEvent[];
  blocks: TimelineBlock[];
}

class TimelineStore {
  constructor(private storageDir: string) {}

  private getFilePath(conversationId: string): string {
    return join(this.storageDir, 'conversations', conversationId, 'timeline.json');
  }

  async loadContext(conversationId: string): Promise<StoredContext> {
    try {
      const filePath = this.getFilePath(conversationId);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { events: [], blocks: [] };
    }
  }

  async saveContext(conversationId: string, context: StoredContext): Promise<void> {
    const filePath = this.getFilePath(conversationId);
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(context, null, 2));
  }

  async appendEvents(conversationId: string, newEvents: TimelineEvent[]): Promise<void> {
    const context = await this.loadContext(conversationId);
    context.events.push(...newEvents);
    await this.saveContext(conversationId, context);
  }

  async addBlock(conversationId: string, block: TimelineBlock): Promise<void> {
     const context = await this.loadContext(conversationId);
     context.blocks.push(block);
     await this.saveContext(conversationId, context);
  }
}

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
}

function calculateTotalTokens(messages: Message[], tokenCounter: (text: string) => number): number {
  return messages.reduce((sum, msg) => sum + tokenCounter(msg.content || ""), 0);
}

async function generateSummary(messages: Message[], model?: ModelInterface): Promise<string> {
  if (!model) return "Summarized messages";
  
  const summaryPrompt = `Summarize the following conversation segment concisely. Focus on intent, key decisions, and artifacts created:\n\n${messages.map(m => `[${m.role}]: ${m.content || ""}`).join('\n\n')}\n\nSummary:`;
  
  const response = await model.chat([
    { role: "system", content: "You are a helpful assistant that summarizes conversations." },
    { role: "user", content: summaryPrompt }
  ]);
  
  return (response.content || "").trim();
}

export function createLongContextPlugin(config: LongContextPluginConfig = {}): Plugin {
  const maxTokens = config.maxTokens || 8000;
  const activeBufferTokens = config.activeBufferTokens || 4000;
  const summaryThreshold = config.summaryThreshold || 6000;
  const tokenCounter = config.tokenCounter || ((text) => Math.ceil(text.length / 4));
  const storageDir = config.storageDir || './storage';
  
  const store = new TimelineStore(storageDir);

  // In-memory tracking for hook state
  let lastKnownLength = 0;
  let activeTailEvents: TimelineEvent[] = [];
  let currentBlocks: TimelineBlock[] = [];
  
  const zoomTool: Tool = {
    type: 'function',
    function: {
        name: 'zoom_in_timeline',
        description: 'Read the raw, uncompressed content of a historic Timeline Block using its block_id. 🎯 WHEN TO USE: 1. If the user asks about past details that are missing from the current active context. 2. If you see a summary in the TIMELINE RULER that contains information necessary for your current task. Note: You do NOT need to "zoom out"—the memory system will automatically collapse older events to save space.',
        parameters: { 
            type: 'object',
            properties: {
                block_id: { type: 'string' }
            },
            required: ['block_id']
        }
    },
    execute: async ({ block_id }: { block_id: string }) => {
      if (!config.conversationId) return "No conversation ID configured.";
      const context = await store.loadContext(config.conversationId);
      const block = context.blocks.find(b => b.block_id === block_id);
      if (!block) return `Block ${block_id} not found.`;

      let inBlock = false;
      const blockEvents: TimelineEvent[] = [];
      for (const ev of context.events) {
         if (ev.id === block.start_event_id) inBlock = true;
         if (inBlock) blockEvents.push(ev);
         if (ev.id === block.end_event_id) break;
      }
      
      let output = `[Zoomed In: ${block_id}]\n`;
      let currentTokens = 0;
      for (const ev of blockEvents) {
         const entry = `[${ev.role} Turn]:\n${ev.content}\n\n`;
         // Constraint 3 protection inside zoom tool
         if (currentTokens + tokenCounter(entry) > 3000) {
             output += `\n... [Truncated. Too many raw events to fit in zoom window.]`;
             break;
         }
         output += entry;
         currentTokens += tokenCounter(entry);
      }
      return output;
    }
  };

  const pinTool: Tool = {
    type: 'function',
    function: {
        name: 'pin_important_fact',
        description: 'Pin a crucial piece of information into Core Memory. 🎯 WHEN TO USE: 1. When the user explicitly provides a core rule, a password, an important configuration, or a user preference. 2. This creates a permanent Keyframe (LOD 0) that will NEVER be squashed or forgotten by the timeline system. Do not overuse this for trivial conversation.',
        parameters: {
            type: 'object',
            properties: {
                fact: { type: 'string', description: 'The specific fact or rule to remember verbatim.' }
            },
            required: ['fact']
        }
    },
    execute: async ({ fact }: { fact: string }) => {
       if (!config.conversationId) return "No conversation ID configured.";
       const eventId = generateId('evt_pin');
       const pinEvt: TimelineEvent = {
           id: eventId,
           timestamp: Date.now(),
           role: 'system', // Treated as system anchor
           content: `[CORE MEMORY PINNED FACT]:\n${fact}`,
           is_pinned: true
       };
       await store.appendEvents(config.conversationId, [pinEvt]);
       activeTailEvents.push(pinEvt);
       return `Fact pinned successfully. It is now permanently anchored in your Core Memory at LOD 0.`;
    }
  };

  function renderRuler(blocks: TimelineBlock[]): Message {
     if (blocks.length === 0) return { role: 'system', content: 'TIMELINE RULER: No past history.' };
     let content = '=== ⏳ TIMELINE RULER ⏳ ===\nTo save context space, older events have been squashed into LOD 1 Blocks below.\n💡 INSTRUCTION: If you need to read the exact details, code, or logs of a past event, YOU MUST USE the `zoom_in_timeline` tool with the appropriate `block_id`.\n\n';
     for (const b of blocks) {
         content += `[Block ${b.block_id}]: ${b.lod1_summary}\n`;
     }
     content += '========================\n';
     return { role: 'system', content };
  }
  
  return {
    name: 'longContextTimeline',
    tools: [zoomTool, pinTool],
    hooks: {
      async beforeRun({ task, messages }, hookContext) {
        if (!config.conversationId) return { task, messages };

        const db = await store.loadContext(config.conversationId);
        currentBlocks = db.blocks;
        
        // Find which events are in the "Tail" (not covered by any block)
        let tailStartIndex = 0;
        if (currentBlocks.length > 0) {
            const lastBlock = currentBlocks[currentBlocks.length - 1];
            const endIdx = db.events.findIndex(e => e.id === lastBlock.end_event_id);
            if (endIdx !== -1) tailStartIndex = endIdx + 1;
        }
        activeTailEvents = db.events.slice(tailStartIndex);

        // Constraint 2: Head (System Prompt) stays LOD 0
        const sysMsg = messages[0];
        
        // Keyframe Implementation: Prepend pinned core memory
        const pinnedMessages = db.events.filter(e => e.is_pinned).map(e => ({
            role: e.role,
            content: e.content
        } as Message));

        const userMsg = messages[messages.length - 1]; // Assume task is at end

        // Constraint 3: Giant Input Defense
        const userTokens = tokenCounter(userMsg.content || "");
        let finalUserMsg = userMsg;
        if (userTokens > activeBufferTokens) {
             const eventId = generateId('evt');
             const fullEvt: TimelineEvent = {
                 id: eventId, timestamp: Date.now(), role: 'user', content: userMsg.content || ""
             };
             await store.appendEvents(config.conversationId, [fullEvt]);
             activeTailEvents.push(fullEvt);
             
             const safeLen = Math.floor((activeBufferTokens - 500) * 3);
             finalUserMsg = {
                 role: 'user',
                 content: (userMsg.content || "").slice(0, safeLen) + `\n\n... [SYSTEM WARNING: Giant Input Truncated. Full text archived losslessly at event '${eventId}'. Use zoom_in_timeline if you need to read the rest.]`
             };
        } else {
             // Will be saved in afterIteration, or we can just stage it now
             // For simplicity, pocket-agent loop treats User Task as pre-existing, so we should convert it to an event now to ensure it's tracked
             const eventId = generateId('evt');
             const evt: TimelineEvent = {
                 id: eventId, timestamp: Date.now(), role: 'user', content: finalUserMsg.content || ""
             };
             await store.appendEvents(config.conversationId, [evt]);
             activeTailEvents.push(evt);
        }

        // Reconstruct Active Window
        const tailMessages: Message[] = activeTailEvents.filter(e => e.id !== activeTailEvents[activeTailEvents.length-1].id).map(e => ({
            role: e.role,
            content: e.content,
            name: e.name,
            tool_call_id: e.tool_call_id,
            tool_calls: e.tool_calls
        }));

        const newMessages = [
            sysMsg,
            ...pinnedMessages,
            renderRuler(currentBlocks),
            ...tailMessages,
            finalUserMsg
        ];

        lastKnownLength = newMessages.length;
        return { task, messages: newMessages };
      },
      
      async afterIteration({ iteration, messages, response, thoughts }, hookContext) {
        if (!config.conversationId) return { iteration, messages, response, thoughts };

        // 1. Detect new messages generated in this iteration and lossless store them (Constraint 1)
        // If ruler was injected, messages length increased by 1 before any new responses
        const safeStartIndex = Math.min(lastKnownLength, messages.length);
        const newMsgs = messages.slice(safeStartIndex);
        if (newMsgs.length > 0) {
            const newEvts: TimelineEvent[] = newMsgs.map(m => ({
                id: generateId('evt'),
                timestamp: Date.now(),
                role: m.role as any,
                content: m.content || "",
                name: m.name,
                tool_call_id: m.tool_call_id,
                tool_calls: m.tool_calls
            }));
            await store.appendEvents(config.conversationId, newEvts);
            activeTailEvents.push(...newEvts);
        }

        let updatedMessages = [...messages];
        
        // 2. Token Check & Middle Squashing (Constraint 4)
        const currentTokens = calculateTotalTokens(updatedMessages, tokenCounter);
        if (currentTokens > summaryThreshold && activeTailEvents.length > 3) {
            // Find the Ruler index (should be 1 + pinned messages count)
            const rulerIdx = updatedMessages.findIndex(m => m.role === 'system' && (m.content||'').includes('TIMELINE RULER'));
            
            // Squash the oldest N events from the Tail
            // We'll squash half of the active tail to free up substantial space, ignoring pinned items
            const unpinnedTail = activeTailEvents.filter(e => !e.is_pinned);
            const squashCount = Math.floor(unpinnedTail.length / 2);
            const eventsToSquash = unpinnedTail.slice(0, squashCount);
            
            if (eventsToSquash.length > 0) {
                console.log(`\x1b[33m[LongContext Timeline] Squashing ${eventsToSquash.length} oldest events into a LOD 1 Block...\x1b[0m`);
                const msgsToSummarize = eventsToSquash.map(e => ({ role: e.role, content: e.content } as Message));
                const lod1_summary = await generateSummary(msgsToSummarize, config.model);
                
                const newBlock: TimelineBlock = {
                    block_id: generateId('blk'),
                    start_event_id: eventsToSquash[0].id,
                    end_event_id: eventsToSquash[eventsToSquash.length - 1].id,
                    lod1_summary
                };
                
                await store.addBlock(config.conversationId, newBlock);
                currentBlocks.push(newBlock);
                
                // Update active tail
                activeTailEvents = activeTailEvents.slice(squashCount);
                
                // Reconstruct messages array
                const tailMsgsStartIdx = rulerIdx !== -1 ? rulerIdx + 1 : 1;
                // Slice away the mapped squash messages. Because 1 TimelineEvent maps to 1 Message in the tail, we can drop the first `squashCount` messages after the ruler.
                updatedMessages.splice(tailMsgsStartIdx, squashCount);
                
                // Update the Ruler content
                if (rulerIdx !== -1) {
                    updatedMessages[rulerIdx] = renderRuler(currentBlocks);
                } else {
                    // Inject ruler if it didn't exist
                    updatedMessages.splice(1, 0, renderRuler(currentBlocks));
                }
            }
        }

        lastKnownLength = updatedMessages.length;
        return { iteration, messages: updatedMessages, response, thoughts };
      },
      
      async afterRun({ task, messages, result }, hookContext) {
        // Since we save losslessly in afterIteration, we don't need a heavy state save here.
        // The file is fully up to date.
        return { task, messages, result };
      }
    }
  };
}
