import type { AgentHooks } from '../index';

export function createLoggingPlugin(): { name: string; hooks: AgentHooks } {
  return {
    name: 'logger',
    hooks: {
      async beforeIteration({ iteration, messages }) {
        console.log(`[Logger] Iteration ${iteration}, messages: ${messages.length}`);
        return { iteration, messages };
      },
      async afterIteration({ iteration, response, messages, thoughts }) {
        console.log(`[Logger] Response at iteration ${iteration}:`, response.substring(0, 100));
        return { iteration, messages, response, thoughts };
      }
    }
  };
}
