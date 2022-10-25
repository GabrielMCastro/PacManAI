import { OBJECTS, MAP, generateWalls } from "./definitions.js";

export const Map = function (size, render) {
    
    var height    = null, 
        width     = null, 
        blockSize = size,
        pillSize  = 0,
        walls = null,
        map       = null;
    
    function withinBounds(y, x) {
        return y >= 0 && y < height && x >= 0 && x < width;
    }
    
    function isWall(pos) {
        return withinBounds(pos.y, pos.x) && map[pos.y][pos.x] === OBJECTS.WALL;
    }
    
    function isFloorSpace(pos) {
        if (!withinBounds(pos.y, pos.x)) {
            return false;
        }
        var peice = map[pos.y][pos.x];
        return peice === OBJECTS.EMPTY || 
            peice === OBJECTS.BISCUIT ||
            peice === OBJECTS.PILL;
    }
    
    function drawWall(ctx) {
        if (render) {
            var i, j, p, line;
            
            ctx.strokeStyle = "#0000FF";
            ctx.lineWidth   = blockSize * .75//5;
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
    
    function reset(mapI) {       
        map    = [...MAP[mapI].map(row => [...row])]
        walls = generateWalls(map)
        height = map.length;
        width  = map[0].length;       
    };

    function getMapClone(mapI) {
        return [...map.map(row => [...row])]
    }

    function block(pos) {
        return map[pos.y][pos.x];
    };
    
    function setBlock(pos, type) {
        map[pos.y][pos.x] = type;
    };

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
    
    function drawBlock(y, x, ctx) {
        if (render) {
            var layout = map[y][x];

            if (layout === OBJECTS.PILL) {
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

    reset(0);
    
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
    };
};