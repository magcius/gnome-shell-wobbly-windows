
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const System = imports.system;

const Cogl = imports.gi.Cogl;
const Clutter = imports.gi.Clutter;
const Meta = imports.gi.Meta;

const X_TILES = 8;
const Y_TILES = 8;
const FRICTION = 2;
const SPRING_K = 14;
const MASS = 15;

const WobblyWindowObject = new Lang.Class({
    Name: 'WobblyWindowObject',

    _init: function(posX, posY) {
        this.posX = posX;
        this.posY = posY;

        this.velX = 0;
        this.velY = 0;

        this.forceX = 0;
        this.forceY = 0;

        this.immobile = false;
    },

    move: function(dX, dY) {
        this.posX += dX;
        this.posY += dY;
    },

    applyForce: function(fX, fY) {
        this.forceX += fX;
        this.forceY += fY;
    },

    step: function(friction, k) {
        if (this.immobile) {
            this.velX = 0;
            this.velY = 0;

            this.forceX = 0;
            this.forceY = 0;

            return [0, 0];
        }

        let fX = this.forceX - (friction * this.velX);
        let fY = this.forceY - (friction * this.velY);

        this.velX += fX / MASS;
        this.velY += fY / MASS;

        this.posX += this.velX;
        this.posY += this.velY;

        let totalForce = Math.abs(this.forceX + this.forceY);
        let totalVelocity = Math.abs(this.velX + this.velY);

        this.forceX = 0;
        this.forceY = 0;

        return [totalVelocity, totalForce];
    }
});

const WobblyWindowSpring = new Lang.Class({
    Name: 'WobblyWindowSpring',

    _init: function(objA, objB, offsetX, offsetY) {
        this.objA = objA;
        this.objB = objB;
        this.offsetX = offsetX;
        this.offsetY = offsetY;
    },

    step: function(friction, k) {
        let dx, dy;

        dx = (this.objB.posX - this.objA.posX - this.offsetX) * 0.5 * k;
        dy = (this.objB.posY - this.objA.posY - this.offsetY) * 0.5 * k;
        this.objA.applyForce(dx, dy);

        dx = (this.objA.posX - this.objB.posX + this.offsetX) * 0.5 * k;
        dy = (this.objA.posY - this.objB.posY + this.offsetY) * 0.5 * k;
        this.objB.applyForce(dx, dy);
    }
});

