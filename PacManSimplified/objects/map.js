import { OBJECTS, MAP, POWER_PILLS, traceWalls, testWalls } from "./definitions.js";

/**
 *  The board: the current state of every tile, and drawing the walls, biscuits and pills.
 *  Not called Map so it doesn't hide the built in Map in files that import it
 *
 *  A factory function (called without new): GameMap(blockSize, true) in game.js init(). It keeps its state in
 *  the closure below and returns an object with the public functions at the bottom.
 *  size   - canvas pixels per tile (blockSize, 342 / 19 = 18 in game.js). Only used for drawing
 *  render - false skips all drawing (every draw function checks it). game.js always passes true
 *
 *  Tiles are addressed with {y, x} objects of tile indexes (row, col), the same shape user.js next() returns.
 *  Pacman and the ghosts convert their positions (tenths of a tile) to tiles before asking about them.
 */
export const GameMap = function (size, render) {
    
    var height    = null,   // Rows
        width     = null,   // Columns
        blockSize = size,   // Size of a tile on the canvas in pixels
        pillSize  = 0,      // Animation frame for the pulsing power pills
        walls = null,       // Wall outlines to draw, see traceWalls in definitions.js
        foodCount = 0,      // Biscuits and pills on the board at the last reset
        map       = null;   // [row][col] of OBJECTS values, a copy of the MAP that gets eaten as pacman moves
    
    // Whether (row y, col x) is on the board. Off-board tiles (e.g. x = -1 in the tunnel) are neither wall nor floor
    function withinBounds(y, x) {
        return y >= 0 && y < height && x >= 0 && x < width;
    }
    
    // Exported as isWallSpace. pos is {y, x} in tiles. Only WALL counts: the ghost house (BLOCK) and anything
    // off the board are not walls, so pacman and the ghosts only stop for real walls (user.js / ghost.js move())
    function isWall(pos) {
        return withinBounds(pos.y, pos.x) && map[pos.y][pos.x] === OBJECTS.WALL;
    }
    
    // Pacman can walk here (not a wall, not the ghost house)
    // pos is {y, x} in tiles. Used by pacman and the ghosts to decide whether they can turn into a tile, so
    // nothing ever turns into the ghost house or off the board (the tunnel is only entered by going straight)
    function isFloorSpace(pos) {
        if (!withinBounds(pos.y, pos.x)) {
            return false;
        }
        var peice = map[pos.y][pos.x];
        return peice === OBJECTS.EMPTY || 
            peice === OBJECTS.BISCUIT ||
            peice === OBJECTS.PILL;
    }
    
    // Strokes the wall outlines (walls, from testWalls or traceWalls) as thick blue lines with round ends.
    // Points are in tile units, so they are multiplied by blockSize. See testWalls in definitions.js for the
    // {move} / {line} / {curve} format. Called by draw()
    function drawWall(ctx) {
        if (render) {
            var i, j, p, line;
            
            ctx.strokeStyle = "#0000FF";
            ctx.lineWidth   = blockSize * .5;
            ctx.lineCap     = "round";
            
            for (var i = 0; i < walls.length; i += 1) {
                line = walls[i];
                ctx.beginPath();

                for (var j = 0; j < line.length; j += 1) {

                    p = line[j];
                    
                    if (p.move) {
                        ctx.moveTo(p.move[0] * blockSize, p.move[1] * blockSize);
                    } else if (p.line) {
                        ctx.lineTo(p.line[0] * blockSize, p.line[1] * blockSize);
                    } 
                    else if (p.curve) {
                        ctx.quadraticCurveTo(p.curve[0] * blockSize, 
                                            p.curve[1] * blockSize,
                                            p.curve[2] * blockSize, 
                                            p.curve[3] * blockSize);   
                    }
                }
                ctx.stroke();
            }
        }
    }
    
    // Load a fresh copy of map mapI, optionally with power pills
    // mapI       - index into MAP (game.js mapI)
    // powerPills - true in the power pill training mode (game.js mode.powerPills), puts PILLs at POWER_PILLS[mapI]
    // Called once below with map 0 when the map is created, then by game.js startNewGame() and completedLevel().
    // The copy matters: eating changes this map, and MAP has to stay untouched for the next game.
    // Walls are the hand-drawn testWalls for map 1, traceWalls for every other map (rebuilt on every reset).
    // foodCount is what user.js compares its eaten count to, to know when the level is complete
    function reset(mapI, powerPills) {       
        map    = [...MAP[mapI].map(row => [...row])]
        if (powerPills) {
            POWER_PILLS[mapI].forEach(([y, x]) => map[y][x] = OBJECTS.PILL)
        }
        walls = mapI == 1 ? testWalls : traceWalls(map)
        height = map.length;
        width  = map[0].length;       
        foodCount = map.flat().filter(b => b === OBJECTS.BISCUIT || b === OBJECTS.PILL).length
    };

    // Number of biscuits and pills on the board at the last reset, eating them all completes the level
    function getFoodCount() {
        return foodCount
    }

    // A copy of the current map (with what has been eaten), for game.js to build the network's inputs from
    // without changing the real board.
    // NOTE: the mapI parameter is ignored, it always copies the current map
    function getMapClone(mapI) {
        return [...map.map(row => [...row])]
    }

    // The OBJECTS value of tile pos ({y, x} in tiles). Called by user.js move() to see what pacman is entering.
    // No bounds check: a row off the board would throw, a column off the board gives undefined
    function block(pos) {
        return map[pos.y][pos.x];
    };
    
    // Change tile pos ({y, x} in tiles) to type, used by user.js move() to set eaten tiles to EMPTY
    function setBlock(pos, type) {
        map[pos.y][pos.x] = type;
    };

    // Power pills are drawn separately from the other tiles so they can pulse
    // Called by game.js draw() every frame after draw(). pillSize counts 0 to 30 and wraps, one step per call,
    // and the radius is |5 - pillSize / 3| canvas pixels: shrinks from 5 to 0 and grows back to 5.
    // The radius is in canvas pixels, not scaled by blockSize
    function drawPills(ctx) { 
        if (render) {
            if (++pillSize > 30) {
                pillSize = 0;
            }
            
            for (var i = 0; i < height; i += 1) {
                for (var j = 0; j < width; j += 1) {
                    if (map[i][j] === OBJECTS.PILL) {
                        ctx.beginPath();

                        ctx.fillStyle = "#000";
                        ctx.fillRect((j * blockSize), (i * blockSize), 
                                    blockSize, blockSize);

                        ctx.fillStyle = "#FFF";
                        ctx.arc((j * blockSize) + blockSize / 2,
                                (i * blockSize) + blockSize / 2,
                                Math.abs(5 - (pillSize/3)), 
                                0, 
                                Math.PI * 2, false); 
                        ctx.fill();
                        ctx.closePath();
                    }
                }
            }
        }
    };
    
    // Draws the whole board: black background, the walls, then every tile (drawBlock).
    // Called by game.js draw() every frame
    function draw(ctx) {
        if (render) {
            var i, j, size = blockSize;

            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, width * size, height * size);

            drawWall(ctx);
            
            for (var i = 0; i < height; i += 1) {
                for (var j = 0; j < width; j += 1) {
                    drawBlock(i, j, ctx);
                }
            }
        }
    };
    
    // Draws one tile at (row y, col x): a black square, plus the biscuit (a small square in the middle) if there is one.
    // Walls aren't drawn here, drawWall() did them. Pills are skipped, drawPills() does them.
    // The black squares are drawn after the walls, so they also cover any part of a wall line's round end
    // that pokes into a floor tile
    function drawBlock(y, x, ctx) {
        if (render) {
            var layout = map[y][x];

            if (layout === OBJECTS.PILL) {
                // Leftover from an unfinished line, has no effect:
                // map[y][x] = 
                return;
            }

            ctx.beginPath();
            
            if (layout === OBJECTS.EMPTY || layout === OBJECTS.BLOCK || 
                layout === OBJECTS.BISCUIT) {
                
                ctx.fillStyle = "#000";
                ctx.fillRect((x * blockSize), (y * blockSize), 
                            blockSize, blockSize);

                if (layout === OBJECTS.BISCUIT) {
                    ctx.fillStyle = "#FFF";
                    ctx.fillRect((x * blockSize) + (blockSize / 2.5), 
                                (y * blockSize) + (blockSize / 2.5), 
                                blockSize / 6, blockSize / 6);
                }
            }
            ctx.closePath();	
        } 
    };

    // Start with map 0 so height, width and the rest are set before anything uses them; game.js resets
    // to the chosen map in startNewGame()
    reset(0);
    
    // Public API. isWallSpace / isFloorSpace are isWall / isFloorSpace under other names.
    // NOTE: "height" and "width" are copied when this object is built, right after reset(0), so they are
    // map 0's size (22 and 19) and don't follow later resets. That's fine while every map is 19 by 22.
    // game.js uses them to place the footer and the pause text
    return {
        "draw"         : draw,
        "drawBlock"    : drawBlock,
        "drawPills"    : drawPills,
        "block"        : block,
        "setBlock"     : setBlock,
        "reset"        : reset,
        "isWallSpace"  : isWall,
        "isFloorSpace" : isFloorSpace,
        "height"       : height,
        "width"        : width,
        "blockSize"    : blockSize,
        "getMapClone"  : getMapClone,
        "getFoodCount" : getFoodCount,
    };
};