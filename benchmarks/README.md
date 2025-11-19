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
modern-tar: Many Small Fil.. 224.94 ms/iter 231.64 ms     █  █
                    (205.25 ms … 262.98 ms) 251.75 ms ██▁██▁▁██▁▁██▁▁▁▁▁▁▁█
                  gc(  1.26 ms …   2.14 ms)  35.80 mb ( 34.91 mb… 37.48 mb)

node-tar: Many Small Files.. 309.20 ms/iter 323.41 ms           █         ▃
                    (274.66 ms … 376.22 ms) 327.51 ms ▆▁▁▆▁▆▁▆▁▁█▁▁▁▆▁▁▁▆▁█
                  gc(  1.40 ms …   3.07 ms)  42.10 mb ( 41.43 mb… 43.26 mb)

tar-fs: Many Small Files (.. 576.95 ms/iter 603.21 ms        █            █
                    (531.99 ms … 617.60 ms) 609.23 ms █▁▁██▁▁█▁▁██▁▁▁▁▁██▁█
                  gc(  1.36 ms …   2.00 ms)   6.14 mb (  4.91 mb…  7.34 mb)

                             ┌                                            ┐
modern-tar: Many Small Fil.. ┤ 224.94 ms
node-tar: Many Small Files.. ┤■■■■■■■■ 309.20 ms
tar-fs: Many Small Files (.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 576.95 ms
                             └                                            ┘

summary
  modern-tar: Many Small Files (2500 x 1KB)
   1.37x faster than node-tar: Many Small Files (2500 x 1KB)
   2.56x faster than tar-fs: Many Small Files (2500 x 1KB)

• Many Small Nested Files (2500 x 1KB)
------------------------------------------- -------------------------------
modern-tar: Many Small Nes.. 246.66 ms/iter 247.60 ms █     █      █
                    (238.85 ms … 262.44 ms) 252.07 ms █▁▁▁▁▁█▁▁█▁███▁▁█▁▁▁█
                  gc(  1.43 ms …   4.44 ms)  41.81 mb ( 41.76 mb… 41.89 mb)

node-tar: Many Small Neste.. 455.29 ms/iter 449.31 ms      ██ █           █
                    (423.73 ms … 553.38 ms) 484.76 ms ███▁▁██▁█▁▁▁▁▁▁▁▁▁▁▁█
                  gc(  1.48 ms …   2.13 ms)  28.82 mb ( 28.50 mb… 29.48 mb)

tar-fs: Many Small Nested .. 672.93 ms/iter 710.12 ms                 █
                    (594.31 ms … 764.43 ms) 740.80 ms ██▁█▁▁██▁▁▁██▁█▁█▁▁▁█
                  gc(  1.46 ms …   2.30 ms)  23.83 mb ( 22.83 mb… 24.35 mb)

                             ┌                                            ┐
modern-tar: Many Small Nes.. ┤ 246.66 ms
node-tar: Many Small Neste.. ┤■■■■■■■■■■■■■■■■■ 455.29 ms
tar-fs: Many Small Nested .. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 672.93 ms
                             └                                            ┘

summary
  modern-tar: Many Small Nested Files (2500 x 1KB)
   1.85x faster than node-tar: Many Small Nested Files (2500 x 1KB)
   2.73x faster than tar-fs: Many Small Nested Files (2500 x 1KB)

• Few Large Files (5 x 20MB)
------------------------------------------- -------------------------------
modern-tar: Few Large File..  24.48 ms/iter  25.17 ms  ▆█▆ ▆█▆
                      (19.64 ms … 55.91 ms)  36.48 ms ████████▆▄▁▁▄▁▁▁▁▄▁▁▄
                  gc(  1.15 ms …   2.26 ms) 418.67 kb ( 34.72 kb…  1.28 mb)

node-tar: Few Large Files ..  33.18 ms/iter  32.55 ms   █  ▂
                     (24.77 ms … 120.19 ms)  41.96 ms ▅▃█▃▅█▃▅▅▃▁▃▅▃▃▁▁▁▃▁▃
                  gc(  1.17 ms …   2.35 ms) 336.17 kb ( 16.00 kb…967.75 kb)

tar-fs: Few Large Files (5..  37.47 ms/iter  37.21 ms ▄▄█ ▄
                     (26.39 ms … 128.21 ms)  54.22 ms ███▅█▁▁▅▅▅▁▁▅▅▁▁▁▁▁▁▅
                  gc(  1.18 ms …   2.66 ms) 390.72 kb ( 53.30 kb…  0.99 mb)

                             ┌                                            ┐
modern-tar: Few Large File.. ┤ 24.48 ms
node-tar: Few Large Files .. ┤■■■■■■■■■■■■■■■■■■■■■■■ 33.18 ms
tar-fs: Few Large Files (5.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 37.47 ms
                             └                                            ┘

summary
  modern-tar: Few Large Files (5 x 20MB)
   1.36x faster than node-tar: Few Large Files (5 x 20MB)
   1.53x faster than tar-fs: Few Large Files (5 x 20MB)

• Huge Files (2 x 1GB)
------------------------------------------- -------------------------------
modern-tar: Huge Files (2 .. 747.24 ms/iter 752.26 ms ███  ██  ████ █     █
                    (718.49 ms … 806.17 ms) 776.98 ms ███▁▁██▁▁████▁█▁▁▁▁▁█
                  gc(  2.00 ms …   3.42 ms) 587.62 kb ( 58.54 kb…  1.50 mb)

node-tar: Huge Files (2 x .. 784.60 ms/iter 786.11 ms              █
                    (752.83 ms … 871.87 ms) 794.01 ms █▁▁▁▁▁██▁▁██▁█▁███▁▁█
                  gc(  1.63 ms …   4.82 ms) 189.04 kb (118.23 kb…668.97 kb)

tar-fs: Huge Files (2 x 1GB) 777.01 ms/iter 783.46 ms          █  ▃       ▃
                    (738.88 ms … 871.27 ms) 787.81 ms ▆▁▁▁▁▁▁▁▁█▆▁█▁▁▆▁▁▆▁█
                  gc(  1.91 ms …   5.78 ms) 187.93 kb (145.30 kb…307.59 kb)

                             ┌                                            ┐
modern-tar: Huge Files (2 .. ┤ 747.24 ms
node-tar: Huge Files (2 x .. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 784.60 ms
tar-fs: Huge Files (2 x 1GB) ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■ 777.01 ms
                             └                                            ┘

summary
  modern-tar: Huge Files (2 x 1GB)
   1.04x faster than tar-fs: Huge Files (2 x 1GB)
   1.05x faster than node-tar: Huge Files (2 x 1GB)

• Linked Small Files (500 packages, symlinks + hardlinks)
------------------------------------------- -------------------------------
modern-tar: Linked Small F..    1.35 s/iter    1.42 s   █                 █
                          (1.25 s … 1.44 s)    1.43 s █▁█▁▁██▁▁█▁▁█▁▁▁▁█▁██
                  gc(  1.49 ms …   2.87 ms)  37.18 mb ( 37.02 mb… 37.94 mb)

node-tar: Linked Small Fil..    1.83 s/iter    1.90 s     █        █
                          (1.63 s … 2.03 s)    1.93 s █▁▁▁█▁▁▁▁▁▁▁██▁█▁████
                  gc(  1.67 ms …   2.32 ms)  32.89 mb (744.70 kb… 64.73 mb)

tar-fs: Linked Small Files..    2.13 s/iter    2.18 s            █
                          (1.94 s … 2.30 s)    2.28 s ▆▁▁▁▆▁▆▁▁▁▆█▆▁▁▆▁▁▁▆▆
                  gc(  1.66 ms …   3.18 ms)  26.19 mb ( 25.16 mb… 27.36 mb)

                             ┌                                            ┐
modern-tar: Linked Small F.. ┤ 1.35 s
node-tar: Linked Small Fil.. ┤■■■■■■■■■■■■■■■■■■■■■ 1.83 s
tar-fs: Linked Small Files.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 2.13 s
                             └                                            ┘

summary
  modern-tar: Linked Small Files (500 packages, symlinks + hardlinks)
   1.36x faster than node-tar: Linked Small Files (500 packages, symlinks + hardlinks)
   1.58x faster than tar-fs: Linked Small Files (500 packages, symlinks + hardlinks)
```

For large files `modern-tar` and `node-tar` are very similar in performance since at this point the bottleneck is I/O. However, for many small files, `modern-tar` shows significantly better results than other libraries.
