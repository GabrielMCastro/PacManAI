import { KEY, LEFT, UP, RIGHT, DOWN, NONE, OBJECTS, DYING } from "./definitions.js";

export const User = function (game, map, render) {
    
    var position  = null,
        direction = null,
        eaten     = null,
        due       = null, 
        lives     = null,
        score     = 5,
        keyMap    = {},
        eatenTimer;
    
    keyMap[KEY.ARROW_LEFT]  = LEFT;
    keyMap[KEY.ARROW_UP]    = UP;
    keyMap[KEY.ARROW_RIGHT] = RIGHT;
    keyMap[KEY.ARROW_DOWN]  = DOWN;

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
    };

    function getLives() {
        return lives;
    };

    function initUser() {
        score = 0;
        lives = 1//3;
        newLevel();
    }
    
    function newLevel() {
        resetPosition();
        eaten = 0;
    };
    
    function resetPosition() {
        position = {"x": 90, "y": 120};
        direction = LEFT;
        due = LEFT;
    };
    
    function reset() {
        initUser();
        resetPosition();
    };        
    
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

    function getNewCoord(dir, current) {   
        return {
            "x": current.x + (dir === LEFT && -2 || dir === RIGHT && 2 || 0),
            "y": current.y + (dir === DOWN && 2 || dir === UP    && -2 || 0)
        };
    };

    function onWholeSquare(x) {
        return x % 10 === 0;
    };

    function pointToCoord(x) {
        return Math.round(x/10);
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

    function next(pos, dir) {
        return {
            "y" : pointToCoord(nextSquare(pos.y, dir)),
            "x" : pointToCoord(nextSquare(pos.x, dir)),
        };                               
    };

    function onGridSquare(pos) {
        return onWholeSquare(pos.y) && onWholeSquare(pos.x);
    };

    function isOnSamePlane(due, dir) { 
        return ((due === LEFT || due === RIGHT) && 
                (dir === LEFT || dir === RIGHT)) || 
            ((due === UP || due === DOWN) && 
             (dir === UP || dir === DOWN));
    };

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
            
            if (eaten === 182) {
                game.completedLevel();
            }
            
            if (block === OBJECTS.PILL) { 
                game.eatenPill();
            }

            clearTimeout(eatenTimer)
            eatenTimer = window.setTimeout(() => setState(DYING), 2500);
        }   
                
        return {
            "new" : position,
            "old" : oldPosition,
        };
    };

    function isMidSquare(x) { 
        var rem = x % 10;
        var ret = rem > 3 || rem < 7;
        // if (ret) console.log(ret)
        return ret
    };

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
    
    initUser();

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