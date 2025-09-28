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

### Packing Benchmarks

```sh
--- Many Small Files (5000 x 1KB) ---
┌─────────┬─────────────────────────────────────────────┬─────────────────────┬───────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                   │ Latency avg (ns)    │ Latency med (ns)      │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼─────────────────────────────────────────────┼─────────────────────┼───────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'modern-tar: Many Small Files (5000 x 1KB)' │ '431119167 ± 0.92%' │ '433848020 ± 8148666' │ '2 ± 0.92%'            │ '2 ± 0'                │ 28      │
│ 1       │ 'node-tar: Many Small Files (5000 x 1KB)'   │ '141060813 ± 1.01%' │ '138085333 ± 2011021' │ '7 ± 0.95%'            │ '7 ± 0'                │ 86      │
│ 2       │ 'tar-fs: Many Small Files (5000 x 1KB)'     │ '268886652 ± 0.91%' │ '264498292 ± 2249708' │ '4 ± 0.88%'            │ '4 ± 0'                │ 45      │
└─────────┴─────────────────────────────────────────────┴─────────────────────┴───────────────────────┴────────────────────────┴────────────────────────┴─────────┘

--- Few Large Files (5 x 20MB) ---
┌─────────┬──────────────────────────────────────────┬────────────────────┬─────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                │ Latency avg (ns)   │ Latency med (ns)    │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼──────────────────────────────────────────┼────────────────────┼─────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'modern-tar: Few Large Files (5 x 20MB)' │ '27057135 ± 0.35%' │ '26996229 ± 745500' │ '37 ± 0.34%'           │ '37 ± 1'               │ 444     │
│ 1       │ 'node-tar: Few Large Files (5 x 20MB)'   │ '9219378 ± 0.34%'  │ '9041292 ± 222687'  │ '109 ± 0.30%'          │ '111 ± 3'              │ 1302    │
│ 2       │ 'tar-fs: Few Large Files (5 x 20MB)'     │ '26714449 ± 0.35%' │ '26696041 ± 621834' │ '37 ± 0.33%'           │ '37 ± 1'               │ 450     │
└─────────┴──────────────────────────────────────────┴────────────────────┴─────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

### Unpacking Benchmarks

```sh
--- Unpack Many Small Files ---
┌─────────┬───────────────────────────────────────┬─────────────────────┬────────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                             │ Latency avg (ns)    │ Latency med (ns)       │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────┼─────────────────────┼────────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'modern-tar: Unpack Many Small Files' │ '663796077 ± 1.65%' │ '658891333 ± 10497041' │ '2 ± 1.66%'            │ '2 ± 0'                │ 25      │
│ 1       │ 'node-tar: Unpack Many Small Files'   │ '242909126 ± 4.12%' │ '224330229 ± 10243833' │ '4 ± 3.70%'            │ '4 ± 0'                │ 50      │
│ 2       │ 'tar-fs: Unpack Many Small Files'     │ '715292192 ± 2.35%' │ '712292750 ± 27672750' │ '1 ± 2.32%'            │ '1 ± 0'                │ 25      │
└─────────┴───────────────────────────────────────┴─────────────────────┴────────────────────────┴────────────────────────┴────────────────────────┴─────────┘

--- Unpack Few Large Files ---
┌─────────┬──────────────────────────────────────┬────────────────────┬──────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                            │ Latency avg (ns)   │ Latency med (ns)     │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼──────────────────────────────────────┼────────────────────┼──────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'modern-tar: Unpack Few Large Files' │ '48420410 ± 4.40%' │ '44215104 ± 1654980' │ '22 ± 1.91%'           │ '23 ± 1'               │ 248     │
│ 1       │ 'node-tar: Unpack Few Large Files'   │ '38777230 ± 9.50%' │ '26149666 ± 1833708' │ '33 ± 3.37%'           │ '38 ± 3'               │ 310     │
│ 2       │ 'tar-fs: Unpack Few Large Files'     │ '41593615 ± 6.92%' │ '33377333 ± 1521583' │ '28 ± 2.74%'           │ '30 ± 1'               │ 289     │
└─────────┴──────────────────────────────────────┴────────────────────┴──────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

`modern-tar` is expected to be slower than alternatives due to its focus on zero dependencies, but there is still plenty of room to improve performance.
