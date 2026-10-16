#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const defaultBefore = join(here, ".cache", "before.js");
const defaultAfter = join(repo, "dist", "kaplay.js");
const warnThreshold = 0.05;

function usage() {
    console.log(`quad fast path bench

  node benchmarks/quad-fast-path/run.mjs snapshot [options]   save the current bundle as "before"
  node benchmarks/quad-fast-path/run.mjs run      [options]   measure one bundle
  node benchmarks/quad-fast-path/run.mjs compare  [options]   measure before vs after

Options:
  --bundle <path>     bundle for run/snapshot (default dist/kaplay.js)
  --out <path>        snapshot output (default benchmarks/quad-fast-path/.cache/before.js)
  --before <path>     before bundle for compare (default the snapshot)
  --after <path>      after bundle for compare (default dist/kaplay.js)
  --host <path>       native host binary
  --engine <name>     quickjs (default) or v8
  --mode <name>       quad, sprite, or both (default both)
  --count <n>         draws per frame (default 600)
  --frames <n>        measured frames (default 200)
  --runs <n>          runs per bundle, best result wins (default 3)
`);
}

function parse(argv) {
    const options = {
        command: argv[0] ?? "compare",
        engine: "quickjs",
        mode: "both",
        count: 600,
        frames: 200,
        runs: 3,
    };
    for (let index = 1; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];
        switch (arg) {
            case "--bundle":
                options.bundle = next;
                index++;
                break;
            case "--out":
                options.out = next;
                index++;
                break;
            case "--before":
                options.before = next;
                index++;
                break;
            case "--after":
                options.after = next;
                index++;
                break;
            case "--host":
                options.host = next;
                index++;
                break;
            case "--engine":
                options.engine = next;
                index++;
                break;
            case "--mode":
                options.mode = next;
                index++;
                break;
            case "--count":
                options.count = Number(next);
                index++;
                break;
            case "--frames":
                options.frames = Number(next);
                index++;
                break;
            case "--runs":
                options.runs = Math.max(1, Number(next));
                index++;
                break;
            case "--help":
            case "-h":
                usage();
                process.exit(0);
                break;
            default:
                console.error(`unknown option: ${arg}`);
                process.exit(2);
        }
    }
    if (!["snapshot", "run", "compare"].includes(options.command)) {
        usage();
        process.exit(2);
    }
    return options;
}

function sha256(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex").slice(
        0,
        16,
    );
}

function hostPath(options) {
    if (options.host) return resolve(options.host);
    return join(
        repo,
        "..",
        "kaplay-native",
        "target",
        "release",
        `kaplay-native-host-${options.engine}`,
    );
}

function parseField(output, pattern) {
    const match = new RegExp(pattern, "m").exec(output);
    return match ? Number(match[1]) : null;
}

