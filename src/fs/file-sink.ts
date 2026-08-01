import * as fs from "node:fs";

interface SinkOptions {
	mode?: number;
	mtime?: Date;
}

export interface FileSink {
	write(chunk: Buffer | Uint8Array | string): boolean;
	end(): Promise<void>;
	destroy(error?: Error): void;
	waitDrain(): Promise<void>;
}

/** Flush and backpressure thresholds for bounded, overlapping writes. */
const BATCH_BYTES = 256 * 1024;
const BUFFER_LIMIT = 8 * 1024 * 1024;
const OPEN_FLAGS =
	fs.constants.O_WRONLY |
	fs.constants.O_CREAT |
	fs.constants.O_TRUNC |
	// Fail if the destination is a symlink instead of following it.
	(fs.constants.O_NOFOLLOW ?? 0);
const CREATE_FLAGS = OPEN_FLAGS | fs.constants.O_EXCL;

const STATE_OPENING = 1;
const STATE_OPEN = 2;
const STATE_CLOSED = 3;
const STATE_FAILED = 4;

type SinkState =
	| typeof STATE_OPENING
	| typeof STATE_OPEN
	| typeof STATE_CLOSED
	| typeof STATE_FAILED;

const DRAINED_PROMISE: Promise<void> = Promise.resolve();
const discardFile = (fd: number) => fs.ftruncate(fd, 0, () => fs.close(fd));

/**
 * Creates a lightweight file writer for tar extraction.
 *
 * Tar parsing happens synchronously. However, writing those bytes to disk
 * uses async `fs` calls, so we have to include this sink to keep the parser
 * and the filesystem in sync without dragging in a full Writable stream.
 *
 * The sink flushes each 256 KiB and applies backpressure at 8 MiB while write
 * calls overlap. After writes complete, metadata updates
 * such as `futimes` run.
 */
