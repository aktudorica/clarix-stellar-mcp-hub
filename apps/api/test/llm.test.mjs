import { describe, it, expect } from '@jest/globals';
import { llmConfiguration } from '../dist/integrations/llm.configuration.js';

describe('LLM provider configuration', () => {
  it('preserves tool payloads and adds NVIDIA thinking at the top level', () => {
    const config = llmConfiguration({
      LLM_PROVIDER: 'nvidia',
      LLM_BASE_URL: 'https://integrate.api.nvidia.com/v1',
    });
    const body = {
      messages: [{ role: 'tool', content: '{}' }],
      tools: [{ type: 'function' }],
      stream: true,
    };
    expect(config.transformRequestBody(body)).toEqual({
      ...body,
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(config.maxOutputTokens).toBe(16384);
    expect(config.timeoutMs).toBe(180000);
    expect(config.temperature).toBe(1);
    expect(config.topP).toBe(0.95);
  });

  it('keeps generic providers unchanged and supports disabling thinking explicitly', () => {
    const generic = llmConfiguration({ LLM_BASE_URL: 'http://host.docker.internal:8080/v1' });
    expect(generic.transformRequestBody({ stream: true })).toEqual({ stream: true });
    expect(generic.maxOutputTokens).toBe(1500);
    const nvidia = llmConfiguration({
      LLM_BASE_URL: 'https://integrate.api.nvidia.com/v1',
      LLM_PROVIDER: 'nvidia',
      LLM_ENABLE_THINKING: 'false',
    });
    expect(nvidia.transformRequestBody({}).chat_template_kwargs.enable_thinking).toBe(false);
  });

  it.each([
    { LLM_BASE_URL: 'ftp://localhost/v1' },
    { LLM_BASE_URL: 'http://external.example/v1' },
    { LLM_BASE_URL: 'https://user:secret@example.com/v1' },
    { LLM_BASE_URL: 'https://example.com/v1?api_key=secret' },
    { LLM_BASE_URL: 'https://example.com/v1', LLM_TIMEOUT_MS: 'NaN' },
    { LLM_BASE_URL: 'https://example.com/v1', LLM_MAX_OUTPUT_TOKENS: '999999' },
  ])('rejects unsafe endpoints and unbounded generation settings', (env) => {
    expect(() => llmConfiguration(env)).toThrow(/Invalid LLM/);
  });
});