function measure(host, bundle, mode, options) {
    const hostFrames = options.frames + 60;
    const jsonPath = join(
        tmpdir(),
        `quad-fast-path-${process.pid}-${mode}.json`,
    );
    const rawPath = join(
        tmpdir(),
        `quad-fast-path-${process.pid}-${mode}.rgba`,
    );
    const url =
        `http://127.0.0.1:1/index.html?mode=${mode}&count=${options.count}&frames=${options.frames}`;
    const result = spawnSync(host, [
        "--script",
        join(here, "main.js"),
        "--dir",
        here,
        "--preload",
        bundle,
        "--window",
        "960x540",
        "--frames",
        String(hostFrames),
        "--no-vsync",
        "--no-audio",
        "--headless",
        "--x11",
        "--url",
        url,
        "--bench-json",
        jsonPath,
        "--screenshot-raw",
        rawPath,
    ], {
        cwd: repo,
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const loopMs = parseField(
        output,
        `BENCH_INFO quadpath\\.${mode}\\.loop_ms=([\\d.]+)`,
    );
    const draws = parseField(output, `BENCH quadpath\\.${mode}\\.draws=(\\d+)`);
    let jsP50 = null;
    if (existsSync(jsonPath)) {
        try {
            jsP50 =
                JSON.parse(readFileSync(jsonPath, "utf8"))?.phases_ms?.js?.p50
                    ?? null;
        } catch {
            jsP50 = null;
        }
        rmSync(jsonPath, { force: true });
    }
    let hash = null;
    if (existsSync(rawPath)) {
        hash = sha256(rawPath);
        rmSync(rawPath, { force: true });
    }
    if (loopMs === null || draws !== options.count) {
        console.error(output.trim());
        throw new Error(
            `no usable result for ${mode} (status ${result.status}, draws ${draws}, loop_ms ${loopMs})`,
        );
    }
    return {
        perCallUs: (loopMs * 1000) / draws,
        loopMs,
        jsP50,
        hash,
        status: result.status,
    };
}

function bestOf(host, bundle, mode, options) {
    const runs = [];
    for (let i = 0; i < options.runs; i++) {
        runs.push(measure(host, bundle, mode, options));
    }
    const best = runs.reduce((a, b) => (a.perCallUs <= b.perCallUs ? a : b));
    return { best, runs };
}

function label(path) {
    const relative = path.startsWith(repo) ? path.slice(repo.length + 1) : path;
    return `${relative} (${sha256(path)})`;
}

function reportMode(name, before, after, options) {
    const beforeUs = before.best.perCallUs;
    const afterUs = after.best.perCallUs;
    const delta = (afterUs - beforeUs) / beforeUs;
    const hashes = new Set([
        ...before.runs.map(run => run.hash),
        ...after.runs.map(run => run.hash),
    ]);
    const parity = hashes.size === 1;

    console.log(
        `\n${name} (${options.engine}, ${options.count} draws, best of ${options.runs})`,
    );
    console.log(
        `  before  ${beforeUs.toFixed(2).padStart(8)} us/call  js p50 ${
            before.best.jsP50?.toFixed(2) ?? "?"
        } ms  ${label(options.beforePath)}`,
    );
    console.log(
        `  after   ${afterUs.toFixed(2).padStart(8)} us/call  js p50 ${
            after.best.jsP50?.toFixed(2) ?? "?"
        } ms  ${label(options.afterPath)}`,
    );
    const percent = `${(delta * 100).toFixed(1)}%`.padStart(7);
    console.log(
        `  delta   ${percent}  ${
            delta < -warnThreshold
                ? "faster"
                : delta > warnThreshold
                ? "SLOWER"
                : "within noise"
        }`,
    );
    console.log(
        `  pixels  ${
            parity ? "identical" : `MISMATCH ${[...hashes].join(" ")}`
        }`,
    );

    return { delta, parity };
}

const options = parse(process.argv.slice(2));
const host = hostPath(options);

if (!existsSync(host)) {
    console.error(`host binary not found: ${host}`);
    process.exit(2);
}

if (options.command === "snapshot") {
    const bundle = resolve(options.bundle ?? defaultAfter);
    const out = resolve(options.out ?? defaultBefore);
    if (!existsSync(bundle)) {
        console.error(`bundle not found: ${bundle}`);
        process.exit(2);
    }
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(bundle, out);
    console.log(`saved ${bundle} -> ${out} (${sha256(out)})`);
    process.exit(0);
}

if (options.command === "run") {
    const bundle = resolve(options.bundle ?? defaultAfter);
    const modes = options.mode === "both" ? ["quad", "sprite"] : [options.mode];
    for (const mode of modes) {
        const result = bestOf(host, bundle, mode, options);
        console.log(
            `${mode}: ${result.best.perCallUs.toFixed(2)} us/call, js p50 ${
                result.best.jsP50?.toFixed(2) ?? "?"
            } ms  ${label(bundle)}`,
        );
    }
    process.exit(0);
}

options.beforePath = resolve(options.before ?? defaultBefore);
options.afterPath = resolve(options.after ?? defaultAfter);
for (const path of [options.beforePath, options.afterPath]) {
    if (!existsSync(path)) {
        console.error(`bundle not found: ${path}`);
        process.exit(2);
    }
}
const modes = options.mode === "both" ? ["quad", "sprite"] : [options.mode];
let failed = false;
for (const mode of modes) {
    const before = bestOf(host, options.beforePath, mode, options);
    const after = bestOf(host, options.afterPath, mode, options);
    const { delta, parity } = reportMode(mode, before, after, options);
    if (!parity || delta > warnThreshold) failed = true;
}
process.exit(failed ? 1 : 0);