const WobblyWindowEffect = new Lang.Class({
    Name: 'WobblyWindowEffect',
    Extends: Clutter.DeformEffect,

    _init: function(params) {
        this.parent(params);
        this.allowStop = false;
        this.isWobbling = false;
        this._hasModel = false;
        this._anchorObject = null;
    },

    _setAnchorObject: function(obj) {
        if (this._anchorObject)
            this._anchorObject.immobile = false;

        this._anchorObject = obj;

        if (this._anchorObject)
            this._anchorObject.immobile = true;
    },

    _objectAt: function(x, y) {
        let yTiles = this.y_tiles + 1;
        let obj = this.objects[y * yTiles + x];
        if (!obj)
            throw new Error("No object at " + x + ", " + y);
        return obj;
    },

    _getActorDimensions: function() {
        let [success, box] = this.actor.get_paint_box();
        let x, y, width, height;
        if (success) {
            [x, y] = [box.x1, box.y1];
            [width, height] = [box.x2 - x, box.y2 - y];
        } else {
            [x, y] = this.actor.get_position();
            [width, height] = this.actor.get_size();
        }
        return [x, y, width, height];
    },

    setAnchorPosition: function(x, y) {
        let [ax, ay, width, height] = this._getActorDimensions();
        x -= ax; y -= ay;

        let gridX = Math.round(x / width * this.x_tiles);
        let gridY = Math.round(y / height * this.x_tiles);

        this._setAnchorObject(this._objectAt(gridX, gridY));
    },

    _invalidateModel: function() {
        this._hasModel = false;
    },

    _createModel: function() {
        let actor = this.get_actor();
        if (!actor)
            return false;

        let xTiles = this.x_tiles, yTiles = this.y_tiles;
        let [ax, ay, width, height] = this._getActorDimensions();

        this.objects = [];

        for (let i = 0; i < xTiles + 1; i++) {
            for (let j = 0; j < yTiles + 1; j++) {
                let tx = j / xTiles;
                let ty = i / yTiles;

                let x = tx * width;
                let y = ty * height;

                let obj = new WobblyWindowObject(ax + x, ay + y);

                this.objects.push(obj);
            }
        }

        let xRest = width / xTiles;
        let yRest = height / yTiles;

        this.springs = [];

        for (let y = 0; y < yTiles + 1; y++) {
            for (let x = 0; x < xTiles + 1; x++) {
                if (x > 0) {
                    let objA = this._objectAt(x - 1, y);
                    let objB = this._objectAt(x, y);
                    this.springs.push(new WobblyWindowSpring(objA, objB, xRest, 0));
                }

                if (y > 0) {
                    let objA = this._objectAt(x, y - 1);
                    let objB = this._objectAt(x, y);
                    this.springs.push(new WobblyWindowSpring(objA, objB, 0, yRest));
                }
            }
        }

        this._hasModel = true;
        return true;
    },

    _ensureModel: function() {
        if (!this._hasModel)
            return this._createModel();
        return true;
    },

    _positionChanged: function(oldX, oldY, newX, newY) {
        if (this._anchorObject)
            this._anchorObject.move(newX - oldX, newY - oldY);
    },

    _allocationChanged: function(actor, allocation, flags) {
        if (!this._oldAllocation) {
            this._oldAllocation = allocation;
            return;
        }

        let [oldX, oldY] = this._oldAllocation.get_origin();
        let [newX, newY] = allocation.get_origin();
        if (oldX != newX || oldY != newY)
            this._positionChanged(oldX, oldY, newX, newY);

        let [oldW, oldH] = this._oldAllocation.get_size();
        let [newW, newH] = allocation.get_size();
        if (oldW != newW || oldH != newH)
            this._invalidateModel();

        this._oldAllocation = allocation;
    },

    _modelStep: function() {
        if (!this._ensureModel())
            return;

        const friction = FRICTION;
        const k = SPRING_K;

        this.springs.forEach(function(s) {
            s.step(friction, k);
        });

        let totalForce = 0, totalVelocity = 0;
        this.objects.forEach(function(o) {
            let [force, velocity] = o.step(friction, k);
            totalForce += force;
            totalVelocity += velocity;
        });

        if (totalForce > 0)
            this.isWobbling = true;

        const epsilon = 0.2;

        // If the user is still grabbing on to the window, we don't
        // want to remove the effect, even if we've temporarily stopped
        // wobbling: if the user starts moving the window again, the
        // wobbling will have stopped.
        if (this.allowStop && this.isWobbling && totalVelocity < epsilon)
            this.remove();
    },

    ungrabbed: function() {
        // If we're wobbling, allow us to stop in the near future
        // when we stop wobbling. If we're not wobbling, remove
        // us now.
        if (this.isWobbling)
            this.allowStop = true;
        else
            this.remove();
    },

    remove: function() {
        this.get_actor().remove_effect(this);
    },

    _newFrame: function() {
        this._modelStep();
        this.invalidate();
    },

    _dimm: function() {
        let x1, y1, x2, y2;
        x1 = x2 = this.objects[0].posX;
        y1 = y2 = this.objects[0].posY;

        for (let i = 1; i < this.objects.length; i++) {
            let obj = this.objects[i];
            x1 = Math.min(x1, obj.posX);
            y1 = Math.min(y1, obj.posY);
            x2 = Math.max(x2, obj.posX);
            y2 = Math.max(y2, obj.posY);
        }

        return [x1, y1, x2, y2];
    },

    // vfunc_get_paint_volume: function(effect, volume) {
    //     volume.set_origin(Clutter.Vertex.new(-2000, -2000, 0));
    //     volume.set_width(2000);
    //     volume.set_height(2000);
    // },

    // vfunc_get_paint_volume: function(effect, volume) {
    //     return false;

    //     if (!this._hasModel)
    //         return true;

    //     let [x1, y1, x2, y2] = this._dimm();

    //     volume.set_origin(Clutter.Vertex.new(0, 0, 0));
    //     volume.set_width(x2 - x1);
    //     volume.set_height(y2 - y1);
    //     return true;
    // },

    _paintDebug: function() {
        let [x1, y1, x2, y2] = this._dimm();
        Cogl.path_new();
        Cogl.set_source_color4f(0, 1, 0, 0.2);
        Cogl.path_rectangle(0, 0, x2 - x1, y2 - y1);
        Cogl.path_fill();

        function point(x, y) {
            x -= ax; y -= ay;
            Cogl.path_rectangle(x-2, y-2, x+2, y+2);
        }

        function line(x1, y1, x2, y2) {
            x1 -= ax; x2 -= ax;
            y1 -= ay; y2 -= ay;
            Cogl.path_move_to(x1, y1);
            Cogl.path_line_to(x2, y2);
        }

        // let xTiles = this.x_tiles + 1;
        // let yTiles = this.y_tiles + 1;

        // Cogl.path_new();
        // Cogl.set_source_color4f(1, 0, 0, 1);

        // for (let x = 0; x < xTiles; x++) {
        //     for (let y = 0; y < yTiles; y++) {
        //         let o = this._objectAt(x, y);
        //         point(o.posX, o.posY);
        //     }
        // }
        // Cogl.path_fill();

        // Cogl.path_new();
        // Cogl.set_source_color4f(0, 1, 0, 1);
        // for (let x = 0; x < xTiles; x++) {
        //     for (let y = 0; y < yTiles; y++) {
        //         let o = this._objectAt(x, y);

        //         if (x > 0) {
        //             let left = this._objectAt(x - 1, y);
        //             line(left.posX, left.posY, o.posX, o.posY);
        //         }

        //         if (y > 0) {
        //             let top = this._objectAt(x, y - 1);
        //             line(top.posX, top.posY, o.posX, o.posY);
        //         }
        //     }
        // }
        // Cogl.path_stroke();
    },

    // vfunc_paint_target: function() {
    //     this.parent();
    //     this._paintDebug();
    // },

    vfunc_notify: function(effect, pspec) {
        // If someone changes the tile properties on us, make sure
        // to build a new model next time.
        if (pspec.name == "x-tiles" || pspec.name == "y-tiles" && this._hasModel)
            this._invalidateModel();
    },

    vfunc_deform_vertex: function(effect, width, height, vertex) {
        let i = Math.floor(vertex.tx * this.x_tiles);
        let j = Math.floor(vertex.ty * this.y_tiles);
        let obj = this._objectAt(i, j);

        let [ax, ay] = this.actor.get_position();

        // Objects are in the space of the actor's parent, and these
        // vertexes are in the space of the actor.
        vertex.x = obj.posX - ax;
        vertex.y = obj.posY - ay;

        // Put any anchor vertex on top of other vertices to make
        // things look right.
        if (obj == this._anchorObject)
            vertex.z = 1;
    },

    vfunc_set_actor: function(effect, actor) {
        let oldActor = this.get_actor();

        if (this._allocationChangedId > 0) {
            oldActor.disconnect(this._allocationChangedId);
            this._allocationChangedId = 0;
        }

        if (this._timeline) {
            this._timeline.run_dispose();
            this._timeline = null;
        }

        if (actor) {
            this._allocationChangedId = actor.connect('allocation-changed',
                                                      Lang.bind(this, this._allocationChanged));

            this._timeline = new Clutter.Timeline({ duration: 1000*1000 });
            this._timeline.connect('new-frame', Lang.bind(this, this._newFrame));
            this._timeline.start();
        }

        this.parent(actor);

        if (actor)
            this._ensureModel();
    }
});

