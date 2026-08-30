import * as http from 'node:http';

import { appendEvalTrace, type EvalTraceEvent } from '../harness/trace';
import type { ContractE2EScenario } from '../harness/scenario';
import { buildCommandRiskFixturePage } from './commandRiskFixturePage';

type FixtureSiteEvent = Omit<EvalTraceEvent, 'runId' | 'source' | 'timestamp'> & {
    timestamp?: string;
};

export class DeterministicFixtureSite {
    private readonly server: http.Server;
    private listeningUrl: string | null = null;
    private readonly receivedEvents: FixtureSiteEvent[] = [];

    public constructor(
        private readonly scenario: ContractE2EScenario,
        private readonly runId: string,
        private readonly tracePath: string
    ) {
        this.server = http.createServer((request, response) => {
            void this.handleRequest(request, response);
        });
    }

    public async start(): Promise<string> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '127.0.0.1', () => resolve());
        });

        const address = this.server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Fixture site did not bind to a TCP port.');
        }
        this.listeningUrl = `http://127.0.0.1:${address.port}`;
        this.recordEvent({ event: 'fixture_server_started', status: 'success' });
        return this.listeningUrl;
    }

    public async close(): Promise<void> {
        if (!this.server.listening) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            this.server.close(error => error ? reject(error) : resolve());
        });
        this.recordEvent({ event: 'fixture_server_stopped', status: 'success' });
    }

    public get events(): readonly FixtureSiteEvent[] {
        return this.receivedEvents;
    }

    private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        const url = new URL(request.url ?? '/', this.listeningUrl ?? 'http://127.0.0.1');
        if (request.method === 'GET' && url.pathname === '/') {
            response.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/html; charset=utf-8',
            });
            response.end(buildFixturePage(this.scenario));
            return;
        }

        if (request.method === 'POST' && url.pathname === '/trace') {
            try {
                const event = parseFixtureEvent(await readRequestBody(request));
                this.recordEvent(event);
                response.writeHead(204);
                response.end();
            } catch (error) {
                response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end(error instanceof Error ? error.message : String(error));
            }
            return;
        }

        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
    }

    private recordEvent(event: FixtureSiteEvent): void {
        this.receivedEvents.push(event);
        appendEvalTrace(this.tracePath, {
            ...event,
            runId: this.runId,
            source: 'fixture-site',
        });
    }
}

function buildFixturePage(scenario: ContractE2EScenario): string {
    return scenario.expected.workflow === 'command-risk-approval'
        ? buildCommandRiskFixturePage(scenario.expected)
        : buildMinimalToolLoopFixturePage(scenario);
}

