import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Checks a `minidesk-signature` header (`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`).
 * Fails closed: no secret, a malformed header or a time more than five minutes away is a refusal.
 */
export function verifySignature(
	rawBody: string,
	header: string | undefined,
	secret: string | undefined,
	nowSeconds: number,
): boolean {
	if (secret === undefined || secret === '' || header === undefined) return false;

	const pairs = header.split(',').map((part) => {
		const [key, ...rest] = part.trim().split('=');

		return [key, rest.join('=')] as const;
	});
	const parts = new Map(pairs);
	const t = parts.get('t') ?? '';
	const given = parts.get('v1') ?? '';

	// A key sent twice, e.g. a repeated header that Node joined with ", ".
	if (parts.size !== pairs.length) return false;
	// Plain digits, as the server signs them. Written so a NaN clock fails too.
	if (!/^\d{1,12}$/.test(t) || !(Math.abs(nowSeconds - Number(t)) <= 300)) return false;
	// Checked first so both buffers are 32 bytes: timingSafeEqual throws on a length mismatch.
	if (!/^[0-9a-f]{64}$/.test(given)) return false;

	const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');

	return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
}
