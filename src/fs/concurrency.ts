/** Create a concurrency limited operation queue. */
export const createOperationQueue = (concurrency: number) => {
	let active = 0;
	const tasks: Array<() => Promise<void>> = [];

	let head = 0; // Head index for the next task to process.
	let idle: Promise<void> | null = null; // Promise that resolves when the queue is idle.
	let resolveIdle: (() => void) | null = null;

	// Ensure the idle promise is created if it doesn't exist.
	const ensureIdle = () =>
		(idle ??= new Promise<void>((resolve) => (resolveIdle = resolve)));

	// Process tasks while respecting concurrency limit.
	const flush = () => {
		while (active < concurrency && head < tasks.length) {
			// Start the next task.
			const task = tasks[head++];
			active++;

			// Execute the task.
			task().finally(() => {
				active--;
				flush();
			});
		}

		// If all tasks are done, reset the queue.
		if (head === tasks.length) {
			tasks.length = 0;
			head = 0;

			// Resolve idle promise if needed.
			if (active === 0 && resolveIdle) {
				resolveIdle();
				idle = null;
				resolveIdle = null;
			}
		}
	};

	return {
		/** Add a new operation to the queue. */
		add<T>(op: () => Promise<T>): Promise<T> {
			const wasIdle = active === 0 && head === tasks.length;
			return new Promise<T>((resolve, reject) => {
				tasks.push(() => Promise.resolve().then(op).then(resolve, reject));

				// If the queue was idle, ensure the idle promise is created.
				if (wasIdle) ensureIdle();

				flush();
			});
		},

		onIdle(): Promise<void> {
			return active === 0 && head === tasks.length
				? Promise.resolve()
				: ensureIdle();
		},
	};
};
