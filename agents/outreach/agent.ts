import { defineAgent } from "eve";
import { tenantModel } from "../../lib/agents/eve/model";

export default defineAgent({
	model: tenantModel("outreach"),
});
