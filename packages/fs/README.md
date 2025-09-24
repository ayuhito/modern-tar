# @modern-tar/fs

Node.js filesystem utilities for `@modern-tar/core`. High-level APIs for packing directories into tar archives and extracting archives to the filesystem with streaming performance.

## Features

- 📁 **Directory Packing** - Pack entire directories with a single function call.
- 🔗 **Full Link Support** - Handles symlinks and hardlinks correctly.
- 🎛️ **Flexible Filtering** - Filter and transform entries during pack/unpack.
- ⚡ **Built on Streams** - Uses Node.js streams for optimal memory-efficient performance.
- 📝 **TypeScript First** - Full type safety with detailed TypeDoc documentation.

## Installation

```bash
npm install @modern-tar/fs
```

## Usage

### Simple APIs

```typescript
import { packTar, unpackTar } from '@modern-tar/fs';
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

### Filtering and Transformation

```typescript
import { packTar, unpackTar } from '@modern-tar/fs';

// Pack with filtering
const tarStream = packTar('./my/project', {
	filter: (filePath, stats) => !filePath.includes('node_modules'),
	map: (header) => ({ ...header, mode: 0o644 }) // Set all files to 644
});
```

```typescript

import { unpackTar } from '@modern-tar/fs';
import { createReadStream } from 'node:fs';

import { pipeline } from 'node:stream/promises';

// Extract with path stripping
const tarStream = createReadStream('./archive.tar');
const extractStream = unpackTar('./output', {
	strip: 1, // Remove first directory level
	filter: (header) => header.name.endsWith('.js') // Only extract JS files
});

await pipeline(tarStream, extractStream);
```

### Compression/Decompression (gzip)

```typescript
import { unpackTar } from '@modern-tar/fs';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';

await pipeline(res.body, zlib.createGunzip(), unpackTar('/extracted'));
```

## API Reference

### `packTar(directoryPath, options?): Readable`

Pack a directory into a Node.js Readable stream containing tar archive bytes.

**Parameters:**
- `directoryPath: string` - Path to directory to pack
- `options?: PackOptions` - Optional packing configuration

**Returns:** Node.js `Readable` stream of tar archive bytes

**Example:**
```typescript
import { packTar } from '@modern-tar/fs';

const tarStream = packTar('/home/user/project', {
  dereference: true,  // Follow symlinks
  filter: (path, stats) => !path.includes('tmp'),
  map: (header) => ({ ...header, mode: 0o644 })
});
```

### `unpackTar(directoryPath, options?): Writable`

Extract a tar archive to a directory.

**Parameters:**
- `directoryPath: string` - Path to directory where files will be extracted
- `options?: UnpackOptions` - Optional extraction configuration

**Returns:** Node.js `Writable` stream to pipe tar archive bytes into

**Example:**
```typescript
import { unpackTar } from '@modern-tar/fs';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const tarStream = createReadStream('backup.tar');
const extractStream = unpackTar('/restore/location', {
  strip: 2,  // Remove first 2 path components
  filter: (header) => header.type === 'file'
});
await pipeline(tarStream, extractStream);
```

### `web`

Namespace containing all APIs from [`@modern-tar/core`](../core) for Web Streams compatibility.

**Example:**
```typescript
import { web } from '@modern-tar/fs';

// Use core Web Streams APIs
const { readable, controller } = web.createTarPacker();
const decoder = web.createTarDecoder();
const gzipEncoder = web.createGzipEncoder();
```

## Types

### PackOptions

```typescript
interface PackOptions {
  /** Follow symlinks instead of archiving them as symlinks */
  dereference?: boolean;
  /** Filter function to determine which files to include */
  filter?: (path: string, stat: Stats) => boolean;
  /** Transform function to modify headers before packing */
  map?: (header: TarHeader) => TarHeader;
}
```

### UnpackOptions

```typescript
interface UnpackOptions {
  /** Number of leading path components to strip from entry names */
  strip?: number;
  /** Filter function to determine which entries to extract */
  filter?: (header: TarHeader) => boolean;
  /** Transform function to modify headers before extraction */
  map?: (header: TarHeader) => TarHeader;
}
```

## Common Use Cases

### Backup and Restore

```typescript
import { packTar, unpackTar } from '@modern-tar/fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Backup a directory
async function backup(sourceDir: string, archivePath: string) {
  const tarStream = packTar(sourceDir, {
    filter: (path) => !path.includes('.cache')
  });
  await pipeline(tarStream, createWriteStream(archivePath));
}

// Restore from backup
async function restore(archivePath: string, targetDir: string) {
  const tarStream = createReadStream(archivePath);
  const extractStream = unpackTar(targetDir);
  await pipeline(tarStream, extractStream);
}
```

### Build Artifacts

```typescript
import { packTar, web } from '@modern-tar/fs';
import { Readable } from 'node:stream';

// Create deployment package
async function createDeploymentPackage(buildDir: string): Promise<Uint8Array> {
  const tarStream = packTar(buildDir, {
    filter: (path, stats) => {
      // Only include production files
      return !path.includes('test') && !path.includes('.map');
    }
  });

  // Compress for deployment
  const compressed = tarStream.pipeThrough(web.createGzipEncoder());

  // Convert to buffer
  const response = new Response(compressed);
  return new Uint8Array(await response.arrayBuffer());
}
```

## Node.js Compatibility

This package is designed for Node.js environments and requires:

- **Node.js**: 18.0+

For browser only environments, use `@modern-tar/core` directly with the Web Streams API. This package is not suitable for browser use.

## License

MIT
