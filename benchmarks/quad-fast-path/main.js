const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "quad";
const count = Number(params.get("count") ?? 600);
const frames = Number(params.get("frames") ?? 200);
const warmup = 30;

function info(name, value) {
    console.log(`BENCH_INFO quadpath.${mode}.${name}=${value}`);
}

function check(name, value) {
    console.log(`BENCH quadpath.${mode}.${name}=${value}`);
}

kaplay({
    width: 960,
    height: 540,
    background: [16, 20, 28],
    debug: false,
});

loadBean();

let frame = 0;
let drawMs = 0;

onLoad(() => {
    const positions = [];
    for (let i = 0; i < count; i++) {
        positions.push(vec2(24 + (i * 37) % 912, 24 + (i * 53) % 492));
    }

    onDraw(() => {
        const started = performance.now();
        if (mode === "sprite") {
            for (let i = 0; i < count; i++) {
                drawSprite({
                    sprite: "bean",
                    pos: positions[i],
                    anchor: "center",
                });
            }
        }
        else {
            for (let i = 0; i < count; i++) {
                drawUVQuad({
                    width: 12,
                    height: 12,
                    pos: positions[i],
                    anchor: "center",
                });
            }
        }
        if (frame > warmup) drawMs += performance.now() - started;
    });
});

onUpdate(() => {
    frame++;
    if (frame !== frames) return;
    info("frames", frame);
    info("count", count);
    info("loop_ms", (drawMs / (frame - warmup)).toFixed(3));
    check("draws", count);
});
