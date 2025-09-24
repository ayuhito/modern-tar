# 🗄 @modern-tar

Zero-dependency, cross-platform, streaming tar archive library for every JavaScript runtime. Built with the browser-native Web Streams API for performance and memory efficiency.

## Packages

- **[@modern-tar/core](packages/core)** - Core streaming tar archive library with Web Streams API. Works in browsers, Node.js, Cloudflare Workers, and other JavaScript runtimes.
- **[@modern-tar/fs](packages/fs)** - Node.js filesystem utilities for high-level directory packing and extraction.

## Why?

- 🚀 **Streaming Architecture** - Supports large archives without loading everything into memory.
- 📋 **Standards Compliant** -
Full USTAR format support with PAX extensions. Compatible with GNU tar, BSD tar, and other standard implementations.
- 🗜️ **Compression** - Includes helpers for gzip compression/decompression.
- 📝 **TypeScript First** - Full type safety with detailed TypeDoc documentation.
- ⚡ **Zero Dependencies** - No external dependencies for core, minimal bundle size.
- 🌐 **Cross-Platform** - Works in browsers, Node.js, Cloudflare Workers, and other JavaScript runtimes.

## Quick Start

### Core Package (Web Streams)

```typescript
import { packTar, unpackTar } from '@modern-tar/core';

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

### FS Package (Node.js Streams)

```typescript
import { packTar, unpackTar } from '@modern-tar/fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Pack directory to tar file
const tarStream = packTar('/my/directory');
await pipeline(tarStream, createWriteStream('archive.tar'));

// Extract tar file to directory
const extractStream = unpackTar('/output/directory');
await pipeline(createReadStream('archive.tar'), extractStream);
```

## Acknowledgements

- [`tar-stream`](https://github.com/mafintosh/tar-stream) and [`tar-fs`](https://github.com/mafintosh/tar-fs) - For the inspiration and test fixtures.

## License

MIT
