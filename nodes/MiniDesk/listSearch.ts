import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import { miniDeskApiRequest } from './shared/transport';

// The next page's cursor, or undefined on the last page.
function nextPage(page: IDataObject): string | undefined {
	return typeof page.next_cursor === 'string' && page.next_cursor !== ''
		? page.next_cursor
		: undefined;
}

/** Conversations as "ACME-4F2KQ7 (dana@example.com)", searched by miniDesk. */
export async function searchConversations(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const page = await miniDeskApiRequest.call(this, 'GET', '/tickets', {
		qs: { q: filter?.trim(), limit: 50, cursor: paginationToken },
	});

	return {
		results: ((page.data as IDataObject[] | undefined) ?? []).map((ticket) => {
			const requester = (ticket.requester ?? null) as IDataObject | null;
			const customer = requester?.email || requester?.name || 'unknown customer';

			return { name: `${ticket.reference} (${customer})`, value: String(ticket.id) };
		}),
		paginationToken: nextPage(page),
	};
}

/** Active team members whose name contains the search. */
export async function searchMembers(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const page = await miniDeskApiRequest.call(this, 'GET', '/members');
	const search = (filter ?? '').trim().toLowerCase();

	return {
		results: ((page.data as IDataObject[] | undefined) ?? [])
			.filter(
				(member) =>
					member.is_active === true &&
					String(member.name ?? '')
						.toLowerCase()
						.includes(search),
			)
			.map((member) => ({ name: String(member.name), value: String(member.id) })),
	};
}

/** Reference documents whose title contains the search, a page at a time. */
export async function searchDocuments(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const search = (filter ?? '').trim().toLowerCase();
	const hasFilter = search !== '';
	let cursor: string | undefined = paginationToken;
	let results: Array<{ name: string; value: string }> = [];
	let lastCursor: string | undefined;
	const maxPages = hasFilter ? 5 : 1;

	for (let pageCount = 0; pageCount < maxPages; pageCount++) {
		const page = await miniDeskApiRequest.call(this, 'GET', '/knowledge', {
			qs: { limit: 100, cursor },
		});
		const pageResults = ((page.data as IDataObject[] | undefined) ?? [])
			.filter((doc) =>
				hasFilter
					? String(doc.title ?? '')
							.toLowerCase()
							.includes(search)
					: true,
			)
			.map((doc) => ({ name: String(doc.title), value: String(doc.id) }));

		results = results.concat(pageResults);
		lastCursor = nextPage(page);

		if (!hasFilter || pageResults.length > 0 || lastCursor === undefined) {
			break;
		}

		cursor = lastCursor;
	}

	return {
		results,
		paginationToken: lastCursor,
	};
}
