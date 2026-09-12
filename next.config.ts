import { withEve } from "eve/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/* config options here */
};

export default withEve(nextConfig, {
	agents: { outreach: "./agents/outreach" },
});
