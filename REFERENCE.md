# 🗄️ modern-tar API Reference

## Core API (`modern-tar`)

### `packTar(entries: TarEntry[]): Promise<Uint8Array>`

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

### `unpackTar(archive: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>, options?: UnpackOptions): Promise<ParsedTarEntryWithData[]>`

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

### `createTarPacker(): { readable, controller }`

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

### `createTarDecoder(options?: DecoderOptions): TransformStream<Uint8Array, ParsedTarEntry>`

Create a transform stream that parses tar bytes into entries.

- **`options`**: Optional decoder configuration (see `DecoderOptions`).
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

### `createGzipEncoder(): CompressionStream`

Create a gzip compression stream for `.tar.gz` creation.

**Example:**

```typescript
const tarStream = /* ... */;
const compressedStream = tarStream.pipeThrough(createGzipEncoder());
```

### `createGzipDecoder(): DecompressionStream`

Create a gzip decompression stream for `.tar.gz` extraction.

**Example:**

```typescript
const gzipStream = /* ... */;
const tarStream = gzipStream.pipeThrough(createGzipDecoder());
```

## Node.js Filesystem API (`modern-tar/fs`)

### `packTar(sources: string | TarSource[], options?: PackOptionsFS): Readable`

Pack a directory or multiple sources into a Node.js Readable stream containing tar archive bytes.

- **`sources`**: Either a directory path string or an array of `TarSource` objects.
- **`options`**: Optional packing configuration (see `PackOptionsFS`).
- **Returns**: Node.js `Readable` stream of tar archive bytes.

**Example:**

```typescript
import { packTar } from 'modern-tar/fs';

// Pack a directory
const tarStream = packTar('/home/user/project', {
  dereference: true,  // Follow symlinks
  filter: (path, stats) => !path.includes('tmp'),
});

// Pack multiple sources
const sources = [
  { type: 'file', source: './package.json', target: 'project/package.json' },
  { type: 'directory', source: './src', target: 'project/src' },
  { type: 'content', content: 'Hello World!', target: 'project/hello.txt' },
  { type: 'content', content: new Uint8Array([1, 2, 3]), target: 'project/binary.dat' },
  { type: 'stream', content: createReadStream('./large-file.bin'), target: 'project/data.bin', size: 1048576 },
  { type: 'stream', content: fetch('/api/data').then(r => r.body!), target: 'project/remote.json', size: 2048 }
];
const archiveStream = packTar(sources);
```

### `unpackTar(directoryPath: string, options?: UnpackOptionsFS): Writable`

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
  strict: true, // Enable strict validation
  streamTimeout: 10000, // Timeout after 10 seconds of inactivity
});
await pipeline(tarStream, extractStream);
```



## Types

### Core Types

```typescript
// Union type for entry body data that can be packed into a tar archive
type TarEntryData = string | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array> | Blob | null | undefined;

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
  body?: TarEntryData;
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
interface DecoderOptions {
  /** Enable strict validation (e.g., throw on invalid checksums) */
  strict?: boolean;
}

interface UnpackOptions extends DecoderOptions {
  /** Number of leading path components to strip from entry names (e.g., strip: 1 removes first directory) */
  strip?: number;
  /** Filter function to include/exclude entries (return false to skip) */
  filter?: (header: TarHeader) => boolean;
  /** Transform function to modify tar headers before extraction */
  map?: (header: TarHeader) => TarHeader;
  /**
   * The number of milliseconds of inactivity before a stream is considered stalled.
   * Prevents hangs when processing corrupted or incomplete archives.
   * @default 5000
   */
  streamTimeout?: number;
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

// Base interface for all source types
interface BaseSource {
  /** Destination path for the entry inside the tar archive */
  target: string;
  /** Optional modification time. Overrides filesystem values or defaults to current time. */
  mtime?: Date;
  /** Optional user ID. Overrides filesystem values or defaults to 0. */
  uid?: number;
  /** Optional group ID. Overrides filesystem values or defaults to 0. */
  gid?: number;
  /** Optional user name. */
  uname?: string;
  /** Optional group name. */
  gname?: string;
  /** Optional Unix file permissions for the entry (e.g., 0o644, 0o755). */
  mode?: number;
}

// Source types for packTar function
interface FileSource extends BaseSource {
  type: "file";
  /** Path to the source file on the local filesystem */
  source: string;
}

interface DirectorySource extends BaseSource {
  type: "directory";
  /** Path to the source directory on the local filesystem */
  source: string;
}

interface ContentSource extends BaseSource {
  type: "content";
  /** Raw content to add. Supports string, Uint8Array, ArrayBuffer, ReadableStream, Blob, or null. */
  content: TarEntryData;
}

interface StreamSource extends BaseSource {
  type: "stream";
  /** A Node.js Readable stream or Web ReadableStream. */
  content: Readable | ReadableStream;
  /** The total size of the stream's content in bytes. This is required for streams to prevent hanging. */
  size: number;
}

type TarSource = FileSource | DirectorySource | ContentSource | StreamSource;

interface UnpackOptionsFS extends UnpackOptions {
  // Inherited from UnpackOptions (platform-neutral):
  /** Number of leading path components to strip from entry names */
  strip?: number;
  /** Filter function to determine which entries to extract */
  filter?: (header: TarHeader) => boolean;
  /** Transform function to modify headers before extraction */
  map?: (header: TarHeader) => TarHeader;
  /** Stream timeout in milliseconds for detecting stalled streams */
  streamTimeout?: number;

  // Filesystem-specific options:
  /** Default mode for created directories (e.g., 0o755). Overrides tar header mode */
  dmode?: number;
  /** Default mode for created files (e.g., 0o644). Overrides tar header mode */
  fmode?: number;
  /**
   * The maximum depth of paths to extract. Prevents Denial of Service (DoS) attacks
   * from malicious archives with deeply nested directories.
   *
   * Set to `Infinity` to disable depth checking (not recommended for untrusted archives).
   * @default 1024
   */
  maxDepth?: number;
  /**
   * Maximum number of concurrent filesystem operations during extraction.
   * @default os.cpus().length || 8
   */
  concurrency?: number;
}
```
