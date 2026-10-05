import { withEve } from "eve/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		// La consola de plataforma sube el logo del tenant (hasta 1 MB) por
		// server action; el default de 1 MB lo cortaría.
		serverActions: { bodySizeLimit: "2mb" },
	},
};

export default withEve(nextConfig, {
	agents: { outreach: "./agents/outreach" },
});
