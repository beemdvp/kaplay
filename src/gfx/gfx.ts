import type { Shader, Uniform } from "../assets/shader";
import { IDENTITY_MATRIX } from "../constants/math";
import { getCamTransform } from "../game/camera";
import type { Color } from "../math/color";
import {
    BlendMode,
    type ImageSource,
    type KAPLAYOpt,
    type TextureOpt,
} from "../types";
import { deepEq } from "../utils/deepEq";
import type { Picture } from "./draw/drawPicture";

export type GfxCtx = ReturnType<typeof initGfx>;

/**
 * @group Rendering
 * @subgroup Canvas
 */
export class Texture {
    ctx: GfxCtx;
    src: null | ImageSource = null;
    glTex: WebGLTexture;
    width: number;
    height: number;

    constructor(ctx: GfxCtx, w: number, h: number, opt: TextureOpt = {}) {
        this.ctx = ctx;

        const gl = ctx.gl;
        const glText = ctx.gl.createTexture();

        if (!glText) {
            throw new Error("[rendering] Failed to create texture");
        }

        this.glTex = glText;
        ctx.onDestroy(() => this.free());

        this.width = w;
        this.height = h;

        const filter = {
            "linear": gl.LINEAR,
            "nearest": gl.NEAREST,
        }[opt.filter ?? ctx.opts.texFilter ?? "nearest"];

        const wrap = {
            "repeat": gl.REPEAT,
            "clampToEdge": gl.CLAMP_TO_EDGE,
        }[opt.wrap ?? "clampToEdge"];

        this.bind();

        if (w && h) {
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                w,
                h,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                null,
            );
        }

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        this.unbind();
    }

    static fromImage(
        ctx: GfxCtx,
        img: ImageSource,
        opt: TextureOpt = {},
    ): Texture {
        const tex = new Texture(ctx, img.width, img.height, opt);
        tex.update(img);
        tex.src = img;
        return tex;
    }

    update(img: ImageSource, x = 0, y = 0) {
        const gl = this.ctx.gl;
        this.bind();
        gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            x,
            y,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            img,
        );
        this.unbind();
    }

    bind() {
        this.ctx.pushTexture2D(this.glTex);
    }

    unbind() {
        this.ctx.popTexture2D();
    }

    /** Frees up texture memory. Call this once the texture is no longer being used to avoid memory leaks. */
    free() {
        this.ctx.gl.deleteTexture(this.glTex);
    }
}

/**
 * @group Rendering
 * @subgroup Shaders
 */
export type VertexFormat = {
    name: string;
    size: number;
}[];

/**
 * @group Rendering
 * @subgroup Canvas
 */
export class BatchRenderer {
    ctx: GfxCtx;

    glVBuf: WebGLBuffer;
    glIBuf: WebGLBuffer;
    vqueue: number[] = [];
    iqueue: number[] = [];
    stride: number;
    maxVertices: number;
    maxIndices: number;

    vertexFormat: VertexFormat;
    numDraws: number = 0;

    curPrimitive: GLenum | null = null;
    curTex: Texture | null = null;
    curShader: Shader | null = null;
    curUniform: Uniform | null = null;
    curBlend: BlendMode = BlendMode.Normal;
    curFixed: boolean | undefined = undefined;

    picture: Picture | null = null;

    constructor(
        ctx: GfxCtx,
        format: VertexFormat,
        maxVertices: number,
        maxIndices: number,
    ) {
        const gl = ctx.gl;

        this.vertexFormat = format;
        this.ctx = ctx;
        this.stride = format.reduce((sum, f) => sum + f.size, 0);
        this.maxVertices = maxVertices;
        this.maxIndices = maxIndices;

        const glVBuf = gl.createBuffer();

        if (!glVBuf) {
            throw new Error("Failed to create vertex buffer");
        }

        this.glVBuf = glVBuf;

        ctx.pushArrayBuffer(this.glVBuf);
        gl.bufferData(gl.ARRAY_BUFFER, maxVertices * 4, gl.DYNAMIC_DRAW);
        ctx.popArrayBuffer();

        this.glIBuf = gl.createBuffer()!;
        ctx.pushElementArrayBuffer(this.glIBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, maxIndices * 4, gl.DYNAMIC_DRAW);
        ctx.popElementArrayBuffer();
    }

