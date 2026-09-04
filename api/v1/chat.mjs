import { handleChat } from '../_lib/ai.mjs';
import { withHandler } from '../_lib/http.mjs';

export default withHandler((body) => handleChat(body));
