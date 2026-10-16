import {
    resetTreeIndex,
    updateLastTransformVersion,
} from "../../ecs/entity/GameObjRaw";
import { lerp } from "../../math/lerp";
import { rand } from "../../math/random";
import { Vec2 } from "../../math/Vec2";
import { _k } from "../../shared";
import { center, flush, height, width } from "../stack";

export function transformFrame() {
    resetTreeIndex();
    _k.game.root.transformTree(false);
    updateLastTransformVersion();
}

export function drawFrame() {
    // calculate camera matrix
    const cam = _k.game.cam;
    const shakeAmount = cam.shake;

    cam.shake = lerp(cam.shake, 0, 5 * _k.app.dt());
    const camX = cam.pos ? cam.pos.x : width() / 2;
    const camY = cam.pos ? cam.pos.y : height() / 2;

    cam.transform.setIdentity()
        .translateSelfV(center())
        .scaleSelfV(cam.scale)
        .rotateSelf(cam.angle);

    if (shakeAmount !== 0) {
        const shake = Vec2.fromAngle(rand(0, 360)).scale(shakeAmount);
        cam.transform.translateSelf(-camX + shake.x, -camY + shake.y);
    }
    else {
        cam.transform.translateSelf(-camX, -camY);
    }

    _k.app.state.events.trigger("draw");
    _k.game.root.draw();
    flush();
}
