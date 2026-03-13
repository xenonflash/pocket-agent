import { createAgent, Tool, Message, ModelInterface } from './index';
import { createLongContextPlugin, createLoggingPlugin } from './plugins';

// A simple mock model to test the Timeline Plugin without requiring OpenAI API Keys
class MockModel implements ModelInterface {
  async chat(messages: Message[], tools?: any[]): Promise<{ content: string | null; toolCalls?: any[] }> {
    const lastMsg = messages[messages.length - 1].content || "";
    
    // Simulate Summary Generation (happens in background)
    if (lastMsg.includes("Summarize the following conversation")) {
        return { content: "[LOD 1 Summary] User shared a secret database port (8432) and keyword (Watermelon)." };
    }
    
    // Simulate Turn 1: Understanding secrets
    if (lastMsg.includes("secure database port is exactly")) {
        return { content: "Understood. I have securely noted the database port and secret keyword." };
    }
    
    // Simulate Turn 2: Pushing filler
    if (lastMsg.includes("Eiffel Tower")) {
        return { content: "The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France. It is named after the engineer Gustave Eiffel, whose company designed and built the tower.\n\nConstructed from 1887 to 1889 as the centerpiece of the 1889 World's Fair, it was initially criticized by some of France's leading artists and intellectuals for its design, but it has become a global cultural icon of France and one of the most recognizable structures in the world.\n\nThe tower is 330 metres (1,083 ft) tall, about the same height as an 81-storey building, and the tallest structure in Paris. Its base is square, measuring 125 metres (410 ft) on each side." };
    }
    
    // Simulate Turn 3: Needing to zoom
    if (lastMsg.includes("Do you remember the secret keyword")) {
        // Find the block ID in the Timeline Ruler
        let blockId = "";
        for (const msg of messages) {
            if (msg.role === 'system' && msg.content && msg.content.includes("TIMELINE RULER")) {
                const match = msg.content.match(/\[Block (blk_[^\]]+)\]/);
                if (match) blockId = match[1];
            }
        }
        
        if (blockId) {
            return {
                content: null,
                toolCalls: [{
                    id: "call_" + Math.random().toString(36).substr(2, 9),
                    type: "function",
                    function: {
                        name: "zoom_in_timeline",
                        arguments: JSON.stringify({ block_id: blockId })
                    }
                }]
            };
        }
        return { content: "I don't see any blocks in the timeline ruler to zoom into!" };
    }
    
    // Simulate Turn 3: After zooming
    if (messages.length > 0 && messages[messages.length - 1].role === 'tool') {
        const toolOutput = messages[messages.length - 1].content || "";
        if (toolOutput.includes("Watermelon") && toolOutput.includes("8432")) {
            return { content: "I zoomed into the timeline and found it! The secure database port is 8432 and the secret keyword is 'Watermelon'." };
        }
    }

    // Simulate Turn 4: Giant Payload
    if (lastMsg.includes("giant payload")) {
        // Assert it was truncated
        if (lastMsg.includes("SYSTEM WARNING: Giant Input Truncated")) {
            return { content: "Wow, that was a massive payload! Thankfully the memory system truncated it to protect my context window, but I see it was archived safely." };
        } else {
            return { content: "I received the giant payload but it wasn't truncated! This is dangerous for my context limit." };
        }
    }

    // Simulate Turn 5: Pinning Core Memory
    if (lastMsg.includes("I have a new admin password")) {
        return {
            content: null,
            toolCalls: [{
                id: "call_pin_" + Math.random().toString(36).substr(2, 9),
                type: "function",
                function: {
                    name: "pin_important_fact",
                    arguments: JSON.stringify({ fact: "The new admin password is 'SuperSecret123!'" })
                }
            }]
        };
    }

    // Simulate Turn 5: Acknowledgment
    if (messages.length > 0 && messages[messages.length - 1].role === 'tool' && (messages[messages.length - 1].content || "").includes("pinned successfully")) {
         return { content: "I have permanently anchored the admin password into my Core Memory." };
    }

    // Simulate Turn 6: Verification without Zoom
    if (lastMsg.includes("Without using any tools, what is the admin password")) {
        // Check if the pin exists in the system prompt area
        const hasPin = messages.some(m => m.role === 'system' && (m.content || "").includes("CORE MEMORY PINNED FACT"));
        if (hasPin) {
            return { content: "Because it was pinned to my Core Memory, I know without zooming that the admin password is 'SuperSecret123!'." };
        }
        return { content: "I don't know the password. It must have been squashed." };
    }

    return { content: "I am a offline mock model. I received your message." };
  }
}

async function example() {
  const model = new MockModel();

  // Intentionally extremely low thresholds to force timeline squashing quickly for testing
  const longContextPlugin = createLongContextPlugin({
    maxTokens: 1000,
    activeBufferTokens: 150, // Keep very few tokens in the active tail
    summaryThreshold: 200,   // Summarize blocks frequently
    storageDir: './storage',
    conversationId: `timeline-test-${Date.now()}`,
    model: model,
    tokenCounter: (text) => Math.ceil(text.length / 4)
  });

  const loggingPlugin = createLoggingPlugin();

  const agent = createAgent({
    model,
    tools: [], // No standard tools needed, tools are injected by the plugin
    hooks: [longContextPlugin, loggingPlugin]
  });

  console.log("--- Turn 1: Providing specific detail to be forgotten/summarized ---");
  await agent.run('I am giving you a very specific configuration value. The secure database port is exactly 8432 and the secret keyword is "Watermelon". Please just reply "Understood".');
  
  console.log("\n--- Turn 2: Pushing the context window with filler ---");
  await agent.run('Please write a 3-paragraph essay about the history of the Eiffel Tower. Ensure it is long enough to fill the context window context.');
  
  console.log("\n--- Turn 3: Requesting a Zoom to retrieve the lost fact ---");
  const finalResult = await agent.run('Do you remember the secret keyword and the database port I gave you in the very first turn? Your timeline ruler likely shows a summarized block for it. Please use the `zoom_in_timeline` tool on the appropriate block_id in your generic TIMELINE RULER to read the raw text and find the exact port and keyword, then reply with them.');
  console.log('\n🎯 Zoom Result:', finalResult);

  console.log("\n--- Turn 4: Throwing a Giant Payload to test Truncation Defense ---");
  const giantPayload = "This is a giant payload. ".repeat(500); // Exceeds active buffer limit
  const defenseResult = await agent.run(`Here is a giant payload: ${giantPayload}`);
  console.log('\n🛡️ Defense Result:', defenseResult);

  console.log("\n--- Turn 5: Testing Keyframe Pinning Tool ---");
  await agent.run("I have a new admin password for you. It is 'SuperSecret123!'. Please use the `pin_important_fact` tool to pin this to your core memory right now.");

  console.log("\n--- Turn 6: Flushing Context Again ---");
  await agent.run(`Please explain quantum physics briefly. ${giantPayload}`);

  console.log("\n--- Turn 7: Verifying Core Memory Survivability ---");
  const pinResult = await agent.run("Without using any tools, what is the admin password I gave you earlier? It should be in your Core Memory.");
  console.log('\n📌 Pin Result:', pinResult);
}

example().catch(console.error);
