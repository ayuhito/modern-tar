# @modern-tar/core

Zero-dependency, cross-platform, streaming tar archive library for every JavaScript runtime. Built with the browser-native Web Streams API for performance and memory efficiency.

## Features

- 🚀 **Streaming Architecture** - Supports large archives without loading everything into memory.
- 📋 **Standards Compliant** -
Full USTAR format support with PAX extensions. Compatible with GNU tar, BSD tar, and other standard implementations.
- 🗜️ **Compression** - Includes helpers for gzip compression/decompression.
- 📝 **TypeScript First** - Full type safety with detailed TypeDoc documentation.
- ⚡ **Zero Dependencies** - No external dependencies, minimal bundle size.
- 🌐 **Cross-Platform** - Works in browsers, Node.js, Cloudflare Workers, and other JavaScript runtimes.

## Installation

```bash
npm install @modern-tar/core
```

## Usage

### Simple

```typescript
import { packTar, unpackTar } from '@modern-tar/core';

// Pack entries into tar buffer
const entries = [
	{ header: { name: "file.txt", size: 5 }, body: "hello" },
	{ header: { name: "dir/", type: "directory", size: 0 } },
	{ header: { name: "dir/nested.txt", size: 3 }, body: new Uint8Array([97, 98, 99]) } // "abc"
];

// Accepts string, Uint8Array, Blob, ReadableStream<Uint8Array> and more...
const tarBuffer = await packTar(entries);

// Unpack tar buffer into entries
for await (const entry of unpackTar(tarBuffer)) {
	console.log(`File: ${entry.header.name}`);
	const content = new TextDecoder().decode(entry.data);
	console.log(`Content: ${content}`);
}
```

### Streaming

```typescript
import { createTarPacker, createTarDecoder } from '@modern-tar/core';

// Create a tar packer
const { readable, controller } = createTarPacker();

// Add entries dynamically
const fileStream = controller.add({
	name: "dynamic.txt",
	size: 5,
	type: "file"
});

// Write content to the stream
const writer = fileStream.getWriter();
await writer.write(new TextEncoder().encode("hello"));
await writer.close();

// When done adding entries, finalize the archive
controller.finalize();

// readable now contains the complete tar archive which can be piped or processed
const tarStream = readable;

// Create a tar decoder
const decoder = createTarDecoder();
const decodedStream = tarStream.pipeThrough(decoder);
for await (const entry of decodedStream) {
	console.log(`Decoded: ${entry.header.name}`);
	// Process `entry.body` stream as needed
}
```

### Compression/Decompression (gzip)

```typescript
import { createGzipDecoder, unpackTar } from '@modern-tar/core';

// Fetch a .tar.gz file stream
const response = await fetch('https://example.com/archive.tar.gz');
if (!response.body) throw new Error('No response body');

// Decompress .tar.gz to .tar stream
const tarStream = response.body.pipeThrough(createGzipDecoder());

// Use `unpackTar` for buffered extraction or `createTarDecoder` for streaming
for await (const entry of unpackTar(tarStream)) {
	console.log(`Extracted: ${entry.header.name}`);
	const content = new TextDecoder().decode(entry.data);
	console.log(`Content: ${content}`);
}
```

```typescript
import { createGzipEncoder, createTarPacker } from '@modern-tar/core';

// Create a tar packer
const { readable, controller } = createTarPacker();

// Add entries dynamically
const fileStream = controller.add(...);
/* ... */
controller.finalize();

// Compress tar stream to .tar.gz
const compressedStream = readable.pipeThrough(createGzipEncoder());

// Pipe `compressedStream` to a writable stream or process e.g. `fetch`
const response = await fetch('https://example.com/upload', {
	method: 'POST',
	body: compressedStream,
	headers: {
		'Content-Type': 'application/gzip'
	}
});
```

## API Reference

### Simple API

#### `packTar(entries: TarEntry[]): Promise<Uint8Array>`

Pack an array of entries into a tar archive buffer.

**Parameters:**
- `entries` - Array of `TarEntry` objects to pack

**Returns:** Promise resolving to complete tar archive as Uint8Array

**Example:**
```typescript
const entries = [
  { header: { name: "file.txt", size: 5 }, body: "hello" },
  { header: { name: "dir/", type: "directory", size: 0 } }
];
const tarBuffer = await packTar(entries);
```

#### `unpackTar(archive: ArrayBuffer | Uint8Array, options?: UnpackOptions): Promise<ParsedTarEntryWithData[]>`

Extract all entries from a tar archive buffer with optional filtering and transformation.

**Parameters:**
- `archive` - Complete tar archive as ArrayBuffer or Uint8Array
- `options` - Optional extraction configuration (see `UnpackOptions`)

**Returns:** Promise resolving to array of entries with buffered data

