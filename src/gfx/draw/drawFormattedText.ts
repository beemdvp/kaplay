import type { FontData } from "../../assets/font";
import type { Uniform } from "../../assets/shader";
import { Color } from "../../math/color";
import type { Vec2 } from "../../math/Vec2";
import { anchorPt } from "../anchor";
import type { StyledTextInfo } from "../formatText";
import type { Texture } from "../gfx";
import {
    multRotate,
    multTranslate,
    multTranslateV,
    popTransform,
    pushTransform,
} from "../stack";
import type { Frame } from "../TexPacker";
import type { DrawTextOpt } from "./drawText";
import { drawUVQuad } from "./drawUVQuad";

/**
 * Formatted text with info on how and where to render each character.
 *
 * @group Rendering
 * @subgroup Text
 */
export type FormattedText = {
    width: number;
    height: number;
    chars: FormattedChar[];
    groupedChars?: FormattedChar[];
    opt: DrawTextOpt;
    renderedText: string;
};

/**
 * One formatted character.
 *
 * @group Rendering
 * @subgroup Text
 */
export interface FormattedChar {
    ch: string;
    frame: Frame;
    width: number;
    height: number;
    initPos: Vec2;
    pos: Vec2;
    initScale: Vec2;
    scale: Vec2;
    skew: Vec2;
    angle: number;
    color: Color;
    opacity: number;
    font?: string | FontData;
    stretchInPlace: boolean;
    shader?: string;
    uniform?: Uniform;
    textCursor: number;
    styles: StyledTextInfo["charStyleMap"][number];
}

export function groupCharsByTexture(chars: FormattedChar[]): FormattedChar[] {
    const groups = new Map<Texture, FormattedChar[]>();

    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const group = groups.get(ch.frame.tex);
        if (group) {
            group.push(ch);
        }
        else {
            groups.set(ch.frame.tex, [ch]);
        }
    }

    const grouped: FormattedChar[] = [];
    groups.forEach((group) => {
        for (let i = 0; i < group.length; i++) {
            grouped.push(group[i]);
        }
    });
    return grouped;
}

// cSpell: ignore ftext
export function drawFormattedText(ftext: FormattedText) {
    pushTransform();
    multTranslateV(ftext.opt.pos!);
    multRotate(ftext.opt.angle!);
    const anchor = anchorPt(ftext.opt.anchor ?? "topleft");
    multTranslate(
        (anchor.x + 1) * ftext.width * -0.5,
        (anchor.y + 1) * ftext.height * -0.5,
    );

    const chars = ftext.groupedChars ?? groupCharsByTexture(ftext.chars);

    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        drawUVQuad({
            tex: ch.frame.tex,
            quad: ch.frame.q,
            width: ch.width,
            height: ch.height,
            pos: ch.pos,
            scale: ch.scale,
            angle: ch.angle,
            color: ch.color,
            skew: ch.skew,
            opacity: ch.opacity,
            anchor: "center",
            uniform: ch.uniform ?? ftext.opt.uniform,
            shader: ch.shader ?? ftext.opt.shader,
            fixed: ftext.opt.fixed,
        });
    }

    popTransform();
}
