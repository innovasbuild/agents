import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { sendMail } from "../../../lib/gmail/send";

export default defineTool({
	description:
		"Envía un email desde la casilla de Gmail del usuario autenticado.",
	inputSchema: z.object({
		to: z.string().email(),
		subject: z.string().min(1),
		body: z.string().min(1),
	}),
	approval: always(),
	async execute(input, ctx) {
		const userId = ctx.session.auth.current?.principalId;
		if (!userId) throw new Error("send_email requiere un usuario autenticado");
		if (ctx.session.auth.current?.principalType !== "user") {
			throw new Error("send_email requiere un principal de tipo user");
		}
		return sendMail(userId, input);
	},
});
