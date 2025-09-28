# Benchmarks

These are informal benchmarks comparing the performance of `modern-tar` against other popular tar libraries in Node.js. The usecase is for debugging and general reference, not for rigorous performance analysis.

## Libraries Compared

- [`modern-tar`](https://github.com/ayuhito/modern-tar)
- [`node-tar`](https://github.com/isaacs/node-tar)
- [`tar-fs`](https://github.com/mafintosh/tar-fs)

## Benchmark Scenarios

### Packing (Creating Archives)
- **Many Small Files**: 5,000 files × 1KB each (~5MB total)
- **Few Large Files**: 5 files × 20MB each (~100MB total)

### Unpacking (Extracting Archives)
- **Many Small Files**: Extract 5,000 × 1KB files
- **Few Large Files**: Extract 5 × 20MB files

## Usage

### Setup

The benchmarks use **npm** for a pure Node environment:

```bash
cd benchmarks
npm install
```

### Running Benchmarks

```bash
# Run all benchmarks
npm run bench
```
## Recent Results

These benchmarks were run on an Apple M3 Pro. Results should only be used to compare relative performance rather than absolute numbers.

| Scenario | modern-tar | node-tar | tar-fs |
|----------|-----------|-------------|-------------|
| **Pack Small Files** | 2 ops/s | 7 ops/s | 4 ops/s |
| **Pack Large Files** | 36 ops/s | 95 ops/s | 35 ops/s |
| **Unpack Small Files** | 1 ops/s | 4 ops/s | 1 ops/s |
| **Unpack Large Files** | 21 ops/s | 32 ops/s | 27 ops/s |

`modern-tar` is expected to be slower than alternatives due to its focus on zero dependencies, but there is still plenty of room to improve performance.