    push(
        primitive: GLenum,
        vertices: number[],
        indices: number[],
        shader: Shader,
        tex: Texture | null = null,
        uniform: Uniform | null = null,
        blend: BlendMode,
        width: number,
        height: number,
        fixed: boolean,
    ) {
        // If we have a picture, redirect data to the picture instead
        if (this.picture) {
            const index = this.picture.indices.length;
            const count = indices.length;
            const indexOffset = this.picture.vertices.length / this.stride;
            let l = vertices.length;
            for (let i = 0; i < l; i++) {
                this.picture.vertices.push(vertices[i]);
            }
            l = indices.length;
            for (let i = 0; i < l; i++) {
                this.picture.indices.push(indices[i] + indexOffset);
            }
            const material = {
                tex: tex || undefined,
                shader,
                uniform: uniform || undefined,
                blend,
            };
            if (this.picture.commands.length) {
                const lastCommand =
                    this.picture.commands[this.picture.commands.length - 1];
                const lastMaterial = lastCommand.material;
                if (
                    lastMaterial.tex == material.tex
                    && lastMaterial.shader == material.shader
                    && lastMaterial.uniform == material.uniform
                    && lastMaterial.blend == material.blend
                ) {
                    lastCommand.count += count;
                    return;
                }
            }
            const command = {
                material,
                index,
                count,
            };
            this.picture.commands.push(command);
            return;
        }

        if (
            this.needsFlush(
                primitive,
                tex,
                shader,
                uniform,
                blend,
                fixed,
                vertices.length,
                indices.length,
            )
        ) {
            this.flush(width, height);
            this.setBlend(blend);
        }
        const indexOffset = this.vqueue.length / this.stride;
        let l = vertices.length;
        for (let i = 0; i < l; i++) {
            this.vqueue.push(vertices[i]);
        }
        l = indices.length;
        for (let i = 0; i < l; i++) {
            this.iqueue.push(indices[i] + indexOffset);
        }
        this.curPrimitive = primitive;
        this.curShader = shader;
        this.curTex = tex;
        this.curUniform = uniform;
        this.curFixed = fixed;
    }

    pushQuad(
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        x3: number,
        y3: number,
        u0: number,
        v0: number,
        u1: number,
        v1: number,
        u2: number,
        v2: number,
        u3: number,
        v3: number,
        color: Color,
        opacity: number,
        shader: Shader,
        tex: Texture | null,
        uniform: Uniform | null,
        blend: BlendMode,
        width: number,
        height: number,
        fixed: boolean,
    ) {
        const gl = this.ctx.gl;

        if (this.picture) {
            this.push(
                gl.TRIANGLES,
                [
                    x0,
                    y0,
                    u0,
                    v0,
                    color.r / 255,
                    color.g / 255,
                    color.b / 255,
                    opacity,
                    x1,
                    y1,
                    u1,
                    v1,
                    color.r / 255,
                    color.g / 255,
                    color.b / 255,
                    opacity,
                    x2,
                    y2,
                    u2,
                    v2,
                    color.r / 255,
                    color.g / 255,
                    color.b / 255,
                    opacity,
                    x3,
                    y3,
                    u3,
                    v3,
                    color.r / 255,
                    color.g / 255,
                    color.b / 255,
                    opacity,
                ],
                [0, 1, 3, 1, 2, 3],
                shader,
                tex,
                uniform,
                blend,
                width,
                height,
                fixed,
            );
            return;
        }

        if (
            this.needsFlush(
                gl.TRIANGLES,
                tex,
                shader,
                uniform,
                blend,
                fixed,
                32,
                6,
            )
        ) {
            this.flush(width, height);
            this.setBlend(blend);
        }

        const r = color.r / 255;
        const g = color.g / 255;
        const b = color.b / 255;
        const indexOffset = this.vqueue.length / this.stride;

        this.vqueue.push(
            x0,
            y0,
            u0,
            v0,
            r,
            g,
            b,
            opacity,
            x1,
            y1,
            u1,
            v1,
            r,
            g,
            b,
            opacity,
            x2,
            y2,
            u2,
            v2,
            r,
            g,
            b,
            opacity,
            x3,
            y3,
            u3,
            v3,
            r,
            g,
            b,
            opacity,
        );
        this.iqueue.push(
            indexOffset,
            indexOffset + 1,
            indexOffset + 3,
            indexOffset + 1,
            indexOffset + 2,
            indexOffset + 3,
        );

        this.curPrimitive = gl.TRIANGLES;
        this.curShader = shader;
        this.curTex = tex;
        this.curUniform = uniform;
        this.curFixed = fixed;
    }

