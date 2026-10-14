import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "INNOV.AS - Central IA",
	description: "La plataforma que ordena la adopción de IA en tu empresa",
	// Íconos por defecto (INNOV.AS) declarados acá y no como app/icon.*: los
	// archivos de convención no se pisan del todo desde un layout hijo, y el de
	// cada empresa (lib/tenants/brand-metadata.ts) tiene que ser el único.
	icons: {
		icon: [
			{ url: "/favicon.ico", sizes: "48x48" },
			{ url: "/icon.png", type: "image/png", sizes: "256x256" },
		],
		apple: { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
	},
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="es"
			className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
		>
			<body className="min-h-full flex flex-col">{children}</body>
		</html>
	);
}
