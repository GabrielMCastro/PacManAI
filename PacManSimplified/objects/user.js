import { KEY, LEFT, UP, RIGHT, DOWN, NONE, OBJECTS, DYING } from "./definitions.js";

/**
 *  Pacman
 *  Positions are in tenths of a tile: {x: 90, y: 120} is column 9, row 12. Pacman moves 2 per tick,
 *  so it takes 5 ticks to cross a tile, and can only turn when exactly on a tile (x and y multiples of 10)
 */
export const User = function (game, map, render, setState) {
    
    var position  = null,   // {x, y} in tenths of a tile
        direction = null,   // Direction currently moving in
        eaten     = null,   // Biscuits and pills eaten this level
        due       = null,   // Direction requested (by the AI), taken as soon as that way is open
        lives     = null,
        score     = 5,
        keyMap    = {},     // Arrow key code -> direction
        eatenTimer, suicideTimer, scoreTimer; // Unused, replaced by tick based starvation in game.js
    
    keyMap[KEY.ARROW_LEFT]  = LEFT;
    keyMap[KEY.ARROW_UP]    = UP;
    keyMap[KEY.ARROW_RIGHT] = RIGHT;
    keyMap[KEY.ARROW_DOWN]  = DOWN;

    // Adds points, and an extra life the first time the score passes 10000
    function addScore(nScore) { 
        score += nScore;
        if (score >= 10000 && score - nScore < 10000) { 
            lives += 1;
        }
    };

    function theScore() { 
        return score;
    };

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

    function initUser(setState) {
        score = 0;
        lives = 1//3;
        newLevel();
    }
    
    function newLevel() {
        resetPosition();
        eaten = 0;
        // eatenTimer = window.setTimeout(() => setState(DYING), 5000);
    };
    
    function resetPosition() {
        position = {"x": 90, "y": 120};
        direction = LEFT;
        due = LEFT;
    };
    
    function reset(setState) {
        initUser(setState);
        resetPosition();
        // timers
        // suicideTimer = window.setTimeout(() => setState(DYING), 30000)
        // scoreTimer = window.setInterval(() => score += 1, 100)
    };        
    
    // Set the requested direction from the AI's numbering, 0 = LEFT, 1 = UP, 2 = RIGHT, 3 = DOWN (clockwise)
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
    function getNewCoord(dir, current) {   
        return {
            "x": current.x + (dir === LEFT && -2 || dir === RIGHT && 2 || 0),
            "y": current.y + (dir === DOWN && 2 || dir === UP    && -2 || 0)
        };
    };

    function onWholeSquare(x) {
        return x % 10 === 0;
    };

    // Position to tile index, rounded to the nearest tile
    function pointToCoord(x) {
        return Math.round(x/10);
    };
    
    // The next whole tile position along dir, or x itself if already on a whole tile
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
    function next(pos, dir) {
        return {
            "y" : pointToCoord(nextSquare(pos.y, dir)),
            "x" : pointToCoord(nextSquare(pos.x, dir)),
        };                               
    };

    function onGridSquare(pos) {
        return onWholeSquare(pos.y) && onWholeSquare(pos.x);
    };

    // True if both directions are horizontal or both are vertical, reversing is allowed at any time
    function isOnSamePlane(due, dir) { 
        return ((due === LEFT || due === RIGHT) && 
                (dir === LEFT || dir === RIGHT)) || 
            ((due === UP || due === DOWN) && 
             (dir === UP || dir === DOWN));
    };

    // Move one tick: turn to due if possible, stop at walls, wrap through the tunnel, eat what's ahead.
    // Returns the new and old positions
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
        
        if (npos.x >= 190 && direction === RIGHT) { //npos.y === 100 && 
            npos = {"y": npos.y, "x": -10};
        }
        
        if (npos.x <= -12 && direction === LEFT) { //npos.y === 100 && 
            npos = {"y": npos.y, "x": 190};
        }
        
        position = npos;        
        nextWhole = next(position, direction);
        
        block = map.block(nextWhole);        
        
        if ((isMidSquare(position.y) || isMidSquare(position.x)) &&
            block === OBJECTS.BISCUIT || block === OBJECTS.PILL) {
            
            map.setBlock(nextWhole, OBJECTS.EMPTY);           
            addScore((block === OBJECTS.BISCUIT) ? 10 : 50);
            eaten += 1;
            
            // Every biscuit and pill on this map eaten
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

    function isMidSquare(x) { 
        var rem = x % 10;
        // Always true (every number is > 3 or < 7, probably meant &&), so move() eats whatever
        // biscuit or pill is in the next tile straight away
        var ret = rem > 3 || rem < 7;
        // if (ret) console.log(ret)
        return ret
    };

    // Mouth angles for drawing, opens and closes as pacman crosses each tile
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

    function getPosition() {
        return position
    }
    
    initUser(setState);

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