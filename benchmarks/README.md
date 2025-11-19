# Benchmarks

These are informal benchmarks comparing the performance of `modern-tar` against other popular tar libraries in Node.js. The usecase is for debugging and general reference, not for rigorous performance analysis.

## Libraries Compared

- [`modern-tar`](https://github.com/ayuhito/modern-tar)
- [`node-tar`](https://github.com/isaacs/node-tar)
- [`tar-fs`](https://github.com/mafintosh/tar-fs)

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

These benchmarks were run on an Apple M3 Pro and can include a lot of noise due to the heavy I/O bound nature of this workload. Results should only be used to compare relative performance rather than absolute numbers.

### Packing Benchmarks

```sh
clk: ~3.95 GHz
cpu: Apple M3 Pro
runtime: node 24.11.0 (arm64-darwin)

benchmark                   avg (min … max) p75 / p99    (min … top 1%)
------------------------------------------- -------------------------------
• Many Small Files (2500 x 1KB)
------------------------------------------- -------------------------------
modern-tar: Many Small Fil..  75.85 ms/iter  75.97 ms █  ▃    █
                      (74.30 ms … 79.61 ms)  78.30 ms █▆▁█▁▁▁▆█▁▆▁▁▆▁▁▁▁▁▁▆
                  gc(  1.10 ms …   1.84 ms)   5.81 mb (951.08 kb…  9.46 mb)

node-tar: Many Small Files.. 107.29 ms/iter 106.49 ms    █
                    (105.36 ms … 114.68 ms) 109.82 ms ▆▆▆█▁▆▁▁▁▁▁▁▁▁▁▁▁▁▁▁▆
                  gc(  1.21 ms …   1.71 ms)  44.22 mb ( 42.62 mb… 48.09 mb)

tar-fs: Many Small Files (.. 198.58 ms/iter 200.06 ms █    █ █
                    (194.45 ms … 206.50 ms) 203.58 ms █▁▁▁████▁▁▁▁█▁▁█▁▁▁▁█
                  gc(  1.26 ms …   1.77 ms)  15.68 mb ( 14.88 mb… 16.62 mb)

                             ┌                                            ┐
modern-tar: Many Small Fil.. ┤ 75.85 ms
node-tar: Many Small Files.. ┤■■■■■■■■■ 107.29 ms
tar-fs: Many Small Files (.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 198.58 ms
                             └                                            ┘

summary
  modern-tar: Many Small Files (2500 x 1KB)
   1.41x faster than node-tar: Many Small Files (2500 x 1KB)
   2.62x faster than tar-fs: Many Small Files (2500 x 1KB)

• Many Small Nested Files (2500 x 1KB)
------------------------------------------- -------------------------------
modern-tar: Many Small Nes..  77.90 ms/iter  78.14 ms        █  █         █
                      (77.09 ms … 78.80 ms)  78.59 ms █▁██▁█▁█▁▁█▁█▁█▁▁▁█▁█
                  gc(  1.18 ms …   2.72 ms)   5.43 mb (  1.23 mb…  9.16 mb)

node-tar: Many Small Neste.. 118.54 ms/iter 116.14 ms    █
                    (112.85 ms … 134.20 ms) 134.08 ms ██▅█▁▁▁▁▅▁▁▁▁▁▁▁▁▁▁▁▅
                  gc(  1.26 ms …   2.37 ms)  45.25 mb ( 42.98 mb… 47.85 mb)

tar-fs: Many Small Nested .. 209.45 ms/iter 212.03 ms      █     █ █
                    (195.33 ms … 221.31 ms) 221.21 ms █▁▁▁▁█▁█▁▁██▁█▁▁▁█▁▁█
                  gc(  1.28 ms …   3.23 ms)  19.01 mb ( 18.08 mb… 19.92 mb)

                             ┌                                            ┐
modern-tar: Many Small Nes.. ┤ 77.90 ms
node-tar: Many Small Neste.. ┤■■■■■■■■■■■ 118.54 ms
tar-fs: Many Small Nested .. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 209.45 ms
                             └                                            ┘

summary
  modern-tar: Many Small Nested Files (2500 x 1KB)
   1.52x faster than node-tar: Many Small Nested Files (2500 x 1KB)
   2.69x faster than tar-fs: Many Small Nested Files (2500 x 1KB)

• Few Large Files (5 x 20MB)
------------------------------------------- -------------------------------
modern-tar: Few Large File..  25.10 ms/iter  22.53 ms  █
                      (19.55 ms … 83.54 ms)  51.60 ms ██▃▃▃▁▂▃▁▁▁▂▁▁▁▁▂▁▁▁▂
                  gc(  1.08 ms …   2.37 ms) 152.79 kb (  4.20 kb…467.24 kb)

node-tar: Few Large Files ..  22.45 ms/iter  20.43 ms █
                      (19.61 ms … 59.11 ms)  53.12 ms █▃▃▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
                  gc(  1.21 ms …   2.29 ms)  73.07 kb ( 28.29 kb…159.42 kb)

tar-fs: Few Large Files (5..  44.13 ms/iter  45.68 ms █  █ █ █ █    █
                      (41.25 ms … 47.68 ms)  47.66 ms ████████▁███▁██▁███▁█
                  gc(  1.15 ms …   1.75 ms) 194.86 kb ( 38.34 kb…553.30 kb)

                             ┌                                            ┐
modern-tar: Few Large File.. ┤■■■■ 25.10 ms
node-tar: Few Large Files .. ┤ 22.45 ms
tar-fs: Few Large Files (5.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 44.13 ms
                             └                                            ┘

summary
  node-tar: Few Large Files (5 x 20MB)
   1.12x faster than modern-tar: Few Large Files (5 x 20MB)
   1.97x faster than tar-fs: Few Large Files (5 x 20MB)

• Huge Files (2 x 1GB)
------------------------------------------- -------------------------------
modern-tar: Huge Files (2 .. 827.32 ms/iter 724.95 ms █
                       (701.90 ms … 1.64 s)    1.15 s █▅▁▃▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▃
                  gc(  1.83 ms …   6.85 ms)   2.31 mb ( 60.71 kb…  4.44 mb)

node-tar: Huge Files (2 x .. 859.22 ms/iter 826.17 ms    █
                       (619.76 ms … 1.59 s)    1.17 s ▄▁▁█▇▁▁▁▄▁▁▁▁▁▁▁▁▁▁▄▄
                  gc(  1.19 ms …   6.24 ms)  65.29 kb ( 42.09 kb… 77.27 kb)

tar-fs: Huge Files (2 x 1GB)    1.11 s/iter    1.71 s █
                       (762.14 ms … 1.97 s)    1.74 s █▆▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▄▆
                  gc(  1.27 ms …   7.70 ms) 250.64 kb (117.95 kb…535.49 kb)

                             ┌                                            ┐
modern-tar: Huge Files (2 .. ┤ 827.32 ms
node-tar: Huge Files (2 x .. ┤■■■■ 859.22 ms
tar-fs: Huge Files (2 x 1GB) ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 1.11 s
                             └                                            ┘

summary
  modern-tar: Huge Files (2 x 1GB)
   1.04x faster than node-tar: Huge Files (2 x 1GB)
   1.35x faster than tar-fs: Huge Files (2 x 1GB)
```

### Unpacking Benchmarks

```sh
clk: ~3.94 GHz
cpu: Apple M3 Pro
runtime: node 24.11.0 (arm64-darwin)

benchmark                   avg (min … max) p75 / p99    (min … top 1%)
------------------------------------------- -------------------------------
• Many Small Files (2500 x 1KB)
------------------------------------------- -------------------------------
modern-tar: Many Small Fil.. 225.38 ms/iter 230.68 ms ██  ███  █ █  ███   █
                    (210.50 ms … 250.29 ms) 238.07 ms ██▁▁███▁▁█▁█▁▁███▁▁▁█
                  gc(  1.28 ms …   2.76 ms)  36.11 mb ( 35.05 mb… 37.85 mb)

node-tar: Many Small Files.. 304.50 ms/iter 314.08 ms              █
                    (267.66 ms … 361.91 ms) 341.64 ms █▁█▁▁█████▁▁██▁▁▁▁▁▁█
                  gc(  1.40 ms …   4.19 ms)  42.15 mb ( 41.49 mb… 43.35 mb)

tar-fs: Many Small Files (.. 611.48 ms/iter 614.12 ms        █
                    (545.24 ms … 746.16 ms) 662.45 ms █▁▁▁██▁█▁████▁▁▁▁█▁▁█
                  gc(  1.38 ms …   2.55 ms)   6.14 mb (  4.92 mb…  7.33 mb)

                             ┌                                            ┐
modern-tar: Many Small Fil.. ┤ 225.38 ms
node-tar: Many Small Files.. ┤■■■■■■■ 304.50 ms
tar-fs: Many Small Files (.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 611.48 ms
                             └                                            ┘

summary
  modern-tar: Many Small Files (2500 x 1KB)
   1.35x faster than node-tar: Many Small Files (2500 x 1KB)
   2.71x faster than tar-fs: Many Small Files (2500 x 1KB)

• Many Small Nested Files (2500 x 1KB)
------------------------------------------- -------------------------------
modern-tar: Many Small Nes.. 242.93 ms/iter 246.41 ms   █
                    (230.07 ms … 271.55 ms) 263.11 ms ▆▁█▆▆▁▆▆▁▁▆▆▁▁▁▁▁▁▁▁▆
                  gc(  1.61 ms …   2.78 ms)  41.91 mb ( 41.86 mb… 42.02 mb)

node-tar: Many Small Neste.. 487.35 ms/iter 524.99 ms ██ █  ████  █   █ █ █
                    (418.30 ms … 593.05 ms) 552.16 ms ██▁█▁▁████▁▁█▁▁▁█▁█▁█
                  gc(  1.47 ms …   2.08 ms)  28.74 mb ( 28.35 mb… 29.36 mb)

tar-fs: Many Small Nested .. 678.64 ms/iter 705.91 ms        █
                    (608.13 ms … 743.04 ms) 732.11 ms █▁█▁▁▁▁█▁███▁▁█▁█▁▁██
                  gc(  1.49 ms …   2.42 ms)  23.77 mb ( 22.83 mb… 24.39 mb)

                             ┌                                            ┐
modern-tar: Many Small Nes.. ┤ 242.93 ms
node-tar: Many Small Neste.. ┤■■■■■■■■■■■■■■■■■■■ 487.35 ms
tar-fs: Many Small Nested .. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 678.64 ms
                             └                                            ┘

summary
  modern-tar: Many Small Nested Files (2500 x 1KB)
   2.01x faster than node-tar: Many Small Nested Files (2500 x 1KB)
   2.79x faster than tar-fs: Many Small Nested Files (2500 x 1KB)

• Few Large Files (5 x 20MB)
------------------------------------------- -------------------------------
modern-tar: Few Large File..  25.47 ms/iter  26.23 ms  ▂█▂▅▂▅▅▂▂
                      (22.51 ms … 33.04 ms)  31.11 ms ▇█████████▇▁▄▄▄▄▁▁▁▁▇
                  gc(  1.18 ms …   4.33 ms) 359.89 kb ( 21.45 kb…  1.25 mb)

node-tar: Few Large Files ..  27.63 ms/iter  28.17 ms    ▆▄█▆ ▆
                      (24.64 ms … 34.87 ms)  34.53 ms ▃▅▇████▃█▃▁▁▁▃▁▁▁▃▁▁▃
                  gc(  1.16 ms …   3.77 ms) 300.43 kb ( 38.74 kb…  1.19 mb)

tar-fs: Few Large Files (5..  30.55 ms/iter  31.28 ms    ▂▅ █▂▅▅
                      (27.58 ms … 36.98 ms)  35.82 ms ▄▇▇██▇████▄▇▇▁▄▁▁▁▁▁▄
                  gc(  1.21 ms …   2.30 ms) 418.37 kb ( 50.11 kb…  2.10 mb)

                             ┌                                            ┐
modern-tar: Few Large File.. ┤ 25.47 ms
node-tar: Few Large Files .. ┤■■■■■■■■■■■■■■ 27.63 ms
tar-fs: Few Large Files (5.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 30.55 ms
                             └                                            ┘

summary
  modern-tar: Few Large Files (5 x 20MB)
   1.08x faster than node-tar: Few Large Files (5 x 20MB)
   1.2x faster than tar-fs: Few Large Files (5 x 20MB)

• Huge Files (2 x 1GB)
------------------------------------------- -------------------------------
modern-tar: Huge Files (2 .. 751.08 ms/iter 760.03 ms                  █
                    (650.23 ms … 797.17 ms) 778.76 ms ▄▁▁▁▁▁▁▁▁▁▁▁▁▄▁▄▇█▁▁▄
                  gc(  1.73 ms …   2.80 ms) 440.46 kb ( 54.47 kb…  1.28 mb)

node-tar: Huge Files (2 x ..    1.19 s/iter    1.67 s █▃  ▃
                       (756.69 ms … 2.10 s)    1.85 s ██▁▁█▁▆▁▁▁▁▁▁▁▁▁▁▆▁▆▆
                  gc(  2.09 ms …   8.31 ms) 163.66 kb ( 97.74 kb…235.93 kb)

tar-fs: Huge Files (2 x 1GB)    1.43 s/iter    1.80 s               █
                       (745.41 ms … 2.23 s)    2.22 s ██████▁▁▁▁▁▁▁██▁█▁▁▁█
                  gc(  2.02 ms …   8.61 ms) 201.95 kb (150.86 kb…360.47 kb)

                             ┌                                            ┐
modern-tar: Huge Files (2 .. ┤ 751.08 ms
node-tar: Huge Files (2 x .. ┤■■■■■■■■■■■■■■■■■■■■■■ 1.19 s
tar-fs: Huge Files (2 x 1GB) ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 1.43 s
                             └                                            ┘

summary
  modern-tar: Huge Files (2 x 1GB)
   1.59x faster than node-tar: Huge Files (2 x 1GB)
   1.91x faster than tar-fs: Huge Files (2 x 1GB)

• Linked Small Files (500 packages, symlinks + hardlinks)
------------------------------------------- -------------------------------
modern-tar: Linked Small F..    1.33 s/iter    1.35 s        ▃     █
                          (1.22 s … 1.44 s)    1.39 s ▆▁▁▁▁▁▆█▁▁▁▁▁█▆▆▆▁▁▁▆
                  gc(  1.54 ms …   4.76 ms)  24.20 mb (  4.33 mb… 37.58 mb)

node-tar: Linked Small Fil..    1.89 s/iter    1.97 s            █   █
                          (1.60 s … 2.05 s)    2.04 s █▁▁▁█▁▁▁▁▁▁█▁███▁█▁██
                  gc(  1.79 ms …   2.73 ms)  27.57 mb (458.35 kb… 64.71 mb)

tar-fs: Linked Small Files..    2.14 s/iter    2.17 s                  █  █
                          (1.97 s … 2.18 s)    2.18 s █▁▁▁▁▁▁▁▁▁▁█▁▁███████
                  gc(  1.68 ms …   2.78 ms)  26.20 mb ( 25.20 mb… 27.34 mb)

                             ┌                                            ┐
modern-tar: Linked Small F.. ┤ 1.33 s
node-tar: Linked Small Fil.. ┤■■■■■■■■■■■■■■■■■■■■■■■■ 1.89 s
tar-fs: Linked Small Files.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 2.14 s
                             └                                            ┘

summary
  modern-tar: Linked Small Files (500 packages, symlinks + hardlinks)
   1.43x faster than node-tar: Linked Small Files (500 packages, symlinks + hardlinks)
   1.61x faster than tar-fs: Linked Small Files (500 packages, symlinks + hardlinks)
```

For large files `modern-tar` and `node-tar` are very similar in performance since at this point the bottleneck is I/O. However, for many small files, `modern-tar` shows significantly better results than other libraries.