    needsFlush(
        primitive: GLenum,
        tex: Texture | null,
        shader: Shader,
        uniform: Uniform | null,
        blend: BlendMode,
        fixed: boolean,
        vertexCount: number,
        indexCount: number,
    ) {
        return primitive !== this.curPrimitive
            || tex !== this.curTex
            || shader !== this.curShader
            || ((this.curUniform != uniform)
                && !deepEq(this.curUniform, uniform))
            || blend !== this.curBlend
            || fixed !== this.curFixed
            || this.vqueue.length + vertexCount * this.stride
                > this.maxVertices
            || this.iqueue.length + indexCount > this.maxIndices;
    }

    flush(width: number, height: number) {
        if (
            !this.curPrimitive
            || !this.curShader
            || this.vqueue.length === 0
            || this.iqueue.length === 0
        ) {
            return;
        }

        const gl = this.ctx.gl;

        // Bind vertex data
        this.ctx.pushArrayBuffer(this.glVBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(this.vqueue));

        // Bind index data
        this.ctx.pushElementArrayBuffer(this.glIBuf);
        gl.bufferSubData(
            gl.ELEMENT_ARRAY_BUFFER,
            0,
            new Uint16Array(this.iqueue),
        );

        // Set vertex format
        this.ctx.setVertexFormat(this.vertexFormat);

        // Bind Shader
        this.curShader.bind();

        // Send user uniforms
        if (this.curUniform) {
            this.curShader.send(this.curUniform);
        }

        // Send system uniforms
        this.curShader.send({
            width,
            height,
            camera: this.curFixed ? IDENTITY_MATRIX : getCamTransform(),
            transform: IDENTITY_MATRIX,
        });

        // Bind texture
        this.curTex?.bind();

        // Draw vertex buffer using active indices
        gl.drawElements(
            this.curPrimitive,
            this.iqueue.length,
            gl.UNSIGNED_SHORT,
            0,
        );

        // Unbind texture and shader
        this.curTex?.unbind();
        this.curShader.unbind();

        // Unbind buffers
        this.ctx.popArrayBuffer();
        this.ctx.popElementArrayBuffer();

        // Reset local buffers
        this.vqueue.length = 0;
        this.iqueue.length = 0;

        // Increase draw
        this.numDraws++;
    }

    free() {
        const gl = this.ctx.gl;
        gl.deleteBuffer(this.glVBuf);
        gl.deleteBuffer(this.glIBuf);
    }

    setBlend(blend: BlendMode) {
        if (blend !== this.curBlend) {
            const gl = this.ctx.gl;
            this.curBlend = blend;
            switch (this.curBlend) {
                case BlendMode.Normal:
                    gl.blendFuncSeparate(
                        gl.ONE,
                        gl.ONE_MINUS_SRC_ALPHA,
                        gl.ONE,
                        gl.ONE_MINUS_SRC_ALPHA,
                    );
                    break;
                case BlendMode.Add:
                    gl.blendFuncSeparate(
                        gl.ONE,
                        gl.ONE,
                        gl.ONE,
                        gl.ONE_MINUS_SRC_ALPHA,
                    );
                    break;
                case BlendMode.Multiply:
                    gl.blendFuncSeparate(
                        gl.DST_COLOR,
                        gl.ZERO,
                        gl.ONE,
                        gl.ONE_MINUS_SRC_ALPHA,
                    );
                    break;
                case BlendMode.Screen:
                    gl.blendFuncSeparate(
                        gl.ONE_MINUS_DST_COLOR,
                        gl.ONE,
                        gl.ONE,
                        gl.ONE_MINUS_SRC_ALPHA,
                    );
                    break;
                case BlendMode.Overlay:
                    gl.blendFuncSeparate(
                        gl.DST_COLOR,
                        gl.ONE_MINUS_SRC_ALPHA,
                        gl.ONE,
                        gl.ONE_MINUS_SRC_ALPHA,
                    );
            }
        }
    }
}

/**
 * @group Rendering
 * @subgroup Shaders
 */
export class Mesh {
    ctx: GfxCtx;
    glVBuf: WebGLBuffer;
    glIBuf: WebGLBuffer;
    vertexFormat: VertexFormat;
    count: number;

    constructor(
        ctx: GfxCtx,
        format: VertexFormat,
        vertices: number[],
        indices: number[],
    ) {
        const gl = ctx.gl;
        this.vertexFormat = format;
        this.ctx = ctx;
        const glVBuf = gl.createBuffer();

        if (!glVBuf) throw new Error("Failed to create vertex buffer");

        this.glVBuf = glVBuf;

        ctx.pushArrayBuffer(this.glVBuf);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(vertices),
            gl.STATIC_DRAW,
        );
        ctx.popArrayBuffer();