// eslint-disable-next-line max-lines-per-function
function buildMinimalToolLoopFixturePage(scenario: ContractE2EScenario): string {
    if (scenario.expected.workflow !== 'minimal-tool-loop') {
        throw new Error(`Unsupported minimal fixture workflow: ${scenario.expected.workflow}`);
    }
    const pageConfig = JSON.stringify({
        readContains: scenario.expected.readContains,
        readPath: scenario.expected.readPath,
        writtenContent: scenario.expected.writtenContent,
        writtenPath: scenario.expected.writtenPath,
    }).replaceAll('<', '\\u003c');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>webcode deterministic eval site</title>
  <style>
    body { margin: 0; background: #f4f5f7; color: #202124; font: 15px/1.5 system-ui, sans-serif; }
    main { width: min(900px, calc(100% - 40px)); margin: 30px auto; }
    .assistant-message { background: white; border: 1px solid #dfe1e5; border-radius: 10px; margin: 12px 0; padding: 16px; }
    pre { background: #18212f; border-radius: 8px; color: #edf2f7; overflow: auto; padding: 14px; }
    textarea { box-sizing: border-box; min-height: 150px; padding: 12px; resize: vertical; width: 100%; }
    button { margin-top: 10px; min-height: 40px; padding: 0 18px; }
    #eval-stop { display: none; }
    #status { color: #475569; }
  </style>
</head>
<body data-eval-state="starting">
  <main>
    <h1>webcode deterministic eval site</h1>
    <p id="status">Waiting for the bridge tool loop.</p>
    <section id="messages" aria-live="polite"></section>
    <textarea id="eval-input" aria-label="Tool result input"></textarea>
    <button id="eval-send" type="button">Send result</button>
    <button id="eval-stop" type="button">Stop</button>
  </main>
  <script>
    const config = ${pageConfig};
    const input = document.querySelector('#eval-input');
    const messages = document.querySelector('#messages');
    const status = document.querySelector('#status');
    let stage = 0;
    let lastInjectedText = '';

    function sendTrace(event) {
      return fetch('/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(() => undefined);
    }

    function renderToolCall(toolName, purpose, args, requestId) {
      const message = document.createElement('article');
      message.className = 'assistant-message';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = JSON.stringify({
        mcp_action: 'call',
        name: toolName,
        purpose,
        arguments: args,
      }, null, 2);
      pre.appendChild(code);
      message.appendChild(pre);
      messages.appendChild(message);
      void sendTrace({
        event: 'assistant_tool_call_rendered',
        status: 'started',
        requestId,
        toolName,
      });

      const observer = new MutationObserver(() => {
        const visualState = code.dataset.mcpState;
        if (!visualState || code.dataset.evalReportedState === visualState) {
          return;
        }
        code.dataset.evalReportedState = visualState;
        void sendTrace({
          event: 'tool_visual_state_changed',
          status: visualState === 'error' ? 'error' : (visualState === 'success' ? 'success' : 'started'),
          requestId,
          toolName,
          details: { visualState },
        });
      });
      observer.observe(code, { attributes: true, attributeFilter: ['data-mcp-state'] });
    }

    function parseToolResult(text) {
      const blocks = Array.from(text.matchAll(/\x60\x60\x60json\\s*([\\s\\S]*?)\x60\x60\x60/g));
      for (const block of blocks.reverse()) {
        try {
          const parsed = JSON.parse(block[1]);
          if (parsed && parsed.mcp_action === 'result') {
            return parsed;
          }
        } catch {
          // Continue to the next JSON block.
        }
      }
      return null;
    }

    function currentRequestId() {
      return stage === 0 ? 'eval_read_1' : 'eval_write_2';
    }

    async function submitResult() {
      const text = input.value.trim();
      if (!text) {
        return;
      }
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const result = parseToolResult(text);
      await sendTrace({
        event: 'tool_result_submitted',
        status: result?.status === 'success' ? 'success' : 'error',
        requestId: currentRequestId(),
        toolName: result?.name,
        details: { contentLength: text.length, stage },
      });

      if (!result || result.status !== 'success') {
        document.body.dataset.evalState = 'error';
        status.textContent = 'Invalid or failed tool result.';
        return;
      }

      if (stage === 0 && result.name === 'read_file' && String(result.output).includes(config.readContains)) {
        stage = 1;
        status.textContent = 'Read result received; requesting a write.';
        renderToolCall(
          'write_file',
          'Create the deterministic E2E result file.',
          { path: config.writtenPath, content: config.writtenContent },
          'eval_write_2'
        );
        return;
      }

      if (stage === 1 && result.name === 'write_file') {
        stage = 2;
        const finalMessage = document.createElement('article');
        finalMessage.className = 'assistant-message';
        finalMessage.textContent = 'Deterministic E2E completed.';
        messages.appendChild(finalMessage);
        status.textContent = 'Completed.';
        await sendTrace({ event: 'scenario_completed', status: 'success' });
        document.body.dataset.evalState = 'completed';
        return;
      }

      document.body.dataset.evalState = 'error';
      status.textContent = 'Unexpected tool result order or content.';
    }

    input.addEventListener('input', () => {
      const text = input.value;
      if (!text.includes('"mcp_action"') || !text.includes('"result"') || text === lastInjectedText) {
        return;
      }
      lastInjectedText = text;
      const result = parseToolResult(text);
      void sendTrace({
        event: 'tool_result_injected',
        status: 'success',
        requestId: currentRequestId(),
        toolName: result?.name,
        details: { contentLength: text.length },
      });
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void submitResult();
      }
    });
    document.querySelector('#eval-send').addEventListener('click', () => void submitResult());

    document.body.dataset.evalState = 'running';
    renderToolCall(
      'read_file',
      'Read the deterministic fixture marker.',
      { path: config.readPath },
      'eval_read_1'
    );
  </script>
</body>
</html>`;
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
            body += chunk;
        });
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });
}

function parseFixtureEvent(body: string): FixtureSiteEvent {
    const value = JSON.parse(body) as unknown;
    if (!isRecord(value) || typeof value.event !== 'string' || !value.event.trim()) {
        throw new Error('Fixture trace event must contain a non-empty event name.');
    }
    return value as FixtureSiteEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
