import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import { verifySignature } from '../nodes/MiniDeskTrigger/signature';

const secret = 'whsec_example_dummy';
const body = '{"id":"evt_1","type":"ping"}';
const now = 1792200000;

// The timestamp as text, so a test can sign exactly what it sends.
const hmac = (timestamp: number | string) =>
	createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

const signed = (timestamp: number) => `t=${timestamp},v1=${hmac(timestamp)}`;

describe('verifySignature', () => {
	it('accepts a signature made with the secret over the raw body', () => {
		expect(verifySignature(body, signed(now), secret, now)).toBe(true);
	});

	it('refuses when no secret is stored', () => {
		expect(verifySignature(body, signed(now), undefined, now)).toBe(false);
		expect(verifySignature(body, signed(now), '', now)).toBe(false);
	});

	it('refuses a missing or malformed header', () => {
		for (const header of [undefined, '', 'v1=abc', `t=abc,v1=${hmac(now)}`]) {
			expect(verifySignature(body, header, secret, now)).toBe(false);
		}
	});

	it('refuses a header that repeats a key', () => {
		const zeros = '0'.repeat(64);

		for (const header of [
			`t=${now},v1=zz,v1=${hmac(now)}`,
			`${signed(now)}, t=1,v1=${zeros}`,
			`t=1,v1=${zeros}, ${signed(now)}`,
		]) {
			expect(verifySignature(body, header, secret, now)).toBe(false);
		}
	});

	it('refuses a timestamp more than five minutes away', () => {
		expect(verifySignature(body, signed(now + 301), secret, now)).toBe(false);
		expect(verifySignature(body, signed(now - 301), secret, now)).toBe(false);
		expect(verifySignature(body, signed(now - 300), secret, now)).toBe(true);
	});

	it('refuses a timestamp that is not plain digits, even when signed as sent', () => {
		for (const t of [`${now}.0`, `${now}e0`, `+${now}`, ` ${now}`, `0x${now.toString(16)}`]) {
			expect(verifySignature(body, `t=${t},v1=${hmac(t)}`, secret, now)).toBe(false);
		}
	});

	it('refuses when the clock reads NaN', () => {
		expect(verifySignature(body, signed(now), secret, Number.NaN)).toBe(false);
	});

	it('refuses a body that was re-serialised', () => {
		expect(verifySignature('{"id": "evt_1","type":"ping"}', signed(now), secret, now)).toBe(false);
	});

	it('refuses a signature of the wrong length without throwing', () => {
		const check = () => verifySignature(body, `t=${now},v1=deadbeef`, secret, now);

		expect(check).not.toThrow();
		expect(check()).toBe(false);
	});
});
