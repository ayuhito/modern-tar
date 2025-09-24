# 🗄️ modern-tar

Zero-dependency, cross-platform, streaming tar archive library for every JavaScript runtime. Built with the browser-native Web Streams API for performance and memory efficiency.

## Features

- 🚀 **Streaming Architecture** - Supports large archives without loading everything into memory
- 📋 **Standards Compliant** - Full USTAR format support with PAX extensions. Compatible with GNU tar, BSD tar, and other standard implementations
- 🗜️ **Compression** - Includes helpers for gzip compression/decompression
- 📝 **TypeScript First** - Full type safety with detailed TypeDoc documentation
- ⚡ **Zero Dependencies** - No external dependencies, minimal bundle size
- 🌐 **Cross-Platform** - Works in browsers, Node.js, Cloudflare Workers, and other JavaScript runtimes
- 📁 **Node.js Integration** - Additional high-level APIs for directory packing and extraction

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Web Streams (Universal)](#web-streams-universal)
  - [Node.js Filesystem](#nodejs-filesystem)
- [Usage Examples](#usage-examples)
  - [Simple Archive Creation](#simple-archive-creation)
  - [Streaming Archives](#streaming-archives)
  - [Directory Packing (Node.js)](#directory-packing-nodejs)
  - [Compression/Decompression](#compressiondecompression)
  - [Filtering and Transformation](#filtering-and-transformation)
- [API Reference](#api-reference)
  - [Web Streams API (Universal)](#web-streams-api-universal)
  - [Node.js Filesystem API](#nodejs-filesystem-api)
- [Types](#types)
- [Browser Support](#browser-support)
- [Acknowledgements](#acknowledgements)
- [License](#license)



## Installation

```bash
npm install modern-tar
```

## Quick Start

### Web Streams (Universal)

Works in all JavaScript environments including browsers, Node.js, Cloudflare Workers, and more.

```typescript
import { packTar, unpackTar } from 'modern-tar';

// Pack entries into tar buffer
const entries = [
  { header: { name: "hello.txt", size: 5 }, body: "hello" },
  { header: { name: "world.txt", size: 5 }, body: "world" }
];
const tarBuffer = await packTar(entries);

// Unpack tar buffer
const extracted = await unpackTar(tarBuffer);
console.log(extracted[0].header.name); // "hello.txt"
```

### Node.js Filesystem

High-level APIs for working with directories and files on disk using Node Streams.

```typescript
import { packDirectory, unpackToDirectory } from 'modern-tar/fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Pack directory to tar file
const tarStream = packDirectory('/my/directory');
await pipeline(tarStream, createWriteStream('archive.tar'));

// Extract tar file to directory
const extractStream = unpackToDirectory('/output/directory');
await pipeline(createReadStream('archive.tar'), extractStream);
```

## Usage Examples

### Simple Archive Creation

```typescript
import { packTar, unpackTar } from 'modern-tar';

// Create entries with different content types
const entries = [
  { header: { name: "file.txt", size: 5 }, body: "hello" },
  { header: { name: "dir/", type: "directory", size: 0 } },
  { header: { name: "dir/nested.txt", size: 3 }, body: new Uint8Array([97, 98, 99]) }, // "abc"
  { header: { name: "binary.dat", size: 4 }, body: new ArrayBuffer(4) }
];

const tarBuffer = await packTar(entries);

// Extract all entries
for await (const entry of unpackTar(tarBuffer)) {
  console.log(`File: ${entry.header.name}`);
  const content = new TextDecoder().decode(entry.data);
  console.log(`Content: ${content}`);
}
```

### Streaming Archives

```typescript
import { createTarPacker, createTarDecoder } from 'modern-tar';

// Create a tar packer for dynamic content
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

// Finalize the archive
controller.finalize();

// Decode the stream
const decoder = createTarDecoder();
const decodedStream = readable.pipeThrough(decoder);
for await (const entry of decodedStream) {
  console.log(`Decoded: ${entry.header.name}`);
  // Process entry.body stream as needed
}
```

### Directory Packing (Node.js)

```typescript
import { packDirectory, unpackToDirectory } from 'modern-tar/fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Pack with filtering and options
const tarStream = packDirectory('./my/project', {
  filter: (filePath, stats) => !filePath.includes('node_modules'),
  map: (header) => ({ ...header, mode: 0o644 }), // Set all files to 644
  dereference: true // Follow symlinks instead of archiving them
});

await pipeline(tarStream, createWriteStream('./project.tar'));

// Extract with options
const extractStream = unpackToDirectory('./output', {
  strip: 1, // Remove first directory level
  filter: (header) => header.name.endsWith('.js'), // Only extract JS files
  fmode: 0o644, // Override file permissions
  dmode: 0o755  // Override directory permissions
});

await pipeline(createReadStream('./project.tar'), extractStream);
```

### Compression/Decompression

```typescript
import { createGzipEncoder, createGzipDecoder, unpackTar } from 'modern-tar';

// Compress a tar stream to .tar.gz
const { readable, controller } = createTarPacker();
// ... add entries ...
controller.finalize();
const compressedStream = readable.pipeThrough(createGzipEncoder());

// Decompress .tar.gz and extract
const response = await fetch('https://example.com/archive.tar.gz');
if (!response.body) throw new Error('No response body');

const tarStream = response.body.pipeThrough(createGzipDecoder());
for await (const entry of unpackTar(tarStream)) {
  console.log(`Extracted: ${entry.header.name}`);
}
```

### Filtering and Transformation

```typescript
import { unpackTar } from 'modern-tar';

// Extract with filtering and path transformation
const entries = await unpackTar(tarBuffer, {
  strip: 2, // Remove first 2 path components
  filter: (header) => {
    // Only extract specific file types
    return header.type === 'file' &&
           (header.name.endsWith('.js') || header.name.endsWith('.json'));
  },
  map: (header) => ({
    ...header,
    name: `extracted/${header.name}`, // Add prefix to all paths
    mode: 0o644 // Normalize permissions
  })
});
```

## API Reference

### Web Streams API (Universal)

Works in all JavaScript environments.

#### `packTar(entries: TarEntry[]): Promise<Uint8Array>`

Pack an array of entries into a tar archive buffer.

**Parameters:**
- `entries` - Array of `TarEntry` objects to pack

**Returns:** Promise resolving to complete tar archive as Uint8Array

#### `unpackTar(archive: ArrayBuffer | Uint8Array, options?: UnpackOptions): Promise<ParsedTarEntryWithData[]>`

Extract all entries from a tar archive buffer.

**Parameters:**
- `archive` - Complete tar archive as ArrayBuffer or Uint8Array
- `options` - Optional extraction configuration

**Returns:** Promise resolving to array of entries with buffered data

#### `createTarPacker(): { readable, controller }`

Create a streaming tar packer for dynamic entry creation.

**Returns:**
- `readable` - ReadableStream outputting tar archive bytes
- `controller` - TarPackController for adding entries

#### `createTarDecoder(): TransformStream<Uint8Array, ParsedTarEntry>`

Create a transform stream that parses tar bytes into entries.

#### `createTarOptionsTransformer(options?: UnpackOptions): TransformStream<ParsedTarEntry, ParsedTarEntry>`

Create a transform stream that applies unpacking options to tar entries.

#### `createGzipEncoder(): CompressionStream`

Create a gzip compression stream for tar.gz creation.

#### `createGzipDecoder(): DecompressionStream`

Create a gzip decompression stream for tar.gz extraction.

### Node.js Filesystem API

Available via `modern-tar/fs` import. Requires Node.js 18.0+.

#### `packDirectory(directoryPath: string, options?: PackOptionsFS): Readable`

Pack a directory into a Node.js Readable stream containing tar archive bytes.

**Parameters:**
- `directoryPath` - Path to directory to pack
- `options` - Optional packing configuration

**Returns:** Node.js `Readable` stream of tar archive bytes

#### `unpackToDirectory(directoryPath: string, options?: UnpackOptionsFS): Writable`

Extract a tar archive to a directory.

**Parameters:**
- `directoryPath` - Path to directory where files will be extracted
- `options` - Optional extraction configuration

**Returns:** Node.js `Writable` stream to pipe tar archive bytes into

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
  /** Number of leading path components to strip from entry names */
  strip?: number;
  /** Filter function to include/exclude entries (return false to skip) */
  filter?: (header: TarHeader) => boolean;
  /** Transform function to modify tar headers before extraction */
  map?: (header: TarHeader) => TarHeader;
}
```

### PackOptionsFS

Filesystem-specific configuration options for packing directories (Node.js only).

```typescript
interface PackOptionsFS {
  /** Follow symlinks instead of archiving them as symlinks (default: false) */
  dereference?: boolean;
  /** Filter function to determine which files to include */
  filter?: (path: string, stat: Stats) => boolean;
  /** Transform function to modify headers before packing */
  map?: (header: TarHeader) => TarHeader;
}
```

### UnpackOptionsFS

Extends `UnpackOptions` with filesystem-specific options (Node.js only).

```typescript
interface UnpackOptionsFS extends UnpackOptions {
  /** Default mode for created directories (e.g., 0o755) */
  dmode?: number;
  /** Default mode for created files (e.g., 0o644) */
  fmode?: number;
  /** Prevent symlinks from pointing outside the extraction directory (default: true) */
  validateSymlinks?: boolean;
}
```

## Browser Support

This library uses the [Web Streams API](https://caniuse.com/streams) and requires:

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
