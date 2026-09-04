import { handlePlan } from '../_lib/ai.mjs';
import { withHandler } from '../_lib/http.mjs';

export default withHandler((body) => handlePlan(body));
