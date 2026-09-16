// "Hoy" en la zona del tenant (spec 03 §4.8), para cupos y un toque por día.
function offsetMinutes(timeZone: string, at: Date): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(at);
	const get = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value);
	const asUtc = Date.UTC(
		get("year"),
		get("month") - 1,
		get("day"),
		get("hour"),
		get("minute"),
		get("second"),
	);
	return Math.round((asUtc - at.getTime()) / 60_000);
}

export function localDate(timeZone: string, at: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(at);
}

export function dayStart(timeZone: string, now: Date): Date {
	const [year, month, day] = localDate(timeZone, now).split("-").map(Number);
	const midnightAsUtc = new Date(Date.UTC(year, month - 1, day));
	return new Date(
		midnightAsUtc.getTime() - offsetMinutes(timeZone, midnightAsUtc) * 60_000,
	);
}
