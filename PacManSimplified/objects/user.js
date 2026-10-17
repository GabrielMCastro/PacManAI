import { KEY, LEFT, UP, RIGHT, DOWN, NONE, OBJECTS, DYING } from "./definitions.js";

/**
 *  Pacman
 *  Positions are in tenths of a tile: {x: 90, y: 120} is column 9, row 12. Pacman moves 2 per tick,
 *  so it takes 5 ticks to cross a tile, and can only turn when exactly on a tile (x and y multiples of 10)
 *
 *  (These units are sometimes called pixels; there are 10 per tile whatever the canvas size. Drawing converts
 *  with (position / 10) * blockSize. Pacman always sits on a whole row or a whole column, never between both.)
 *
 *  A factory function, created once in game.js init():
 *  game     - callbacks into the game: completedLevel() when the last biscuit or pill is eaten, eatenPill() when
 *             a power pill is eaten (makes the ghosts eatable), ateFood() on every biscuit or pill (resets starvation)
 *  map      - the GameMap, used to check walls / floor and to eat tiles
 *  render   - false skips drawing
 *  setState - game.js's setState. Only used by the commented out timers, so it's effectively unused
 *
 *  Two directions are tracked. due is the direction asked for (by the network through setDirection, or the
 *  arrow keys), direction is the one pacman is really moving in. move() switches direction to due as soon
 *  as that's allowed, so a turn asked for a bit early is remembered and taken at the next opening.
 */