        this.glIBuf = gl.createBuffer()!;
        ctx.pushElementArrayBuffer(this.glIBuf);
        gl.bufferData(
            gl.ELEMENT_ARRAY_BUFFER,
            new Uint16Array(indices),
            gl.STATIC_DRAW,
        );
        ctx.popElementArrayBuffer();

        this.count = indices.length;
    }

    draw(primitive?: GLenum, index?: GLuint, count?: GLuint): void {
        const gl = this.ctx.gl;
        this.ctx.pushArrayBuffer(this.glVBuf);
        this.ctx.pushElementArrayBuffer(this.glIBuf);
        this.ctx.setVertexFormat(this.vertexFormat);
        gl.drawElements(
            primitive ?? gl.TRIANGLES,
            index ?? this.count,
            gl.UNSIGNED_SHORT,
            count ?? 0,
        );
        this.ctx.popArrayBuffer();
        this.ctx.popElementArrayBuffer();
    }

    free() {
        const gl = this.ctx.gl;
        gl.deleteBuffer(this.glVBuf);
        gl.deleteBuffer(this.glIBuf);
    }
}

function genStack<T>(setFunc: (item: T | null) => void) {
    const stack: T[] = [];
    // TODO: don't do anything if pushed item is the same as the one on top?
    const push = (item: T) => {
        stack.push(item);
        setFunc(item);
    };
    const pop = () => {
        stack.pop();
        setFunc(cur() ?? null);
    };
    const cur = () => stack[stack.length - 1];
    return [push, pop, cur] as const;
}

export function initGfx(gl: WebGLRenderingContext, opts: KAPLAYOpt = {}) {
    const gc: Array<() => void> = [];

    function onDestroy(action: () => unknown) {
        gc.push(action);
    }

    function destroy() {
        gc.forEach((action) => action());
        const extension = gl.getExtension("WEBGL_lose_context");
        if (extension) extension.loseContext();
    }

    let curVertexFormat: object | null = null;

    function setVertexFormat(fmt: VertexFormat) {
        if (deepEq(fmt, curVertexFormat)) return;
        curVertexFormat = fmt;
        const stride = fmt.reduce((sum, f) => sum + f.size, 0);
        fmt.reduce((offset, f, i) => {
            gl.enableVertexAttribArray(i);
            gl.vertexAttribPointer(
                i,
                f.size,
                gl.FLOAT,
                false,
                stride * 4,
                offset,
            );
            return offset + f.size * 4;
        }, 0);
    }

    const [pushTexture2D, popTexture2D] = genStack<WebGLTexture>((t) =>
        gl.bindTexture(gl.TEXTURE_2D, t)
    );

    const [pushArrayBuffer, popArrayBuffer] = genStack<WebGLBuffer>((b) =>
        gl.bindBuffer(gl.ARRAY_BUFFER, b)
    );

    const [pushElementArrayBuffer, popElementArrayBuffer] = genStack<
        WebGLBuffer
    >((b) => gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b));

    const [pushFramebuffer, popFramebuffer] = genStack<WebGLFramebuffer>((b) =>
        gl.bindFramebuffer(gl.FRAMEBUFFER, b)
    );

    const [pushRenderbuffer, popRenderbuffer] = genStack<WebGLRenderbuffer>((
        b,
    ) => gl.bindRenderbuffer(gl.RENDERBUFFER, b));

    const [pushViewport, popViewport] = genStack<
        { x: number; y: number; w: number; h: number }
    >((stack) => {
        if (!stack) return;
        const { x, y, w, h } = stack;

        gl.viewport(x, y, w, h);
    });

    const [pushProgram, popProgram] = genStack<WebGLProgram>((p) =>
        gl.useProgram(p)
    );

    pushViewport({
        x: 0,
        y: 0,
        w: gl.drawingBufferWidth,
        h: gl.drawingBufferHeight,
    });

    return {
        gl,
        opts,
        onDestroy,
        destroy,
        pushTexture2D,
        popTexture2D,
        pushArrayBuffer,
        popArrayBuffer,
        pushElementArrayBuffer,
        popElementArrayBuffer,
        pushFramebuffer,
        popFramebuffer,
        pushRenderbuffer,
        popRenderbuffer,
        pushViewport,
        popViewport,
        pushProgram,
        popProgram,
        setVertexFormat,
    };
}
