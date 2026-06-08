/**
 * Pagination cursor for bounded result sets (findUsages). A cursor is the
 * stringified zero-based offset into the full result list. Shared by both engines
 * so they accept and reject identical values — a cursor minted by one must not be
 * silently mis-paged by the other.
 */
export function parsePageCursor(cursor: string | undefined): number {
	if (cursor === undefined || cursor === "") {
		return 0;
	}

	const offset = Number(cursor);

	if (!Number.isInteger(offset) || offset < 0) {
		throw new Error(`invalid cursor: ${cursor} (expected a non-negative integer offset)`);
	}

	return offset;
}
