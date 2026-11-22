import { ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';

const settings = z.object({
  LLM_PROVIDER: z.enum(['openai-compatible', 'nvidia']).default('openai-compatible'),
  LLM_ENABLE_THINKING: z.enum(['true', 'false']).default('true'),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(32768).optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).optional(),
});

export function llmConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const parsed = settings.safeParse(env);
  if (!parsed.success)
    throw new ServiceUnavailableException('Invalid LLM generation configuration.');
  let url: URL;
  try {
    url = new URL(env.LLM_BASE_URL!);
  } catch {
    throw new ServiceUnavailableException('Invalid LLM endpoint configuration.');
  }
  const localHttp =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !localHttp)
  )
    throw new ServiceUnavailableException('Invalid LLM endpoint configuration.');
  const nvidia = parsed.data.LLM_PROVIDER === 'nvidia';
  return {
    provider: parsed.data.LLM_PROVIDER,
    baseURL: url.href,
    maxOutputTokens: parsed.data.LLM_MAX_OUTPUT_TOKENS ?? (nvidia ? 16384 : 1500),
    timeoutMs: parsed.data.LLM_TIMEOUT_MS ?? (nvidia ? 180000 : 60000),
    temperature: nvidia ? 1 : undefined,
    topP: nvidia ? 0.95 : undefined,
    transformRequestBody: (body: Record<string, unknown>) =>
      nvidia
        ? {
            ...body,
            chat_template_kwargs: { enable_thinking: parsed.data.LLM_ENABLE_THINKING === 'true' },
          }
        : body,
  };
}
