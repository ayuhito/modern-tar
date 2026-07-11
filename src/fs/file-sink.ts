import * as fs from "node:fs";
import * as path from "node:path";
import { validateBounds } from "./path";

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

/** Maximum number of bytes to buffer before applying backpressure. */
const BATCH_BYTES = 256 * 1024; // 256KB
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

/**
 * Creates a lightweight file writer for tar extraction.
 *
 * Tar parsing happens synchronously. However, writing those bytes to disk
 * uses async `fs` calls, so we have to include this sink to keep the parser
 * and the filesystem in sync without dragging in a full Writable stream.
 *
 * The sink buffers at most 256KB of data before flushing with write calls and
 * handles backpressure appropriately. After writes complete, metadata updates
 * such as `futimes` run.
 */
export function createFileSink(
	outPath: string,
	root: string,
	{ mode = 0o666, mtime }: SinkOptions = {},
): FileSink {
	let state: SinkState = STATE_OPENING;
	let flushing = false;
	let fd: number | null = null;
	let queue: Buffer[] = []; // Buffers waiting to be written out (current batch).
	let spare: Buffer[] = []; // Recycled array swapped in while writev is in flight.
	let bytes = 0;
	let storedError: Error | null = null;

	// Used to track end() state.
	let endPromise: Promise<void> | null = null;
	let endResolve: (() => void) | null = null;
	let endReject: ((error: Error) => void) | null = null;

	// Every pending waitDrain promise parks a pair of callbacks here.
	const waitResolves: Array<() => void> = [];
	const waitRejects: Array<(error: Error) => void> = [];

	// Resolves all pending waitDrain promises.
	const settleWaiters = () => {
		if (waitResolves.length === 0) return;
		for (let i = 0; i < waitResolves.length; i++) waitResolves[i]();
		waitResolves.length = 0;
		waitRejects.length = 0;
	};

	// Rejects all pending waitDrain promises with the given error.
	const failWaiters = (error: Error) => {
		if (waitRejects.length === 0) return;
		for (let i = 0; i < waitRejects.length; i++) waitRejects[i](error);
		waitRejects.length = 0;
		waitResolves.length = 0;
	};

	const resetBuffers = () => {
		bytes = 0;
		queue.length = 0;
		spare.length = 0;
	};

	const finish = () => {
		state = STATE_CLOSED;
		endResolve?.();
		settleWaiters();
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
		resetBuffers();
		flushing = false;

		const fdToClose = fd;
		fd = null;

		// Hard-fail truncation keeps partially written files from leaking on disk.
		if (fdToClose !== null)
			fs.ftruncate(fdToClose, 0, () => fs.close(fdToClose));

		endReject?.(error);
		// Unblock callers waiting on waitDrain so they surface the same failure.
		failWaiters(error);
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
				if (err) return fail(err);
				fs.close(fdToClose, (closeErr) => {
					if (closeErr) fail(closeErr);
					else finish();
				});
			});
		} else {
			fs.close(fdToClose, (err) => {
				if (err) fail(err);
				else finish();
			});
		}
	};

	const flush = () => {
		if (flushing || queue.length === 0 || state !== STATE_OPEN) return;

		flushing = true;
		const bufs = swapQueues();

		// writev callback is small enough that passing a pre-declared function is slower.
		const onDone = (err: Error | null, written = 0) => {
			if (err) return fail(err);

			flushing = false;
			bytes -= written;
			spare.length = 0; // Reset recycled array so the next flush starts empty.

			// If we drained below the threshold, resolve waiters.
			if (bytes < BATCH_BYTES) settleWaiters();

			// Otherwise, flush more data if available.
			if (queue.length > 0) flush();
			else if (endResolve) close();
		};

		if (bufs.length === 1) {
			const buf = bufs[0];
			// biome-ignore lint/style/noNonNullAssertion: Checked above.
			fs.write(fd!, buf, 0, buf.length, null, onDone);
		} else {
			// biome-ignore lint/style/noNonNullAssertion: Checked above.
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
			settleWaiters();
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

		if (buf.length === 0) return bytes < BATCH_BYTES;

		queue.push(buf);
		bytes += buf.length;

		if (state === STATE_OPEN && !flushing && bytes >= BATCH_BYTES) flush();

		// Return false to apply backpressure.
		return bytes < BATCH_BYTES;
	};

	const waitDrain = () => {
		if (
			state === STATE_OPENING ||
			(state === STATE_OPEN && bytes >= BATCH_BYTES)
		)
			return new Promise<void>((resolve, reject) => {
				waitResolves.push(resolve);
				waitRejects.push(reject);
			});

		return DRAINED_PROMISE;
	};

	const end = (): Promise<void> => {
		if (state >= STATE_CLOSED) return DRAINED_PROMISE;
		if (storedError) return Promise.reject(storedError);
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

	const validateParent = (next: () => void) => {
		fs.realpath.native(path.dirname(outPath), (err, realParent) => {
			if (err) return fail(err);
			try {
				validateBounds(
					realParent,
					root,
					`Path "${outPath}" changed during extraction.`,
				);
			} catch (error) {
				return fail(error as Error);
			}
			next();
		});
	};

	// Open immediately so callers can await waitDrain() before writing body data.
	validateParent(() => {
		fs.open(outPath, CREATE_FLAGS, mode, (err, openFd) => {
			if (!err || err.code !== "EEXIST") return onOpen(err, openFd);
			validateParent(() => {
				fs.rm(outPath, { force: true }, (rmErr) => {
					if (rmErr) return fail(rmErr);
					validateParent(() => fs.open(outPath, CREATE_FLAGS, mode, onOpen));
				});
			});
		});
	});
	return { write, end, destroy, waitDrain };
}
