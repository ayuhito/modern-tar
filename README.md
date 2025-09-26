# 🗄️ modern-tar

Zero-dependency, cross-platform, streaming tar archive library for every JavaScript runtime. Built with the browser-native Web Streams API for performance and memory efficiency.

## Features

- 🚀 **Streaming Architecture** - Supports large archives without loading everything into memory.
- 📋 **Standards Compliant** - Full USTAR format support with PAX extensions. Compatible with GNU tar, BSD tar, and other standard implementations.
- 🗜️ **Compression** - Includes helpers for gzip compression/decompression.
- 📝 **TypeScript First** - Full type safety with detailed TypeDoc documentation.
- ⚡ **Zero Dependencies** - No external dependencies, minimal bundle size.
- 🌐 **Cross-Platform** - Works in browsers, Node.js, Cloudflare Workers, and other JavaScript runtimes.
- 📁 **Node.js Integration** - Additional high-level APIs for directory packing and extraction.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
  - [Core Usage (Browser, Node.js, etc.)](#core-usage)
  - [Node.js Filesystem Usage](#nodejs-filesystem-usage)
- [API Reference](#api-reference)
  - [Core API (`modern-tar`)](#core-api-modern-tar)
  - [Node.js Filesystem API (`modern-tar/fs`)](#nodejs-filesystem-api-modern-tarfs)
- [Types](#types)
  - [Core Types](#core-types)
  - [Filesystem Types](#filesystem-types)
- [Compatibility](#compatibility)

## Installation

```bash
npm install modern-tar
```

## Usage

This package provides two entry points:

- `modern-tar`: The core, cross-platform streaming API (works everywhere).
- `modern-tar/fs`: High-level filesystem utilities for Node.js.

### Core Usage

These APIs use the Web Streams API and can be used in any modern JavaScript environment.

#### Simple

```typescript
import { packTar, unpackTar } from 'modern-tar';

// Pack entries into a tar buffer
const entries = [
	{ header: { name: "file.txt", size: 5 }, body: "hello" },
	{ header: { name: "dir/", type: "directory", size: 0 } },
	{ header: { name: "dir/nested.txt", size: 3 }, body: new Uint8Array([97, 98, 99]) } // "abc"
];

// Accepts string, Uint8Array, Blob, ReadableStream<Uint8Array> and more...
const tarBuffer = await packTar(entries);

// Unpack tar buffer into entries
const entries = await unpackTar(tarBuffer);
for (const entry of entries) {
	console.log(`File: ${entry.header.name}`);
	const content = new TextDecoder().decode(entry.data);
	console.log(`Content: ${content}`);
}
```

#### Streaming

```typescript
import { createTarPacker, createTarDecoder } from 'modern-tar';

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

// `readable` now contains the complete tar archive which can be piped or processed
const tarStream = readable;

// Create a tar decoder
const decoder = createTarDecoder();
const decodedStream = tarStream.pipeThrough(decoder);
for await (const entry of decodedStream) {
	console.log(`Decoded: ${entry.header.name}`);
	// Process `entry.body` stream as needed
}
```

#### Compression/Decompression (gzip)

```typescript
import { createGzipEncoder, createTarPacker } from 'modern-tar';

// Create and compress a tar archive
const { readable, controller } = createTarPacker();
const compressedStream = readable.pipeThrough(createGzipEncoder());

// Add entries...
const fileStream = controller.add({ name: "file.txt", size: 5, type: "file" });
const writer = fileStream.getWriter();
await writer.write(new TextEncoder().encode("hello"));
await writer.close();
controller.finalize();

// Upload compressed .tar.gz
await fetch('/api/upload', {
  method: 'POST',
  body: compressedStream,
  headers: { 'Content-Type': 'application/gzip' }
});
```

```typescript
import { createGzipDecoder, createTarDecoder, unpackTar } from 'modern-tar';

// Download and process a .tar.gz file
const response = await fetch('https://api.example.com/archive.tar.gz');
if (!response.body) throw new Error('No response body');

// Buffer entire archive
const entries = await unpackTar(response.body.pipeThrough(createGzipDecoder()));

for (const entry of entries) {
	console.log(`Extracted: ${entry.header.name}`);
	const content = new TextDecoder().decode(entry.data);
	console.log(`Content: ${content}`);
}

// Or chain decompression and tar parsing using streams
const entries = response.body
  .pipeThrough(createGzipDecoder())
  .pipeThrough(createTarDecoder());

for await (const entry of entries) {
  console.log(`Extracted: ${entry.header.name}`);
  // Process entry.body ReadableStream as needed
}
```

### Node.js Filesystem Usage

These APIs use Node.js streams when interacting with the local filesystem.

#### Simple

```typescript
import { packTar, unpackTar } from 'modern-tar/fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Pack a directory into a tar file
const tarStream = packTar('./my/project');
const fileStream = createWriteStream('./project.tar');
await pipeline(tarStream, fileStream);

// Extract a tar file to a directory
const tarReadStream = createReadStream('./project.tar');
const extractStream = unpackTar('./output/directory');
await pipeline(tarReadStream, extractStream);
```

#### Filtering and Transformation

```typescript
import { packTar, unpackTar } from 'modern-tar/fs';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Pack with filtering
const packStream = packTar('./my/project', {
	filter: (filePath, stats) => !filePath.includes('node_modules'),
	map: (header) => ({ ...header, mode: 0o644 }), // Set all files to 644
	dereference: true // Follow symlinks instead of archiving them
});

// Unpack with advanced options
const sourceStream = createReadStream('./archive.tar');
const extractStream = unpackTar('./output', {
	// Core options
	strip: 1, // Remove first directory level
	filter: (header) => header.name.endsWith('.js'), // Only extract JS files
	map: (header) => ({ ...header, name: header.name.toLowerCase() }), // Transform names

	// Filesystem-specific options
	fmode: 0o644, // Override file permissions
	dmode: 0o755, // Override directory permissions
	maxDepth: 50  // Limit extraction depth for security (default: 1024)
});

await pipeline(sourceStream, extractStream);
```

#### Archive Creation

```typescript
import { packTarSources, type TarSource } from 'modern-tar/fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Pack multiple sources
const sources: TarSource[] = [
  { type: 'file', source: './package.json', target: 'project/package.json' },
  { type: 'directory', source: './src', target: 'project/src' },
  { type: 'content', content: 'Hello World!', target: 'project/hello.txt' },
  { type: 'content', content: '#!/bin/bash\necho "Executable"', target: 'bin/script.sh', mode: 0o755 }
];

const archiveStream = packTarSources(sources);
await pipeline(archiveStream, createWriteStream('project.tar'));
```

## API Reference

### Core API (`modern-tar`)

#### `packTar(entries: TarEntry[]): Promise<Uint8Array>`

Pack an array of entries into a tar archive buffer.

- **`entries`**: Array of `TarEntry` objects to pack.
- **Returns**: Promise resolving to a complete tar archive as a `Uint8Array`.

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

- **`archive`**: Complete tar archive as `ArrayBuffer` or `Uint8Array`.
- **`options`**: Optional extraction configuration (see `UnpackOptions`).
- **Returns**: Promise resolving to an array of entries with buffered data.

**Example:**

```typescript
// With filtering and path manipulation
const filteredEntries = await unpackTar(tarBuffer, {
  strip: 1, // Remove first path component
  filter: (header) => header.name.endsWith('.js'),
  map: (header) => ({ ...header, name: header.name.toLowerCase() })
});
```

#### `createTarPacker(): { readable, controller }`

Create a streaming tar packer for dynamic entry creation.

- **Returns**: An object containing:
  - `readable` - `ReadableStream` outputting tar archive bytes.
  - `controller` - `TarPackController` for adding entries.

**Example:**

```typescript
const { readable, controller } = createTarPacker();

// Add entries dynamically
const stream1 = controller.add({ name: "file1.txt", size: 5 });
const stream2 = controller.add({ name: "file2.txt", size: 4 });

// Write content to streams and finalize
// ...
controller.finalize();
```

#### `createTarDecoder(): TransformStream<Uint8Array, ParsedTarEntry>`

Create a transform stream that parses tar bytes into entries.

- **Returns**: `TransformStream` that converts tar archive bytes to `ParsedTarEntry` objects.

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

Create a transform stream that applies unpacking options (`strip`, `filter`, `map`) to tar entries.

- **`options`**: Optional unpacking configuration (see `UnpackOptions`).
- **Returns**: `TransformStream` that processes `ParsedTarEntry` objects.

**Example:**

```typescript
import { createTarDecoder, createTarOptionsTransformer } from 'modern-tar';

const transformedStream = sourceStream
  .pipeThrough(createTarDecoder())
  .pipeThrough(createTarOptionsTransformer({
    strip: 1,
    filter: (header) => header.name.endsWith('.txt'),
  }));
```

#### `createGzipEncoder(): CompressionStream`

Create a gzip compression stream for `.tar.gz` creation.

**Example:**

```typescript
const tarStream = /* ... */;
const compressedStream = tarStream.pipeThrough(createGzipEncoder());
```

#### `createGzipDecoder(): DecompressionStream`

Create a gzip decompression stream for `.tar.gz` extraction.

**Example:**

```typescript
const gzipStream = /* ... */;
const tarStream = gzipStream.pipeThrough(createGzipDecoder());
```

### Node.js Filesystem API (`modern-tar/fs`)

#### `packTar(directoryPath: string, options?: PackOptionsFS): Readable`

Pack a directory into a Node.js Readable stream containing tar archive bytes.

- **`directoryPath`**: Path to the directory to pack.
- **`options`**: Optional packing configuration (see `PackOptionsFS`).
- **Returns**: Node.js `Readable` stream of tar archive bytes.

**Example:**

```typescript
import { packTar } from 'modern-tar/fs';

const tarStream = packTar('/home/user/project', {
  dereference: true,  // Follow symlinks
  filter: (path, stats) => !path.includes('tmp'),
});
```

#### `unpackTar(directoryPath: string, options?: UnpackOptionsFS): Writable`

Extract a tar archive to a directory.

- **`directoryPath`**: Path to the directory where files will be extracted.
- **`options`**: Optional extraction configuration (see `UnpackOptionsFS`).
- **Returns**: Node.js `Writable` stream to pipe tar archive bytes into.

**Example:**

```typescript
import { unpackTar } from 'modern-tar/fs';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const tarStream = createReadStream('backup.tar');
const extractStream = unpackTar('/restore/location', {
  strip: 1,
  fmode: 0o644, // Set consistent file permissions
});
await pipeline(tarStream, extractStream);
```

#### `packTarSources(sources: TarSource[]): Readable`

Pack multiple sources (files, directories, or raw content) into a tar archive stream.

- **`sources`**: Array of `TarSource` objects describing what to include in the archive.
- **Returns**: Node.js `Readable` stream of tar archive bytes.

**Example:**

```typescript
import { packTarSources, type TarSource } from 'modern-tar/fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const sources: TarSource[] = [
  { type: 'file', source: './README.md', target: 'docs/readme.txt' },
  { type: 'directory', source: './src', target: 'app/src' },
  { type: 'content', content: '{"version": "1.0.0"}', target: 'app/config.json' },
  { type: 'content', content: Buffer.from('binary data'), target: 'data/binary.dat' }
];

const archiveStream = packTarSources(sources);
await pipeline(archiveStream, createWriteStream('app.tar'));
```

## Types

### Core Types

```typescript
// Header information for a tar entry
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

// Input entry for packing functions
interface TarEntry {
  header: TarHeader;
  body?: string | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array> | Blob | null;
}

// Output entry from a streaming decoder
interface ParsedTarEntry {
	header: TarHeader;
	body: ReadableStream<Uint8Array>;
}

// Output entry from a buffered unpack function
interface ParsedTarEntryWithData {
	header: TarHeader;
	data: Uint8Array;
}

// Platform-neutral configuration for unpacking
interface UnpackOptions {
  /** Number of leading path components to strip from entry names (e.g., strip: 1 removes first directory) */
  strip?: number;
  /** Filter function to include/exclude entries (return false to skip) */
  filter?: (header: TarHeader) => boolean;
  /** Transform function to modify tar headers before extraction */
  map?: (header: TarHeader) => TarHeader;
}
```

### Filesystem Types

```typescript
interface PackOptionsFS {
  /** Follow symlinks instead of archiving them as symlinks (default: false) */
  dereference?: boolean;
  /** Filter function to determine which files to include (uses Node.js fs.Stats) */
  filter?: (path: string, stat: Stats) => boolean;
  /** Transform function to modify headers before packing */
  map?: (header: TarHeader) => TarHeader;
}

// Source types for packTarSources function
interface FileSource {
  type: "file";
  /** Path to the source file on the local filesystem */
  source: string;
  /** Destination path inside the tar archive */
  target: string;
}

interface DirectorySource {
  type: "directory";
  /** Path to the source directory on the local filesystem */
  source: string;
  /** Destination path inside the tar archive */
  target: string;
}

interface ContentSource {
  type: "content";
  /** Raw content to add. Supports string, Uint8Array, ArrayBuffer, ReadableStream, Blob, or null. */
	content: TarEntryData;
  /** Destination path inside the tar archive */
  target: string;
  /** Optional Unix file permissions (e.g., 0o644, 0o755) */
  mode?: number;
}

type TarSource = FileSource | DirectorySource | ContentSource;

interface UnpackOptionsFS extends UnpackOptions {
  // Inherited from UnpackOptions (platform-neutral):
  /** Number of leading path components to strip from entry names */
  strip?: number;
  /** Filter function to determine which entries to extract */
  filter?: (header: TarHeader) => boolean;
  /** Transform function to modify headers before extraction */
  map?: (header: TarHeader) => TarHeader;

  // Filesystem-specific options:
  /** Default mode for created directories (e.g., 0o755). Overrides tar header mode */
  dmode?: number;
  /** Default mode for created files (e.g., 0o644). Overrides tar header mode */
  fmode?: number;
  /**
   * Prevent symlinks from pointing outside the extraction directory.
   * @default true
   */
  validateSymlinks?: boolean;
  /**
   * The maximum depth of paths to extract. Prevents Denial of Service (DoS) attacks
   * from malicious archives with deeply nested directories.
   *
   * Set to `Infinity` to disable depth checking (not recommended for untrusted archives).
   * @default 1024
   */
  maxDepth?: number;
}
```

## Compatibility

The core library uses the [Web Streams API](https://caniuse.com/streams) and requires:

- **Node.js**: 18.0+
- **Browsers**: Modern browsers with Web Streams support
  - Chrome 71+
  - Firefox 102+
  - Safari 14.1+
  - Edge 79+

## Acknowledgements

- [`tar-stream`](https://github.com/mafintosh/tar-stream) and [`tar-fs`](https://github.com/mafintosh/tar-fs) - For the inspiration and test fixtures.

## License

MIT
