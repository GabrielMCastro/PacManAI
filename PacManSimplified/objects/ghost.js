import { LEFT, UP, RIGHT, DOWN } from "./definitions.js";

/**
 *  A ghost. Positions are in tenths of a tile like pacman's (see user.js), ghosts move 1 per tick,
 *  half pacman's speed. Movement is random, chasing pacman is turned off in move()
 *
 *  A factory function. game.js setMode() makes one per colour (the first ghostCount of GHOST_COLOURS) in the
 *  modes that have ghosts.
 *  game   - only needs getTick(), game.js passes {getTick}. All timing is in simulation ticks
 *  map    - the GameMap, for wall / floor checks
 *  colour - body colour when not eatable or eaten
 *  fps    - ticks per second of game time (TICKS_PER_SECOND), the same second starvation uses, see secondsAgo()
 *  render - false skips drawing
 *
 *  States, from the eatable and eaten ticks:
 *    normal     - eatable null, eaten null. Kills pacman on contact (isDangerous)
 *    vulnerable - eatable set (a power pill was eaten). Blue, flashing near the end; pacman eats it on contact (isVunerable)
 *    eaten      - eatable null, eaten set. Grey and harmless for 3 "seconds" (isHidden). Unlike the arcade game it
 *                 isn't sent back to the ghost house, it keeps wandering where it was eaten
 *  game.js update() checks isVunerable() first and isDangerous() second, so a vulnerable ghost gets eaten
 *  and an eaten one is ignored.
 */