export function createFileSink(
	path: string,
	{ mode = 0o666, mtime }: SinkOptions = {},
	onError?: (error: Error) => void,
): FileSink {
	let state: SinkState = STATE_OPENING;
	let flushing = false;
	let fd: number | null = null;
	let queue: Buffer[] = []; // Buffers waiting to be written out (current batch).
	let spare: Buffer[] = []; // Recycled array swapped in while writev is in flight.
	let bytes = 0;
	let storedError: Error | null = null;
	let failedFd: number | null = null;

	// Used to track end() state.
	let endPromise: Promise<void> | null = null;
	let endResolve: (() => void) | null = null;
	let endReject: ((error: Error) => void) | null = null;

	// All callers wait for the same open/drain transition.
	let drainPromise: Promise<void> | null = null;
	let drainResolve: (() => void) | null = null;
	let drainReject: ((error: Error) => void) | null = null;
	const settleDrain = (error?: Error) => {
		if (!drainPromise) return;
		const resolve = drainResolve;
		const reject = drainReject;
		drainPromise = null;
		drainResolve = null;
		drainReject = null;
		if (error) reject?.(error);
		else resolve?.();
	};

	const resetBuffers = () => {
		bytes = 0;
		queue.length = 0;
		spare.length = 0;
	};

	const finish = () => {
		if (state === STATE_FAILED) return;
		state = STATE_CLOSED;
		endResolve?.();
		settleDrain();
	};

	// While writev is in-flight, we swap in a fresh array to collect new writes
	// to prevent stalling.
	const swapQueues = () => {
		const current = queue;
		queue = spare;
		spare = current;
		queue.length = 0;
		return current;
	};

	const fail = (error: Error) => {
		if (storedError) return;

		// After a write() failure we block all further writes to keep the state consistent.
		storedError = error;
		state = STATE_FAILED;
		const writePending = flushing;
		resetBuffers();

		const fdToClose = fd;
		fd = null;

		// Hard-fail truncation keeps partially written files from leaking on disk.
		if (fdToClose !== null) {
			if (writePending) failedFd = fdToClose;
			else discardFile(fdToClose);
		}
		flushing = false;

		if (endReject) endReject(error);
		else onError?.(error);
		// Unblock callers waiting on waitDrain so they surface the same failure.
		settleDrain(error);
		// We intentionally leave endResolve unset so end() continues to reject.
	};

	const close = () => {
		if (fd === null) {
			finish();
			return;
		}

		const fdToClose = fd;
		fd = null;

		if (mtime) {
			// Apply mtime before closing so corpus diffing stays deterministic.
			fs.futimes(fdToClose, mtime, mtime, (err) => {
				if (state !== STATE_OPEN) {
					fs.close(fdToClose);
					return;
				}
				if (err) {
					fs.close(fdToClose, () => fail(err));
					return;
				}
				fs.close(fdToClose, (closeErr) => {
					if (state !== STATE_OPEN) return;
					if (closeErr) fail(closeErr);
					else finish();
				});
			});
		} else {
			fs.close(fdToClose, (err) => {
				if (state !== STATE_OPEN) return;
				if (err) fail(err);
				else finish();
			});
		}
	};

	const flush = () => {
		if (flushing || queue.length === 0 || state !== STATE_OPEN) return;

		flushing = true;
		let bufs = swapQueues();
		let pendingBytes = bytes;

		// writev callback is small enough that passing a pre-declared function is slower.
		const onDone = (err: Error | null, written = 0) => {
			if (state !== STATE_OPEN) {
				if (failedFd !== null) {
					const fdToClose = failedFd;
					failedFd = null;
					discardFile(fdToClose);
				}
				return;
			}
			if (err) {
				flushing = false;
				fail(err);
				return;
			}
			if (written <= 0 || written > pendingBytes) {
				flushing = false;
				fail(new Error("File write made no progress."));
				return;
			}

			bytes -= written;
			pendingBytes -= written;
			if (pendingBytes > 0) {
				let skipped = written;
				let index = 0;
				while (skipped >= bufs[index].length) skipped -= bufs[index++].length;
				bufs = bufs.slice(index);
				if (skipped > 0) bufs[0] = bufs[0].subarray(skipped);
				if (bufs.length === 1) {
					const buf = bufs[0];
					// biome-ignore lint/style/noNonNullAssertion: Checked before flushing.
					fs.write(fd!, buf, 0, buf.length, null, onDone);
				} else {
					// biome-ignore lint/style/noNonNullAssertion: Checked before flushing.
					fs.writev(fd!, bufs, onDone);
				}
				return;
			}

			flushing = false;
			spare.length = 0; // Reset recycled array so the next flush starts empty.
			// If we drained below the threshold, resolve waiters.
			if (bytes < BUFFER_LIMIT) settleDrain();

			// Otherwise, flush more data if available.
			if (queue.length > 0) flush();
			else if (endResolve) close();
		};

		if (bufs.length === 1) {
			const buf = bufs[0];
			// biome-ignore lint/style/noNonNullAssertion: Checked before flushing.
			fs.write(fd!, buf, 0, buf.length, null, onDone);
		} else {
			// biome-ignore lint/style/noNonNullAssertion: Checked before flushing.
			fs.writev(fd!, bufs, onDone);
		}
	};

	const onOpen = (err: NodeJS.ErrnoException | null, openFd: number) => {
		if (err) return fail(err);

		if (state === STATE_CLOSED || state === STATE_FAILED) {
			fs.close(openFd);
			return;
		}

		fd = openFd;
		state = STATE_OPEN;

		if (endResolve) {
			// end() ran before open() resolved, so finish work immediately.
			if (queue.length > 0) flush();
			else close();
		} else if (bytes >= BATCH_BYTES && !flushing) {
			flush();
		} else {
			settleDrain();
		}
	};

	const write = (chunk: Buffer | Uint8Array | string): boolean => {
		if (storedError || state >= STATE_CLOSED || endResolve) return false;

		// Normalize chunk to Buffer.
		const buf = Buffer.isBuffer(chunk)
			? chunk
			: chunk instanceof Uint8Array
				? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
				: Buffer.from(chunk);

		if (buf.length === 0) return bytes < BUFFER_LIMIT;

		queue.push(buf);
		bytes += buf.length;

		if (state === STATE_OPEN && !flushing && bytes >= BATCH_BYTES) flush();

		// Return false to apply backpressure.
		return bytes < BUFFER_LIMIT;
	};

	const waitDrain = () => {
		if (storedError) return Promise.reject(storedError);
		if (
			state === STATE_OPENING ||
			(state === STATE_OPEN && bytes >= BUFFER_LIMIT)
		)
			return (drainPromise ??= new Promise<void>((resolve, reject) => {
				drainResolve = resolve;
				drainReject = reject;
			}));

		return DRAINED_PROMISE;
	};

	const end = (): Promise<void> => {
		if (storedError) return Promise.reject(storedError);
		if (state >= STATE_CLOSED) return DRAINED_PROMISE;
		if (endPromise) return endPromise;

		endPromise = new Promise((resolve, reject) => {
			endResolve = resolve;
			endReject = reject;

			// If open is still pending, onOpen will observe endResolve and close.
			if (state === STATE_OPEN && !flushing) {
				if (queue.length > 0) flush();
				else close();
			}
		});

		return endPromise;
	};

	const destroy = (error?: Error) => {
		// If already closed or failed, no-op.
		if (error) {
			fail(error);
			return;
		}

		// Normal close.
		if (state >= STATE_CLOSED || storedError) return;

		// Otherwise clean up.
		resetBuffers();
		flushing = false;

		if (fd !== null) {
			const fdToClose = fd;
			fd = null;
			fs.close(fdToClose);
		}

		finish();
	};

	// Open immediately so callers can await waitDrain() before writing body data.
	fs.open(path, CREATE_FLAGS, mode, (err, openFd) => {
		if (err?.code !== "EEXIST") return onOpen(err, openFd);
		if (state !== STATE_OPENING) return;
		fs.rm(path, { force: true }, (rmErr) => {
			if (rmErr) return fail(rmErr);
			if (state !== STATE_OPENING) return;
			fs.open(path, CREATE_FLAGS, mode, onOpen);
		});
	});
	return { write, end, destroy, waitDrain };
}
