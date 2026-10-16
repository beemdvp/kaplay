import { Asset } from "../../assets/asset";
import { resolveShader } from "../../assets/shader";
import { DEF_ANCHOR } from "../../constants/general";
import { Color } from "../../math/color";
import { Quad } from "../../math/math";
import { Vec2 } from "../../math/Vec2";
import { _k } from "../../shared";
import { type Anchor, BlendMode, type RenderProps } from "../../types";
import { anchorPt } from "../anchor";
import type { Texture } from "../gfx";
import {
    height,
    multRotate,
    multScaleV,
    multSkewV,
    multTranslate,
    multTranslateV,
    popTransform,
    pushTransform,
    width,
} from "../stack";

const DEF_QUAD = new Quad(0, 0, 1, 1);

/**
 * How the UV Quad should look like.
 *
 * @group Draw
 * @subgroup Types
 */
export type DrawUVQuadOpt = RenderProps & {
    /**
     * Width of the UV quad.
     */
    width: number;
    /**
     * Height of the UV quad.
     */
    height: number;
    /**
     * If flip the texture horizontally.
     */
    flipX?: boolean;
    /**
     * If flip the texture vertically.
     */
    flipY?: boolean;
    /**
     * The texture to sample for this quad.
     */
    tex?: Texture;
    /**
     * The texture sampling area.
     */
    quad?: Quad;
    /**
     * The anchor point, or the pivot point. Default to "topleft".
     */
    anchor?: Anchor | Vec2;
};

export function drawUVQuad(opt: DrawUVQuadOpt) {
    if (opt.width === undefined || opt.height === undefined) {
        throw new Error(
            "drawUVQuad() requires property \"width\" and \"height\".",
        );
    }

    if (opt.width <= 0 || opt.height <= 0) {
        return;
    }

    const w = opt.width;
    const h = opt.height;
    const anchor = anchorPt(opt.anchor || DEF_ANCHOR);
    const offsetX = anchor.x * w * -0.5;
    const offsetY = anchor.y * h * -0.5;
    const q = opt.quad || DEF_QUAD;
    const color = opt.color || Color.WHITE;
    const opacity = opt.opacity ?? 1;
    const shader = resolveShader(opt.shader ?? _k.gfx.defShader);

    pushTransform();
    multTranslateV(opt.pos);
    multRotate(opt.angle);
    multScaleV(opt.scale);
    multSkewV(opt.skew);
    multTranslate(offsetX, offsetY);

    if (shader && !(shader instanceof Asset)) {
        const t = _k.gfx.transform;
        const halfW = w / 2;
        const halfH = h / 2;

        _k.gfx.renderer.pushQuad(
            t.a * -halfW + t.c * halfH + t.e,
            t.b * -halfW + t.d * halfH + t.f,
            t.a * -halfW + t.c * -halfH + t.e,
            t.b * -halfW + t.d * -halfH + t.f,
            t.a * halfW + t.c * -halfH + t.e,
            t.b * halfW + t.d * -halfH + t.f,
            t.a * halfW + t.c * halfH + t.e,
            t.b * halfW + t.d * halfH + t.f,
            opt.flipX ? q.x + q.w : q.x,
            opt.flipY ? q.y : q.y + q.h,
            opt.flipX ? q.x + q.w : q.x,
            opt.flipY ? q.y + q.h : q.y,
            opt.flipX ? q.x : q.x + q.w,
            opt.flipY ? q.y + q.h : q.y,
            opt.flipX ? q.x : q.x + q.w,
            opt.flipY ? q.y : q.y + q.h,
            color,
            opacity,
            shader,
            opt.tex ?? _k.gfx.whitePixel.tex,
            opt.uniform ?? null,
            opt.blend ?? BlendMode.Normal,
            width(),
            height(),
            _k.gfx.fixed || (opt.fixed ?? false),
        );
    }

    popTransform();
}