export const User = function (game, map, render, setState) {
    
    var position  = null,   // {x, y} in tenths of a tile
        direction = null,   // Direction currently moving in
        eaten     = null,   // Biscuits and pills eaten this level
        due       = null,   // Direction requested (by the AI), taken as soon as that way is open
        lives     = null,
        score     = 5,      // Overwritten with 0 by initUser() before anything reads it
        keyMap    = {},     // Arrow key code -> direction
        eatenTimer, suicideTimer, scoreTimer; // Unused, replaced by tick based starvation in game.js
    
    keyMap[KEY.ARROW_LEFT]  = LEFT;
    keyMap[KEY.ARROW_UP]    = UP;
    keyMap[KEY.ARROW_RIGHT] = RIGHT;
    keyMap[KEY.ARROW_DOWN]  = DOWN;

    // Adds points, and an extra life the first time the score passes 10000
    // Called by move() (10 per biscuit, 50 per power pill) and by game.js update() for eaten ghosts
    // (50, 100, 150... per ghost since the last power pill)
    function addScore(nScore) { 
        score += nScore;
        if (score >= 10000 && score - nScore < 10000) { 
            lives += 1;
        }
    };

    // The current score. game.js uses this for the footer and the fitness (AI.finishGame), not the "score" field below
    function theScore() { 
        return score;
    };

    // Called by game.js loseLife() when pacman dies (state DYING). game.js ends the game when getLives() reaches 0
    function loseLife() { 
        lives -= 1;
        if (lives <= 0) {
            // clearTimeout(suicideTimer)
            // clearInterval(scoreTimer)
        }
    };

    function getLives() {
        return lives;
    };

    // New game: score 0, lives, fresh level. Called when the user is created and by reset()
    function initUser(setState) {
        score = 0;
        // One life (the original game had 3), so the first death ends the game and the network gets scored
        lives = 1//3;
        newLevel();
    }
    
    // Back to the start position with nothing eaten yet. Called by initUser(); game.js's call is commented out
    function newLevel() {
        resetPosition();
        eaten = 0;
        // eatenTimer = window.setTimeout(() => setState(DYING), 5000);
    };
    
    // Start position: column 9, row 12 (below the ghost house), facing and asking to go left.
    // Called by game.js startLevel() (every game), newLevel() and reset()
    function resetPosition() {
        position = {"x": 90, "y": 120};
        direction = LEFT;
        due = LEFT;
    };
    
    // Full reset for a new game, called by game.js startNewGame().
    // initUser() already calls resetPosition() through newLevel(), so the second call is redundant but harmless
    function reset(setState) {
        initUser(setState);
        resetPosition();
        // timers
        // suicideTimer = window.setTimeout(() => setState(DYING), 30000)
        // scoreTimer = window.setInterval(() => score += 1, 100)
    };        
    
    // Set the requested direction from the AI's numbering, 0 = LEFT, 1 = UP, 2 = RIGHT, 3 = DOWN (clockwise)
    // Called by game.js step(). The network answers relative to where pacman is heading (0 straight,
    // 1 turn right, 2 turn around, 3 turn left) and game.js adds getDirection() mod 4. That works because the
    // numbering goes clockwise: e.g. heading LEFT (0), "turn right" (1) gives 1 = UP.
    // This only sets due; move() decides when pacman can actually turn. Any other value is ignored
    function setDirection(x)
    {
        switch(x)
        {
            case 0: 
                due = LEFT;
                break;
            case 1:
                due  = UP;
                break;
            case 2:
                due  = RIGHT;
                break;
            case 3:
                due  = DOWN;
                break;
        }
    }

    // The requested direction in the AI's numbering, see setDirection
    // It reads due, not direction, so it is never NONE (due is only ever set to the four directions) and the
    // network's relative answers still make sense while pacman is stopped against a wall
    function getDirection() {
        switch(due) {
            case LEFT:
                return 0
            case UP:
                return 1
            case RIGHT:
                return 2
            case DOWN:
                return 3
        }
    }

    // Arrow keys set due, for playing by hand. game.js forwards key presses here.
    // Returns false (and stops the event) for arrow keys, true otherwise.
    // While the network is playing it overwrites due every decision, so keys only nudge it briefly
    function keyDown(e) {
        if (typeof keyMap[e.keyCode] !== "undefined") { 
            due = keyMap[e.keyCode];
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
        return true;
	};

    // Position after one tick of movement in dir
    // 2 units (a fifth of a tile) along dir. NONE (or anything else) leaves the position as it is.
    // The x && 2 || y pattern is an old style if/else: the first matching direction gives its step, otherwise 0
    function getNewCoord(dir, current) {   
        return {
            "x": current.x + (dir === LEFT && -2 || dir === RIGHT && 2 || 0),
            "y": current.y + (dir === DOWN && 2 || dir === UP    && -2 || 0)
        };
    };

    // Whether one coordinate (x or y) is exactly on a tile, i.e. a multiple of 10.
    // Also true for negative multiples (-10 % 10 is -0, and -0 === 0)
    function onWholeSquare(x) {
        return x % 10 === 0;
    };

    // Position to tile index, rounded to the nearest tile
    // Also exported, game.js uses it to find pacman's tile for the network's inputs
    function pointToCoord(x) {
        return Math.round(x/10);
    };
    
    // The next whole tile position along dir, or x itself if already on a whole tile
    // Works on one coordinate. E.g. x = 94: RIGHT or DOWN gives 100, LEFT or UP gives 90. next() applies it to
    // both x and y with the same dir; the coordinate across the direction of travel is always whole, so it
    // comes back unchanged.
    // NOTE: for negative x (only in the left tunnel) JS's % keeps the sign, e.g. -8 % 10 is -8, so moving right
    // from -8 gives -8 + 18 = 10 (tile 1) instead of 0 (tile 0), and moving left from -2 gives 0 instead of -10.
    // The tunnel rows are open on tiles 0 and 1 so this goes unnoticed, apart from tile 1 being treated as the
    // tile ahead (and eaten) while pacman is still off the board
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

    // Tile pacman is heading into, as {y, x} tile indexes
    // When pos is exactly on a tile that tile itself is returned, so move() passes the position one step ahead
    // (npos) to look at the tile beyond the current one. Between tiles it's the tile being moved towards
    function next(pos, dir) {
        return {
            "y" : pointToCoord(nextSquare(pos.y, dir)),
            "x" : pointToCoord(nextSquare(pos.x, dir)),
        };                               
    };

    // Exactly on a tile (both x and y whole). The only time pacman may turn a corner or stop at a wall
    function onGridSquare(pos) {
        return onWholeSquare(pos.y) && onWholeSquare(pos.x);
    };

    // True if both directions are horizontal or both are vertical, reversing is allowed at any time
    // (the tile behind pacman is always open, it just came from there). False when either one is NONE
    function isOnSamePlane(due, dir) { 
        return ((due === LEFT || due === RIGHT) && 
                (dir === LEFT || dir === RIGHT)) || 
            ((due === UP || due === DOWN) && 
             (dir === UP || dir === DOWN));
    };

    // Move one tick: turn to due if possible, stop at walls, wrap through the tunnel, eat what's ahead.
    // Returns the new and old positions
    // Called by game.js update() every tick while PLAYING, after the ghosts have moved. game.js uses "new" for
    // collisions and the network's inputs. ctx and setState are unused.
    //
    // Turning, step by step:
    //  1. If due differs from direction, try one step in due. It's taken straight away when it's a reversal
    //     (isOnSamePlane), or when pacman is exactly on a tile (onGridSquare) and the tile in that direction is
    //     floor. Otherwise due is left as it is and tried again next tick, so a turn asked for early happens at
    //     the next opening.
    //  2. If not turning, step in the current direction.
    //  3. If pacman is on a tile and the tile ahead is a wall, it stops (direction NONE) and stays put until
    //     due points somewhere open. Being on a tile when stopped, step 1 lets it go as soon as that happens.
    //  4. Wrap through the tunnel at the left and right edges.
    //  5. Eat the biscuit or pill in the tile being entered.
    function move(ctx, setState) {
        
        var npos        = null, 
            nextWhole   = null, 
            oldPosition = position,
            block       = null;
        
        if (due !== direction) {
            npos = getNewCoord(due, position);
            
            if (isOnSamePlane(due, direction) || 
                (onGridSquare(position) && 
                 map.isFloorSpace(next(npos, due)))) {
                direction = due;
            } else {
                npos = null;
            }
        }

        if (npos === null) {
            npos = getNewCoord(direction, position);
        }
        
        if (onGridSquare(position) && map.isWallSpace(next(npos, direction))) {
            direction = NONE;
        }

        if (direction === NONE) {
            return {"new" : position, "old" : position};
        }
        
        // Tunnel. The last column is 18 (x = 180). Going right, reaching x = 190 (column 19, off the board)
        // jumps to x = -10 (column -1, just off the left edge) and pacman walks back on from the left.
        // Going left it carries on to -12 before jumping to 190, just off the right edge.
        // Every row is wrapped, the commented out y check limited it to the original maze's tunnel row.
        // NOTE: the left threshold is -12 here but -10 in ghost.js pane(), so pacman spends one extra tick at -10.
        // While off the board, map.isFloorSpace / isWallSpace are false for column -1 or 19, so it can't turn there
        if (npos.x >= 190 && direction === RIGHT) { //npos.y === 100 && 
            npos = {"y": npos.y, "x": -10};
        }
        
        if (npos.x <= -12 && direction === LEFT) { //npos.y === 100 && 
            npos = {"y": npos.y, "x": 190};
        }
        
        position = npos;        
        nextWhole = next(position, direction);
        
        block = map.block(nextWhole);        
        
        // Eating. && binds tighter than ||, so this reads (mid square && biscuit) || pill. isMidSquare is always
        // true (see below), so in practice it's "a biscuit or pill in the tile being entered". That tile is eaten on
        // the first tick pacman moves towards it (2 units in), not when it reaches the middle.
        // On a whole tile nextWhole is the tile pacman is on, already empty
        if ((isMidSquare(position.y) || isMidSquare(position.x)) &&
            block === OBJECTS.BISCUIT || block === OBJECTS.PILL) {
            
            map.setBlock(nextWhole, OBJECTS.EMPTY);           
            addScore((block === OBJECTS.BISCUIT) ? 10 : 50);
            eaten += 1;
            
            // Every biscuit and pill on this map eaten
            // eaten counts this game's food and is reset by newLevel(), getFoodCount() is the total at the last
            // map reset. game.js completedLevel() counts a win and ends the game. It runs before eatenPill() and
            // ateFood() below, which are still called for the last piece
            if (eaten === map.getFoodCount()) {
                game.completedLevel();
            }
            
            if (block === OBJECTS.PILL) { 
                game.eatenPill();
            }

            game.ateFood();
        }   
                
        return {
            "new" : position,
            "old" : oldPosition,
        };
    };

    // Meant to check that a coordinate is near the middle of its way between two tiles, before eating
    function isMidSquare(x) { 
        var rem = x % 10;
        // Always true (every number is > 3 or < 7, probably meant &&), so move() eats whatever
        // biscuit or pill is in the next tile straight away
        var ret = rem > 3 || rem < 7;
        // if (ret) console.log(ret)
        return ret
    };

    // Mouth angles for drawing, opens and closes as pacman crosses each tile
    // Open (a wedge facing dir) for the first half of each tile, closed (a full circle) for the second half
    // and when stopped. start and end are in multiples of PI radians, direction is the arc's anticlockwise flag
    function calcAngle(dir, pos) { 
        if (dir == RIGHT && (pos.x % 10 < 5)) {
            return {"start":0.25, "end":1.75, "direction": false};
        } else if (dir === DOWN && (pos.y % 10 < 5)) { 
            return {"start":0.75, "end":2.25, "direction": false};
        } else if (dir === UP && (pos.y % 10 < 5)) { 
            return {"start":1.25, "end":1.75, "direction": true};
        } else if (dir === LEFT && (pos.x % 10 < 5)) {             
            return {"start":0.75, "end":1.25, "direction": true};
        }
        return {"start":0, "end":2, "direction": false};
    };

    // Death animation frame: a circle with a growing gap, amount from 0 to 1 (nothing drawn once it reaches 1).
    // Not called by game.js at the moment, dying ends the game straight away
    function drawDead(ctx, amount) { 
        if (render) {
            var size = map.blockSize, 
                half = size / 2;

            if (amount >= 1) { 
                return;
            }

            ctx.fillStyle = "#FFFF00";
            ctx.beginPath();        
            ctx.moveTo(((position.x/10) * size) + half, 
                    ((position.y/10) * size) + half);
            
            ctx.arc(((position.x/10) * size) + half, 
                    ((position.y/10) * size) + half,
                    half, 0, Math.PI * 2 * amount, true); 
            
            ctx.fill(); 
        }   
    };

    // Draws pacman at its position, scaled to canvas pixels (position / 10 tiles * blockSize).
    // Called by game.js draw() every frame
    function draw(ctx) { 
        if (render) {
            var s     = map.blockSize, 
                angle = calcAngle(direction, position);

            ctx.fillStyle = "#FFFF00";

            ctx.beginPath();        

            ctx.moveTo(((position.x/10) * s) + s / 2,
                    ((position.y/10) * s) + s / 2);
            
            ctx.arc(((position.x/10) * s) + s / 2,
                    ((position.y/10) * s) + s / 2,
                    s / 2, Math.PI * angle.start, 
                    Math.PI * angle.end, angle.direction); 
            
            ctx.fill();  
        }  
    };

    // Current {x, y} in tenths of a tile, used by game.js
    function getPosition() {
        return position
    }
    
    // Start a game straight away so everything has a value. game.js resets again in startNewGame()
    initUser(setState);

    // Public API.
    // NOTE: "score" is copied when this object is built (0, after initUser()) and never changes, use theScore().
    // Nothing in game.js reads it
    return {
        "draw"          : draw,
        "drawDead"      : drawDead,
        "loseLife"      : loseLife,
        "getLives"      : getLives,
        "score"         : score,
        "addScore"      : addScore,
        "theScore"      : theScore,
        "keyDown"       : keyDown,
        "move"          : move,
        "newLevel"      : newLevel,
        "reset"         : reset,
        "resetPosition" : resetPosition,
        "getPosition"   : getPosition,
        "setDirection"  : setDirection,
        "getDirection"  : getDirection,
        "pointToCoord"  : pointToCoord,
    };
};