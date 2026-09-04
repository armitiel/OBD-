import { AI_CONFIGURED, MOCK_MODE, MODEL } from './_lib/ai.mjs';
import { withHandler } from './_lib/http.mjs';

export default withHandler(async () => ({
  ok: true,
  aiConfigured: AI_CONFIGURED,
  mockMode: MOCK_MODE,
  model: MODEL,
  endpoints: ['/api/health', '/api/v1/diagnostic-plan', '/api/v1/diagnosis', '/api/v1/chat'],
}), { method: 'GET' });
