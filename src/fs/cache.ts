/**
 * Creates a tiny string-keyed LRU cache capped at 10k entries to prevent OOM attacks.
 */
export const createCache = <V>() => {
	const m = new Map<string, V>();
	return {
		/**
		 * Gets a value from the cache and marks it as recently used.
		 */
		get(k: string): V | undefined {
			const v = m.get(k);
			// biome-ignore lint/style/noNonNullAssertion: Delete always returns boolean.
			if (m.delete(k)) m.set(k, v!);
			return v;
		} /**
		 * Sets a value in the cache, evicting the oldest entry if necessary.
		 *
		 * Note that we actually move the entry to tail on get() only since that is
		 * how we use this cache normally.
		 */,
		set(k: string, v: V): void {
			// biome-ignore lint/style/noNonNullAssertion: An item was just added.
			if (m.set(k, v).size > 10000) m.delete(m.keys().next().value!);
		},
	};
};
