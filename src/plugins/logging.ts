import type { AgentHooks } from '../index';

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",

  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
  },
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
  }
};

export function createLoggingPlugin(): { name: string; hooks: AgentHooks } {
  return {
    name: 'logger',
    hooks: {
      async beforeRun({ task, messages }) {
        console.log(`\n${colors.fg.green}${colors.bright}🚀 Starting Agent Run${colors.reset}`);
        console.log(`${colors.fg.green}Task: ${task}${colors.reset}\n`);
        return { task, messages };
      },

      async beforeIteration({ iteration, messages }) {
        const tokenEstimate = JSON.stringify(messages).length / 4; // Crude estimation
        console.log(`${colors.fg.cyan}┌── Iteration ${iteration + 1} ────────────────── ${colors.fg.gray}(Tokens: ~${Math.ceil(tokenEstimate)})${colors.reset}`);
        return { iteration, messages };
      },

      async afterIteration({ iteration, response, thoughts, messages }) {
        // Log Thoughts (Content from model)
        if (response && response.trim()) {
           console.log(`${colors.fg.yellow}🤖 Thought:${colors.reset}`);
           console.log(`${colors.dim}${response.trim()}${colors.reset}`);
        }

        // Log Actions (Tool Calls)
        if (thoughts && thoughts.length > 0) {
            thoughts.forEach(thought => {
                if (thought.type === 'action') {
                    console.log(`${colors.fg.magenta}🔧 Tool Call: ${colors.bright}${thought.tool}${colors.reset}`);
                    console.log(`${colors.fg.magenta}   Input: ${JSON.stringify(thought.input, null, 2)}${colors.reset}`);
                }
            });

            // Log Tool Outputs (finding them in messages)
            // We look for tool messages that follow the last assistant message
            const reversed = [...messages].reverse();
            const toolMessages = [];
            for (const msg of reversed) {
                if (msg.role === 'tool') {
                    toolMessages.unshift(msg);
                } else {
                    break; // Stop at assistant or user message
                }
            }

            if (toolMessages.length > 0) {
                toolMessages.forEach(msg => {
                     let output = msg.content;
                     if (output.length > 200) {
                         output = output.slice(0, 200) + `... (${output.length - 200} more chars)`;
                     }
                     console.log(`${colors.fg.blue}📤 Tool Output (${msg.name}):${colors.reset}`);
                     console.log(`${colors.dim}${output}${colors.reset}`);
                });
            }
        }
        
        console.log(`${colors.fg.cyan}└──────────────────────────────────────${colors.reset}\n`);
        return { iteration, response, thoughts, messages };
      },
      
      async afterRun({ result }) {
        console.log(`\n${colors.fg.green}${colors.bright}✅ Agent Finished${colors.reset}`);
        console.log(`${colors.fg.green}Result: ${result}${colors.reset}\n`);
        return { result };
      }
    }
  };
}
