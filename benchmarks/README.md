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
clk: ~3.95 GHz
cpu: Apple M3 Pro
runtime: node 24.11.0 (arm64-darwin)

benchmark                   avg (min … max) p75 / p99    (min … top 1%)
------------------------------------------- -------------------------------
• Many Small Files (2500 x 1KB)
------------------------------------------- -------------------------------
modern-tar: Many Small Fil.. 225.72 ms/iter 232.58 ms       █        █    █
                    (213.89 ms … 234.45 ms) 234.02 ms █▁▁▁█▁██▁█▁▁▁▁▁█▁▁▁██
                  gc(  1.50 ms …   3.12 ms)  36.27 mb ( 35.13 mb… 38.37 mb)

node-tar: Many Small Files.. 275.24 ms/iter 273.55 ms          █
                    (256.49 ms … 319.05 ms) 294.85 ms ▆▁▁▆▆▆▁▆▆█▁▁▆▁▁▁▁▁▁▁▆
                  gc(  1.58 ms …   2.56 ms)  42.14 mb ( 41.49 mb… 43.23 mb)

tar-fs: Many Small Files (.. 568.48 ms/iter 561.26 ms        ██
                    (517.05 ms … 693.21 ms) 617.22 ms █▁█▁▁█████▁▁▁▁▁▁█▁▁▁█
                  gc(  1.52 ms …   1.86 ms)   6.14 mb (  4.94 mb…  7.35 mb)

                             ┌                                            ┐
modern-tar: Many Small Fil.. ┤ 225.72 ms
node-tar: Many Small Files.. ┤■■■■■ 275.24 ms
tar-fs: Many Small Files (.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 568.48 ms
                             └                                            ┘

summary
  modern-tar: Many Small Files (2500 x 1KB)
   1.22x faster than node-tar: Many Small Files (2500 x 1KB)
   2.52x faster than tar-fs: Many Small Files (2500 x 1KB)

• Many Small Nested Files (2500 x 1KB)
------------------------------------------- -------------------------------
modern-tar: Many Small Nes.. 246.18 ms/iter 251.81 ms       █         █  █
                    (232.73 ms … 254.93 ms) 253.22 ms █▁▁▁▁▁█▁▁█▁█▁▁█▁█▁▁██
                  gc(  1.68 ms …   4.03 ms)  42.13 mb ( 41.88 mb… 42.77 mb)

node-tar: Many Small Neste.. 413.24 ms/iter 417.91 ms                 █  ▃
                    (391.77 ms … 440.56 ms) 419.72 ms ▆▁▁▁▁▁▁▁▆▁▆▆▁▁▆▁█▁▁█▆
                  gc(  1.62 ms …   2.36 ms)  28.82 mb ( 28.49 mb… 29.44 mb)

tar-fs: Many Small Nested .. 634.07 ms/iter 651.90 ms         █           █
                    (579.61 ms … 681.47 ms) 664.41 ms █▁▁▁█▁▁██▁▁▁▁▁████▁▁█
                  gc(  1.55 ms …   2.18 ms)  23.83 mb ( 22.91 mb… 24.34 mb)

                             ┌                                            ┐
modern-tar: Many Small Nes.. ┤ 246.18 ms
node-tar: Many Small Neste.. ┤■■■■■■■■■■■■■■■ 413.24 ms
tar-fs: Many Small Nested .. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 634.07 ms
                             └                                            ┘

summary
  modern-tar: Many Small Nested Files (2500 x 1KB)
   1.68x faster than node-tar: Many Small Nested Files (2500 x 1KB)
   2.58x faster than tar-fs: Many Small Nested Files (2500 x 1KB)

• Few Large Files (5 x 20MB)
------------------------------------------- -------------------------------
modern-tar: Few Large File..  23.73 ms/iter  25.19 ms  █▆▆   █
                      (20.92 ms … 35.09 ms)  33.68 ms ▆███▆▁▃█▃▄▁▃▁▁▁▁▁▁▁▁▃
                  gc(  1.34 ms …   3.17 ms) 406.68 kb ( 32.52 kb…  1.49 mb)

node-tar: Few Large Files ..  26.17 ms/iter  26.44 ms   ▂  █
                      (23.95 ms … 33.47 ms)  33.26 ms ▄▆█▇▇█▂▄▂▂▂▁▂▁▁▁▁▁▁▁▂
                  gc(  1.39 ms …   2.58 ms) 226.45 kb (  8.72 kb…  1.42 mb)

tar-fs: Few Large Files (5..  27.77 ms/iter  28.62 ms  █
                      (25.55 ms … 35.87 ms)  35.59 ms ▇█▇██▃▄▄▆▁▁▃▁▁▁▁▃▁▁▁▃
                  gc(  1.32 ms …   2.73 ms) 467.79 kb ( 57.35 kb…  1.24 mb)

                             ┌                                            ┐
modern-tar: Few Large File.. ┤ 23.73 ms
node-tar: Few Large Files .. ┤■■■■■■■■■■■■■■■■■■■■■ 26.17 ms
tar-fs: Few Large Files (5.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 27.77 ms
                             └                                            ┘

summary
  modern-tar: Few Large Files (5 x 20MB)
   1.1x faster than node-tar: Few Large Files (5 x 20MB)
   1.17x faster than tar-fs: Few Large Files (5 x 20MB)

• Huge Files (2 x 1GB)
------------------------------------------- -------------------------------
modern-tar: Huge Files (2 .. 704.90 ms/iter 707.82 ms           █
                    (696.53 ms … 712.80 ms) 711.71 ms ▆▁▆▁▁▁▆▆▁▁█▁▁▁▆▆▆▁▁▁▆
                  gc(  1.74 ms …   2.70 ms) 420.57 kb ( 37.62 kb…  1.30 mb)

node-tar: Huge Files (2 x ..    1.15 s/iter    1.70 s █▄
                       (708.76 ms … 1.92 s)    1.77 s ██▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▅▁█▅
                  gc(  2.22 ms …   8.28 ms) 157.81 kb ( 46.95 kb…267.91 kb)

tar-fs: Huge Files (2 x 1GB) 991.30 ms/iter 823.52 ms ▂█
                       (711.56 ms … 1.84 s)    1.66 s ██▄▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▇
                  gc(  2.05 ms …   8.38 ms) 188.25 kb (136.40 kb…280.16 kb)

                             ┌                                            ┐
modern-tar: Huge Files (2 .. ┤ 704.90 ms
node-tar: Huge Files (2 x .. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 1.15 s
tar-fs: Huge Files (2 x 1GB) ┤■■■■■■■■■■■■■■■■■■■■■■ 991.30 ms
                             └                                            ┘

summary
  modern-tar: Huge Files (2 x 1GB)
   1.41x faster than tar-fs: Huge Files (2 x 1GB)
   1.64x faster than node-tar: Huge Files (2 x 1GB)

• Linked Small Files (500 packages, symlinks + hardlinks)
------------------------------------------- -------------------------------
modern-tar: Linked Small F..    1.14 s/iter    1.17 s                █
                          (1.05 s … 1.22 s)    1.21 s ▆▁▁▁▆▆▆▁▆▆▁▆▁▁▁█▁▁▁▁▆
                  gc(  1.69 ms …   2.38 ms)  39.77 mb ( 38.78 mb… 40.89 mb)

node-tar: Linked Small Fil..    1.50 s/iter    1.55 s   █ █
                          (1.41 s … 1.63 s)    1.59 s █▁█▁█▁█▁█▁▁▁▁█▁█▁█▁▁█
                  gc(  1.64 ms …   2.96 ms)  13.42 mb (193.63 kb… 64.65 mb)

tar-fs: Linked Small Files..    1.90 s/iter    1.93 s            █
                          (1.77 s … 2.03 s)    2.03 s █▁██▁█▁▁██▁█▁█▁▁▁▁▁██
                  gc(  1.72 ms …   2.93 ms)  26.34 mb ( 25.28 mb… 27.61 mb)

                             ┌                                            ┐
modern-tar: Linked Small F.. ┤ 1.14 s
node-tar: Linked Small Fil.. ┤■■■■■■■■■■■■■■■■ 1.50 s
tar-fs: Linked Small Files.. ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 1.90 s
                             └                                            ┘

summary
  modern-tar: Linked Small Files (500 packages, symlinks + hardlinks)
   1.32x faster than node-tar: Linked Small Files (500 packages, symlinks + hardlinks)
   1.67x faster than tar-fs: Linked Small Files (500 packages, symlinks + hardlinks)
```

For large files `modern-tar` and `node-tar` are very similar in performance since at this point the bottleneck is I/O. However, for many small files, `modern-tar` shows significantly better results than other libraries.