export const Ghost = function (game, map, colour, fps, render, chase = false) {

    var position  = null,   // {x, y} in tenths of a tile
        direction = null,   // Direction currently moving in
        eatable   = null,   // Tick a power pill made this ghost eatable, null if not eatable
        eaten     = null,   // Tick this ghost was eaten, null if not. Eaten ghosts are harmless until it expires
        due       = null;   // Direction to turn to at the next chance (a new random one is picked every tick)

    let vulnerableTimer // Unused
    
    // Position after one tick of movement in dir
    // NOTE: the speed is 1 in every state. The ternary is left from the original daleharvey/pacman code, where
    // it was isVunerable() ? 1 : isHidden() ? 4 : 2 (slow while vulnerable, fast while eaten)
    function getNewCoord(dir, current) { 
        
        var speed  = isVunerable() ? 1 : isHidden() ? 1 : 1,
            xSpeed = (dir === LEFT && -speed || dir === RIGHT && speed || 0),
            ySpeed = (dir === DOWN && speed || dir === UP && -speed || 0);
    
        return {
            "x": addBounded(current.x, xSpeed),
            "y": addBounded(current.y, ySpeed)
        };
    };

    /* Collision detection(walls) is done when a ghost lands on an
     * exact block, make sure they dont skip over it 
     */
    // x1 is a coordinate, x2 the step. If the step would cross a whole tile it stops on that tile instead,
    // e.g. 98 + 4 gives 100, not 102. With today's speed of 1 a step can never cross a tile, so this always
    // returns x1 + x2; it mattered for the original speeds of 2 and 4
    function addBounded(x1, x2) { 
        var rem    = x1 % 10, 
            result = rem + x2;
        if (rem !== 0 && result > 10) {
            return x1 + (10 - rem);
        } else if(rem > 0 && result < 0) { 
            return x1 - rem;
        }
        return x1 + x2;
    };
    
    // Can be eaten (a power pill was eaten recently)
    function isVunerable() { 
        return eatable !== null;
    };
    
    // Kills pacman on contact. Also true while vulnerable, game.js checks isVunerable first
    // Also used by game.js as one of the network's ghost inputs
    function isDangerous() {
        return eaten === null;
    };

    // Eaten and harmless, waiting to recover
    function isHidden() { 
        return eatable === null && eaten !== null;
    };
    
    // A random direction at right angles to the current one
    // Never straight on or back, so the only time a ghost reverses is makeEatable().
    // When direction is null (the very first reset) it picks LEFT or RIGHT
    function getRandomDirection() {
        var moves = (direction === LEFT || direction === RIGHT) 
            ? [UP, DOWN] : [LEFT, RIGHT];
        return moves[Math.floor(Math.random() * 2)];
    };
    
    // Back to the start for a new game, called by game.js startLevel(). Every ghost starts on the same tile.
    // direction is picked at right angles to the direction left over from the last game, so it can be UP or DOWN.
    // That's fine: due is then LEFT or RIGHT, and the tiles either side of the start are floor on every map, so
    // the ghost turns on its first move. Ghosts never enter the ghost house, they can't turn into it
    function reset() {
        eaten = null;
        eatable = null;
        position = {"x": 90, "y": 80}; // Column 9, row 8, just above the ghost house
        direction = getRandomDirection();
        due = getRandomDirection();
        // timer
        // vulnerableTimer = window.setInterval(() => {
        //     console.log(eatable)
        //     if (eatable == null) {
        //         makeEatable()
        //     } else {
        //         eatable = null
        //     }
        // }, 5000)
    };
    
    function onWholeSquare(x) {
        return x % 10 === 0;
    };
    
    // The reverse of dir. Anything that isn't LEFT, RIGHT or UP (i.e. DOWN) gives UP
    function oppositeDirection(dir) { 
        return dir === LEFT && RIGHT ||
            dir === RIGHT && LEFT ||
            dir === UP && DOWN || UP;
    };

    // Power pill eaten: turn around and become eatable
    // Called by game.js eatenPill() for every ghost (with a ctx argument that's ignored). Reversing mid-tile is
    // safe because the ghost just came from there. Eating another pill restarts the timer.
    // A ghost that is currently eaten becomes vulnerable as well (eaten stays set until it expires)
    function makeEatable() {
        direction = oppositeDirection(direction);
        eatable = game.getTick();
    };

    // Pacman ate this ghost: no longer eatable, harmless until update() expires eaten. Called by game.js update()
    function eat() { 
        eatable = null;
        eaten = game.getTick();
    };

    // Position to tile index, rounded to the nearest tile. Exported, game.js uses it for the network's inputs
    function pointToCoord(x) {
        return Math.round(x / 10);
    };

    // The next whole tile position along dir, or x itself if already on a whole tile. Same as user.js nextSquare
    function nextSquare(x, dir) {
        var rem = x % 10;
        if (rem === 0) { 
            return x; 
        } else if (dir === RIGHT || dir === DOWN) { 
            return x + (10 - rem);
        } else {
            return x - rem;
        }
    };

    // Exactly on a tile (both x and y whole), the only time a ghost turns or checks for walls
    function onGridSquare(pos) {
        return onWholeSquare(pos.y) && onWholeSquare(pos.x);
    };

    // Seconds of game time since the given tick, fps ticks to a second like starvation in game.js
    // (it used to treat 30 ticks as a second, the original game's rate, so ghost timers ran 5x faster than starvation)
    function secondsAgo(tick) { 
        return (game.getTick() - tick) / fps;
    };

    // Blue while eatable, flashing white for the last 3 "seconds", grey while eaten
    // The flash switches every 10 ticks. eatable and eaten are tested for truthiness, which would miss tick 0,
    // but game.js increments tick before anything can set them
    function getColour() { 
        if (eatable) { 
            if (secondsAgo(eatable) > 5) { 
                return game.getTick() % 20 > 10 ? "#FFFFFF" : "#0000BB";
            } else { 
                return "#0000BB";
            }
        } else if(eaten) { 
            return "#222";
        } 
        return colour;
    };

    // Expire the eatable/eaten states, called every simulation tick
    // Eatable lasts 8 seconds (1200 ticks at 150 ticks a second), eaten lasts 3 (450 ticks)
    // Called by game.js update() just before move()
    function update() {
        if (eatable && secondsAgo(eatable) > 8) {
            eatable = null;
        }
        
        if (eaten && secondsAgo(eaten) > 3) { 
            eaten = null;
        }
    };

    // Draws the ghost: a rounded body with a wavy bottom edge (the waves flip back and forth as the tick count
    // goes up), and eyes that look in its direction. top / left convert the position to canvas pixels like user.js draw().
    // The eye positions (6 pixels in) and the arcs' end angle of 300 radians (more than a full circle, so a
    // full circle is drawn) come from the original code
    function draw(ctx) {
        if (render) {
            var s    = map.blockSize, 
                top  = (position.y/10) * s,
                left = (position.x/10) * s;
            
            var tl = left + s;
            var base = top + s - 3;
            var inc = s / 10;

            var high = game.getTick() % 10 > 5 ? 3  : -3;
            var low  = game.getTick() % 10 > 5 ? -3 : 3;

            ctx.fillStyle = getColour();
            ctx.beginPath();

            ctx.moveTo(left, base);

            ctx.quadraticCurveTo(left, top, left + (s/2),  top);
            ctx.quadraticCurveTo(left + s, top, left+s,  base);
            
            // Wavy things at the bottom
            ctx.quadraticCurveTo(tl-(inc*1), base+high, tl - (inc * 2),  base);
            ctx.quadraticCurveTo(tl-(inc*3), base+low, tl - (inc * 4),  base);
            ctx.quadraticCurveTo(tl-(inc*5), base+high, tl - (inc * 6),  base);
            ctx.quadraticCurveTo(tl-(inc*7), base+low, tl - (inc * 8),  base); 
            ctx.quadraticCurveTo(tl-(inc*9), base+high, tl - (inc * 10), base); 

            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.fillStyle = "#FFF";
            ctx.arc(left + 6,top + 6, s / 6, 0, 300, false);
            ctx.arc((left + s) - 6,top + 6, s / 6, 0, 300, false);
            ctx.closePath();
            ctx.fill();

            var f = s / 12;
            var off = {};
            off[RIGHT] = [f, 0];
            off[LEFT]  = [-f, 0];
            off[UP]    = [0, -f];
            off[DOWN]  = [0, f];

            ctx.beginPath();
            ctx.fillStyle = "#000";
            ctx.arc(left+6+off[direction][0], top+6+off[direction][1], 
                    s / 15, 0, 300, false);
            ctx.arc((left+s)-6+off[direction][0], top+6+off[direction][1], 
                    s / 15, 0, 300, false);
            ctx.closePath();
            ctx.fill();
        }
    };

    // Wraps through the tunnel at the left and right edges, returns the new position or false
    // Going right, x = 190 (column 19, just off the board) becomes -10 (column -1, just off the left edge).
    // Going left, -10 becomes 190. Every row wraps, the commented out y check limited it to the original tunnel row.
    // Off the board the tile checks are false (not floor, not wall), so the ghost carries straight on.
    // NOTE: pacman wraps at -12 rather than -10 on the left (user.js move()), as in the original code.
    // NOTE: the left branch also assigns position itself; move() sets position to the result anyway
    function pane(pos) {

        if (pos.x >= 190 && direction === RIGHT) { //pos.y === 100 && 
            return {"y": pos.y, "x": -10};
        }
        
        if (pos.x <= -10 && direction === LEFT) { //pos.y === 100 && 
            return position = {"y": pos.y, "x": 190};
        }

        return false;
    };
    
    // Move one tick, turning to due where possible and picking a new random direction at walls.
    // Returns the new and old positions
    // Called by game.js update() every tick while PLAYING, before pacman moves. game.js uses "new" for collisions
    // and "old" for the network's ghost inputs. userPos is only for chasePacman, ctx and i (the ghost's index) are unused.
    //
    // Step by step:
    //  1. If due differs from direction, turn to it only when exactly on a tile and the tile that way is floor
    //     (so never into the ghost house). Unlike pacman there is no instant reversal, due is never the reverse.
    //  2. Otherwise keep going in direction.
    //  3. On a tile with a wall ahead: pick a new random due and run move() again, until a turn works.
    //  4. Wrap through the tunnel (pane).
    //  5. Pick a new random due for next tick.
    // Because due is a fresh random perpendicular every tick, at a crossing with both sides open the ghost always
    // turns (never goes straight), and with one side open it turns half the time.
    // NOTE: step 3 relies on there being no dead ends. In a dead end (wall ahead and on both sides) move() would
    // call itself until the stack overflows. None of the current maps has a dead end a ghost can reach.
    function move(ctx, userPos, i) {
        
        var oldPos = position,
            onGrid = onGridSquare(position),
            npos   = null;
        
        if (due !== direction) {
            
            npos = getNewCoord(due, position);
            
            if (onGrid &&
                map.isFloorSpace({
                    "y":pointToCoord(nextSquare(npos.y, due)),
                    "x":pointToCoord(nextSquare(npos.x, due))})) {
                direction = due;
            } else {
                npos = null;
            }
        }
        
        if (npos === null) {
            npos = getNewCoord(direction, position);
        }
        
        if (onGrid &&
            map.isWallSpace({
                "y" : pointToCoord(nextSquare(npos.y, direction)),
                "x" : pointToCoord(nextSquare(npos.x, direction))
            })) {
            
            // The retry doesn't pass userPos, fine while chasePacman is off (and it falls back to {x: 0, y: 0})
            due = getRandomDirection();            
            return move(ctx, userPos, i); // Pass pacman's position on, the retry's chase would aim at (0, 0) without it
        }

        position = npos;        
        
        var tmp = pane(position);
        if (tmp) { 
            position = tmp;
        }
        
        // Change false to true to make the ghosts chase pacman
        // Chasing ghosts head for pacman, but only in their normal state: while eatable (frightened) or eaten they
        // wander at random like the other ghosts, as in the arcade game
        let normal = eatable === null && eaten === null
        due = (chase && normal) ? chasePacman(userPos ?? {x: 0, y: 0}, oldPos ?? {x: 0, y: 0}) : getRandomDirection();
        
        return {
            "new" : position,
            "old" : oldPos
        };
    };

    // Direction towards pacman: straight at it if lined up, otherwise turn towards it
    // uP is pacman's position (game.js passes last tick's, prevUserPos), nP the ghost's position before this
    // tick's move. Unused while move() has it switched off.
    // If switched on, it can return the current direction or its reverse, which getRandomDirection never does.
    // A reverse would then only be taken on a tile with floor behind, through step 1 of move()
    function chasePacman (uP, nP) {
        let xD = uP?.x - nP?.x
        let yD = uP?.y - nP?.y
        if (xD == 0) return yD > 0 ? DOWN : UP
        if (yD == 0) return xD > 0 ? RIGHT : LEFT
        return (direction === LEFT || direction === RIGHT) ? yD > 0 ? DOWN : UP : xD > 0 ? RIGHT : LEFT
    }
    
    // Public API (isHidden, getColour, etc. are internal)
    return {
        "eat"         : eat,
        "isVunerable" : isVunerable,
        "isDangerous" : isDangerous,
        "makeEatable" : makeEatable,
        "reset"       : reset,
        "move"        : move,
        "update"      : update,
        "draw"        : draw,
        "pointToCoord" : pointToCoord,
    };
};