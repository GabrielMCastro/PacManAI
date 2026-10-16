import { LEFT, UP, RIGHT, DOWN } from "./definitions.js";

/**
 *  A ghost. Positions are in tenths of a tile like pacman's (see user.js), ghosts move 1 per tick,
 *  half pacman's speed. Movement is random, chasing pacman is turned off in move()
 */
export const Ghost = function (game, map, colour, fps, render) {

    var position  = null,   // {x, y} in tenths of a tile
        direction = null,   // Direction currently moving in
        eatable   = null,   // Tick a power pill made this ghost eatable, null if not eatable
        eaten     = null,   // Tick this ghost was eaten, null if not. Eaten ghosts are harmless until it expires
        due       = null;   // Direction to turn to at the next chance

    let vulnerableTimer // Unused
    
    // Position after one tick of movement in dir
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
    function isDangerous() {
        return eaten === null;
    };

    // Eaten and harmless, waiting to recover
    function isHidden() { 
        return eatable === null && eaten !== null;
    };
    
    // A random direction at right angles to the current one
    function getRandomDirection() {
        var moves = (direction === LEFT || direction === RIGHT) 
            ? [UP, DOWN] : [LEFT, RIGHT];
        return moves[Math.floor(Math.random() * 2)];
    };
    
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
    
    function oppositeDirection(dir) { 
        return dir === LEFT && RIGHT ||
            dir === RIGHT && LEFT ||
            dir === UP && DOWN || UP;
    };

    // Power pill eaten: turn around and become eatable
    function makeEatable() {
        direction = oppositeDirection(direction);
        eatable = game.getTick();
    };

    function eat() { 
        eatable = null;
        eaten = game.getTick();
    };

    function pointToCoord(x) {
        return Math.round(x / 10);
    };

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

    function onGridSquare(pos) {
        return onWholeSquare(pos.y) && onWholeSquare(pos.x);
    };

    // Treats 30 ticks as a second whatever the fps is, so this is (ticks since) / 30
    function secondsAgo(tick) { 
        return ((game.getTick() - tick) * (fps / 30)) / fps;
    };

    // Blue while eatable, flashing white for the last 3 "seconds", grey while eaten
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
    // Eatable lasts 8 "seconds" (240 ticks), eaten lasts 3 (90 ticks)
    function update() {
        if (eatable && secondsAgo(eatable) > 8) {
            eatable = null;
        }
        
        if (eaten && secondsAgo(eaten) > 3) { 
            eaten = null;
        }
    };

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
            
            due = getRandomDirection();            
            return move(ctx);
        }

        position = npos;        
        
        var tmp = pane(position);
        if (tmp) { 
            position = tmp;
        }
        
        // Change false to true to make the ghosts chase pacman
        due = false ? chasePacman(userPos ?? {x: 0, y: 0}, oldPos ?? {x: 0, y: 0}) : getRandomDirection();
        
        return {
            "new" : position,
            "old" : oldPos
        };
    };

    // Direction towards pacman: straight at it if lined up, otherwise turn towards it
    function chasePacman (uP, nP) {
        let xD = uP?.x - nP?.x
        let yD = uP?.y - nP?.y
        if (xD == 0) return yD > 0 ? DOWN : UP
        if (yD == 0) return xD > 0 ? RIGHT : LEFT
        return (direction === LEFT || direction === RIGHT) ? yD > 0 ? DOWN : UP : xD > 0 ? RIGHT : LEFT
    }
    
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