**Example:**
```typescript
// Basic extraction
const entries = await unpackTar(tarBuffer);
for (const entry of entries) {
  console.log(`File: ${entry.header.name}`);
  const content = new TextDecoder().decode(entry.data);
  console.log(`Content: ${content}`);
}

// With filtering and path manipulation
const filteredEntries = await unpackTar(tarBuffer, {
  strip: 1, // Remove first path component
  filter: (header) => header.name.endsWith('.js'),
  map: (header) => ({ ...header, name: header.name.toLowerCase() })
});
```

### Streaming API

#### `createTarPacker(): { readable, controller }`

Create a streaming tar packer for dynamic entry creation.

**Returns:**
- `readable` - ReadableStream outputting tar archive bytes
- `controller` - TarPackController for adding entries

**Example:**
```typescript
const { readable, controller } = createTarPacker();

// Add entries dynamically
const stream1 = controller.add({ name: "file1.txt", size: 5 });
const stream2 = controller.add({ name: "file2.txt", size: 4 });

// Write content to streams
await writeToStream(stream1, "hello");
await writeToStream(stream2, "test");

controller.finalize();
// readable contains the complete archive
```

#### `createTarDecoder(): TransformStream<Uint8Array, ParsedTarEntry>`

Create a transform stream that parses tar bytes into entries.

**Parameters:** None

**Returns:** TransformStream that converts tar archive bytes to `ParsedTarEntry` objects

**Example:**
```typescript
const decoder = createTarDecoder();
const entriesStream = tarStream.pipeThrough(decoder);

for await (const entry of entriesStream) {
  console.log(`Entry: ${entry.header.name}`);
  // Process entry.body stream as needed
}
```

#### `createTarOptionsTransformer(options?: UnpackOptions): TransformStream<ParsedTarEntry, ParsedTarEntry>`

Create a transform stream that applies unpacking options to tar entries.

**Parameters:**
- `options` - Optional unpacking configuration (see `UnpackOptions`)

**Returns:** TransformStream that processes `ParsedTarEntry` objects with options applied

**Example:**
```typescript
import { createTarDecoder, createTarOptionsTransformer } from '@modern-tar/core';

const transformedStream = sourceStream
  .pipeThrough(createTarDecoder())
  .pipeThrough(createTarOptionsTransformer({
    strip: 1,  // Remove first path component
    filter: (header) => header.name.endsWith('.txt'),
    map: (header) => ({ ...header, mode: 0o644 })
  }));

for await (const entry of transformedStream) {
  // Process transformed entries
  console.log(`Processed: ${entry.header.name}`);
}
```

### Compression

#### `createGzipEncoder(): CompressionStream`

Create a gzip compression stream for tar.gz creation.

**Example:**
```typescript
const tarStream = /* ... */;
const compressedStream = tarStream.pipeThrough(createGzipEncoder());
```

#### `createGzipDecoder(): DecompressionStream`

Create a gzip decompression stream for tar.gz extraction.

**Example:**
```typescript
const gzipStream = /* ... */;
const tarStream = gzipStream.pipeThrough(createGzipDecoder());
```

## Types

### TarHeader

```typescript
interface TarHeader {
  name: string;                    // File/directory name
  size: number;                    // File size in bytes
  mtime?: Date;                    // Modification time
  mode?: number;                   // File permissions (e.g., 0o644)
  type?: "file" | "directory" | "symlink" | "link" | "pax-header" | "pax-global-header";
  linkname?: string;               // Target for symlinks/hardlinks
  uid?: number;                    // User ID
  gid?: number;                    // Group ID
  uname?: string;                  // User name
  gname?: string;                  // Group name
  pax?: Record<string, string>;    // PAX extended attributes
}
```

### TarEntry

```typescript
interface TarEntry {
  header: TarHeader;
  body?: string | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array> | Blob | null;
}
```

### ParsedTarEntry

```typescript
interface ParsedTarEntry {
	header: TarHeader;
	body: ReadableStream<Uint8Array>;
}
```

### ParsedTarEntryWithData

```typescript
interface ParsedTarEntryWithData {
	header: TarHeader;
	data: Uint8Array;
}
```

### UnpackOptions

Platform-neutral configuration options for extracting tar archives.

```typescript
interface UnpackOptions {
  /** Number of leading path components to strip from entry names (e.g., strip: 1 removes first directory) */
  strip?: number;
  /** Filter function to include/exclude entries (return false to skip) */
  filter?: (header: TarHeader) => boolean;
  /** Transform function to modify tar headers before extraction */
  map?: (header: TarHeader) => TarHeader;
}
```

**Example:**
```typescript
const options: UnpackOptions = {
  strip: 2, // Remove first 2 path components
  filter: (header) => header.type === 'file' && !header.name.includes('test'),
  map: (header) => ({ ...header, mode: 0o644 }) // Normalize permissions
};

const entries = await unpackTar(tarBuffer, options);
```

## Browser Support

This library uses the [Web Streams API](https://caniuse.com/streams) and requires:

- **Node.js**: 18.0+
- **Browsers**: Modern browsers with Web Streams support
  - Chrome 71+
  - Firefox 102+
  - Safari 14.1+
  - Edge 79+

## License

MIT