let _beginGrabOpId;
let _endGrabOpId;

function onBeginGrabOp(display, op, window) {
    if (window.is_override_redirect())
        return;

    if (op != Meta.GrabOp.MOVING)
        return;

    let actor = window.get_compositor_private();

    let effect;
    effect = actor.get_effect('wobbly');
    if (!effect) {
        effect = new WobblyWindowEffect({ x_tiles: X_TILES, y_tiles: Y_TILES });
        actor.add_effect_with_name('wobbly', effect);
    }

    let [x, y, mods] = global.get_pointer();
    effect.setAnchorPosition(x, y);
}

function onEndGrabOp(display, op, window) {
    if (window.is_override_redirect())
        return;

    if (op != Meta.GrabOp.MOVING)
        return;

    let actor = window.get_compositor_private();

    let effect = actor.get_effect('wobbly');
    if (effect)
        effect.ungrabbed();
}

function init() {
}

function enable() {
    _beginGrabOpId = global.display.connect('begin-grab-op', onBeginGrabOp);
    _endGrabOpId = global.display.connect('end-grab-op', onEndGrabOp);
}

function disable() {
    global.display.disconnect(_beginGrabOpId);
    global.display.disconnect(_endGrabOpId);
    global.get_window_actors().forEach(function (actor) {
        actor.remove_effect_by_name('wobbly');
    });
}
