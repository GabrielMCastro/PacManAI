import {WAITING, COUNTDOWN, EATEN_PAUSE, DYING, PLAYING, KEY, MAP, MAX_SEARCH_DISTANCE } from "/objects/definitions.js"
import { User } from "/objects/user.js";
import { GameMap } from "/objects/map.js"
import { Ghost } from "/objects/ghost.js";

// Pacman dies if it goes this long without eating
const STARVE_SECONDS = 3

const GHOST_COLOURS = ["#00FFDE", "#FF0000", "#FFB8DE", "#FFB847"]

/**
 *  Training modes, these only change the board, not the network inputs
 *      pellets - no ghosts, no power pills
 *      ghosts  - ghosts, no power pills
 *      power   - ghosts and power pills
 */
export const MODES = {
    pellets: { label: "Pellets only", ghosts: false, powerPills: false },
    ghosts:  { label: "Ghosts",       ghosts: true,  powerPills: false },
    power:   { label: "Power pill",   ghosts: true,  powerPills: true },
}

/**
 *  Optional network inputs, in the order getInput() returns them after the 4 open space inputs.
 *  Each one is 4 inputs (front, right, back, left). Selected with config.InputSignals,
 *  e.g. { pellets: true, ghosts: false, ... }
 */
export const INPUT_SIGNALS = ["pellets", "ghosts", "pills", "vulnerableGhosts"]

// Number of inputs getInput() returns for a selection, the open space inputs are always included
export function inputCount(inputSignals) {
    return 4 + (4 * INPUT_SIGNALS.filter(s => inputSignals?.[s]).length)
}

/**
 *  A single simulation. Logic and rendering are separate:
 *      step() - advances the simulation one tick, never touches the canvas
 *      draw() - paints the current state, skipped while the canvas is off screen
 *
 *  options:
 *      inputSignals       - which optional inputs getInput() returns, see INPUT_SIGNALS
 *      ghostCount         - ghosts in the ghost and power pill modes, 1 to 4
 *      mapIndex           - which map in MAP is played
 *      decideOnTileCenter - only ask the network for a move when pacman is centered on a tile (every 5 ticks)
 *                           instead of every tick. Stops it reversing back and forth on one spot while training
 */
export const Game = function (fps, AI, id, options = {}) {

    const {
        inputSignals,
        ghostCount = GHOST_COLOURS.length,
        mapIndex = 1,
        decideOnTileCenter = false,
    } = options

    var state        = WAITING,        // WAITING, COUNTDOWN, PLAYING, EATEN_PAUSE or DYING, see step()
        ghosts       = [],             // Empty in the pellets only mode
        mode         = MODES.pellets,  // Training mode, set by setMode()
        eatenCount   = 0,              // Ghosts eaten since the last power pill, each one is worth 50 more
        level        = 0,
        tick         = 0,              // Simulation time, everything is timed in ticks
        ghostPos     = [],             // Each ghost's {new, old} position from the last tick
        userPos, prevUserPos, prevUserDec, // Pacman's position this tick and last tick (prevUserDec is unused)
        stateChanged = true,           // Set by setState(), lets WAITING run only once per wait
        timerStart   = null,           // Tick of the last timed event, only read by commented out code
        lastFoodTick = 0,              // Tick pacman last ate, for starvation
        aliveTicks   = 0,              // Ticks spent playing this game
        aliveTicksAtFood = 0,          // aliveTicks when pacman last ate. The survival bonus only counts up to here,
                                       // so wandering or stalling until starvation earns nothing
        ctx          = null,
        map          = null,
        mapI         = mapIndex,       // Which map in MAP is played
        user         = null,           // Pacman
        idle         = false,          // True when this game is out of networks for the generation
        visible      = true,           // Whether the canvas is on screen, drawing is skipped if not
        canvas,
        stats,                         // Text under the canvas
        rec,                           // MediaRecorder when recording a generation
        observer,                      // Watches whether the canvas is on screen
        wins = 0,                      // Levels completed
        FPS = fps,
        starveTicks = STARVE_SECONDS * fps;

    function getTick() { 
        return tick;
    };
    
    function dialog(text) {
        ctx.fillStyle = "#FFFF00";
        ctx.font      = "14px BDCartoonShoutRegular";
        var width = ctx.measureText(text).width,
            x     = ((map.width * map.blockSize) - width) / 2;        
        ctx.fillText(text, x, (map.height * 10) + 8);
    }

    function soundDisabled() {
        return localStorage["soundDisabled"] === "true";
    };
    
    function startLevel() {
        user.resetPosition();
        for (var i = 0; i < ghosts.length; i += 1) { 
            ghosts[i].reset();
         }
        timerStart = tick;
        lastFoodTick = tick;
        setState(COUNTDOWN);
    }    

    function startNewGame() {
        setState(WAITING);
        level = 1;
        idle = false;
        aliveTicks = 0;
        aliveTicksAtFood = 0;

        user.reset(setState);
        map.reset(mapI, mode.powerPills);

        userPos = user.getPosition();
        prevUserPos = userPos;

        startLevel();
    }

    // Typing in a form field (e.g. the config editor) isn't game input
    function isTyping(e) {
        return !!e.target.closest?.("input, textarea, select, dialog")
    }

    function keyDown(e) {
        if (isTyping(e)) {
            return true;
        }
        if (e.keyCode === KEY.N) {
            startNewGame();
        } else if (e.keyCode === KEY.S) {
            localStorage["soundDisabled"] = !soundDisabled();
        } else {   
            return user.keyDown(e);
        }
        return true;
    }    

    function loseLife() {  
        setState(WAITING);
        user.loseLife();
        if (user.getLives() > 0) {
            startLevel();
        } else {
            // Game over. The trainer averages it with the network's other games, and moves this
            // game to the next network once it has played them all
            AI.finishGame(user.theScore(), aliveTicksAtFood / FPS, id)
        }
    }

    function setState(nState) { 
        state = nState;
        stateChanged = true;
    };
    
    function collided(user, ghost) {
        return (Math.sqrt(Math.pow(ghost.x - user.x, 2) + 
                          Math.pow(ghost.y - user.y, 2))) < 10;
    };

    function drawFooter() {
        
        var topLeft  = (map.height * map.blockSize),
            textBase = topLeft + 17;
        
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, topLeft, (map.width * map.blockSize), 30);
        
        ctx.fillStyle = "#FFFF00";

        for (var i = 0, len = user.getLives(); i < len; i++) {
            ctx.fillStyle = "#FFFF00";
            ctx.beginPath();
            ctx.moveTo(150 + (25 * i) + map.blockSize / 2,
                       (topLeft+1) + map.blockSize / 2);
            
            ctx.arc(150 + (25 * i) + map.blockSize / 2,
                    (topLeft+1) + map.blockSize / 2,
                    map.blockSize / 2, Math.PI * 0.25, Math.PI * 1.75, false);
            ctx.fill();
        }

        ctx.fillStyle = "#FFFF00";
        ctx.font      = "14px BDCartoonShoutRegular";
        ctx.fillText("Score: " + user.theScore(), 10, textBase);
        ctx.fillText("Level: " + level, 260, textBase);
    }

    // Move pacman and the ghosts, then resolve collisions
    function update() { 

        var u, nScore;
        
        ghostPos = [];

        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            ghosts[i].update();
            ghostPos.push(ghosts[i].move(ctx, prevUserPos, i));
        }
        u = user.move(ctx, setState);
        
        prevUserPos = userPos
        userPos = u["new"];
        
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            if (collided(userPos, ghostPos[i]["new"])) {
                if (ghosts[i].isVunerable()) { 
                    ghosts[i].eat();
                    eatenCount += 1;
                    nScore = eatenCount * 50;
                    user.addScore(nScore);                    
                    setState(EATEN_PAUSE);
                    timerStart = tick;
                } else if (ghosts[i].isDangerous()) {
                    setState(DYING);
                    timerStart = tick;
                }
            }
        }                             
    };

    // Advance the simulation by one tick
    function step() {

        if (AI.getCurrentGeneration() >= AI.getMaxGeneration()) {
            return;
        }

        ++tick;

        if (state === PLAYING) {
            ++aliveTicks;
            update();

            // Deciding which direction to go, between decisions pacman keeps going the way it was
            // 0 = straight, 1 = turn right, 2 = turn around, 3 = turn left
            let centered = userPos.x % 10 === 0 && userPos.y % 10 === 0
            if (!decideOnTileCenter || centered) {
                let decision = (AI.execute(getInput(), id) + user.getDirection()) % 4

                user.setDirection(decision);
            }

            if (state === PLAYING && (tick - lastFoodTick) > starveTicks) {
                setState(DYING);
            }

        } else if (state === WAITING && stateChanged) {            
            stateChanged = false;

            // Not isGenerationOver(): this game may still owe games for its network after the last one is handed out
            if (AI.hasNetwork(id)) {
                startNewGame();
            } else {
                idle = true;
                if (rec && rec.state == "recording") {
                    rec.stop()
                }
            }
        } else if (state === EATEN_PAUSE) {
            setState(PLAYING);
        } else if (state === DYING) {
            loseLife();
        } else if (state === COUNTDOWN) {
            setState(PLAYING);
        } 
    }

    // Paint the current state of the simulation
    function draw(paused) {
        if (!visible && !(rec && rec.state == "recording")) {
            return;
        }

        map.draw(ctx);
        map.drawPills(ctx);
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            ghosts[i].draw(ctx);
        }
        user.draw(ctx);
        drawFooter();

        if (paused) {
            dialog("Paused");
        }

        stats.textContent = idle ? "Waiting for generation to finish" : `Network ${AI.getCurrentNetId(id)} · game ${AI.getCurrentGameNumber(id)} / ${AI.getConfig().GamesPerNetwork}`
    }

    function eatenPill() {
        timerStart = tick;
        eatenCount = 0;
        for (var i = 0; i < ghosts.length; i += 1) {
            ghosts[i].makeEatable(ctx);
        }        
    };

    function ateFood() {
        aliveTicksAtFood = aliveTicks;
        lastFoodTick = tick;
    };
    
    function completedLevel() {
        for (let i = 0; i < user.getLives(); i++) {
            user.loseLife()
        }
        wins += 1
        setState(DYING);
        // level += 1;
        map.reset(mapI, mode.powerPills);
        // user.newLevel();
        // startLevel();
    };

    function keyPress(e) { 
        if (state !== WAITING && !isTyping(e)) { 
            e.preventDefault();
            e.stopPropagation();
        }
    };
    
    function init(wrapper) {
        
        var blockSize = 342 / 19;
        
        canvas = document.createElement("canvas")
        canvas.setAttribute("width", (blockSize * 19) + "px");
        canvas.setAttribute("height", (blockSize * 22) + 30 + "px");
        canvas.setAttribute("id", id)

        var card = document.createElement("div");
        card.className = "sim-card"

        var title = document.createElement("div")
        title.className = "card-title"
        title.textContent = `Sim ${id}`
        stats = document.createElement("div")
        stats.className = "card-subtitle"

        card.appendChild(title)
        card.appendChild(canvas)
        card.appendChild(stats)
        wrapper.appendChild(card);

        ctx  = canvas.getContext('2d');

        // Only paint while the canvas is actually on screen
        observer = new IntersectionObserver(([entry]) => visible = entry.isIntersecting)
        observer.observe(canvas)

        map   = GameMap(blockSize, true);
        user  = User({ 
            "completedLevel" : completedLevel, 
            "eatenPill"      : eatenPill,
            "ateFood"        : ateFood
        }, map, true, setState);

        setMode(mode);
        loaded();
    };
        
    function loaded() {

        startNewGame();
        
        document.addEventListener("keydown", keyDown, true);
        document.addEventListener("keypress", keyPress, true); 
    };

    // Detach from the page before this game is thrown away (training restarts)
    function destroy() {
        document.removeEventListener("keydown", keyDown, true);
        document.removeEventListener("keypress", keyPress, true);
        observer.disconnect();
        if (rec && rec.state == "recording") {
            rec.onstop = null;
            rec.stop();
        }
    }

    function recordGeneration() {
        const chunks = []; // here we will store our recorded media chunks (Blobs)
        const stream = canvas.captureStream(); // grab our canvas MediaStream
        rec = new MediaRecorder(stream); // init the recorder
        // every time the recorder has new data, we will store it in our array
        rec.ondataavailable = e => chunks.push(e.data);
        // only when the recorder stops, we construct a complete Blob from all the chunks
        rec.onstop = e => exportVid(new Blob(chunks, {type: 'video/webm'}));
        
        rec.start();
    }

    function exportVid(blob) {
        const vid = document.createElement('video');
        vid.src = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = 'pacAI.webm';
        a.href = vid.src;
        a.textContent = 'download the video';
        document.body.appendChild(a);
        a.click()
        document.body.removeChild(a);
    }


    /** Gets the current state of the map
     *  Wall    = 0 = 0
     *  Buiscut = 1 = 2
     *  Empty   = 2 = .5
     *  Block   = 3 = 0
     *  Pill    = 4 = 5
     *  Ghost   = -5 if dangerous, 5 if vulnerable
     *  Pacman  = empty = 0
     * 
     *  Orients the input around Pacman's perspective in a 3x3 box (9)
     *  (NOT YET) Also returns the distance (d,theta) of the ghosts (6) */
    function getInput1()
    {
        // OLD
        // for (var i = 0; i < 3; i++) {
        //     var row = []
        //     for (var j = 0; j < 3; j++) {
        //         row.push(getVal(mapCopy?.[(uY - 1) + i]?.[(uX - 1) + j]))
        //     }
        //     input.push(...row)
        // }


        let mapCopy = map.getMapClone(mapI)

        let getVal = (v) => {
            let cV = v != undefined ? v : 0
            switch (cV) {
                case 1:
                    return 2
                case 2:
                    return .5
                case 3:
                    return 0
                case 4:
                    return 5
            }
            return cV
        }

        var input = []
        var uY = user.pointToCoord(userPos.y)
        var uX = user.pointToCoord(userPos.x)
        var due = user.getDirection()

        // Just front/back + 1, up/down + 1
        let unoriented = []
        unoriented.push(getVal(mapCopy?.[uY]?.[(uX - 1)]))
        unoriented.push(getVal(mapCopy?.[(uY - 1)]?.[uX]))
        unoriented.push(getVal(mapCopy?.[uY]?.[(uX + 1)]))
        unoriented.push(getVal(mapCopy?.[(uY + 1)]?.[uX]))

        // Orient around pacman so input is always ordered as [front, top, back, bottom]
        for (let i = 0; i < 4; i++) { // 0, 1, 2, 3
            input[i] = unoriented[(4 + (i + due)) % 4] // TODO
        }

        // OLD GHOST POS
        let ghostsInput = [0, 0]
        let minDist = 3.5
        let closestGhost = 1000
        let ghostsEatable = false
        // The ghosts positions
        for(let i = 0; i < ghosts.length; i++)
        {
            let gY = ghosts[i].pointToCoord(ghostPos[i].old.y)
            let gX = ghosts[i].pointToCoord(ghostPos[i].old.x)
            let dY = uY - gY
            let dX = uX - gX
            
            let d = Math.sqrt((dX * dX) + (dY * dY))
            // Adjust theta to ghost due direction
            let theta = Math.atan2(dY, dX) - ((Math.PI / 2) * due)
            if (theta <= -Math.PI) {
                theta = (2 * Math.PI) + theta
            }

            if (d < closestGhost && d <= minDist) {
                ghostsInput = [d, theta]
                closestGhost = d
                ghostsEatable = ghosts[i].isVunerable()
            }
            // ghostsEatable = ghostsEatable || ghosts[i].isVunerable()
            // ghostsInput.push(d > minDist ? minDist : d, theta)
        }

        // let ghostsInput = []
        // let minDist = 3.5
        // let d = Math.PI * ((Math.random() * 2) - 1)
        // ghostsInput.push(minDist, d)

        // If any ghosts are within front/back + 2, up/down + 2
        // let ghostThere = [false, false, false, false]
        // let ghostsEatable = false
        // for (let i = 0; i < ghosts.length; i++) 
        // {
        //     let gY = ghosts[i].pointToCoord(ghostPos[i].new.y)
        //     let gX = ghosts[i].pointToCoord(ghostPos[i].new.x)

        //     if (gX == uX) {
        //         ghostThere[1] = ghostThere[1] || between(gY, uY - 2, uY)
        //         ghostThere[3] = ghostThere[3] || between(gY, uY, uY + 2)

        //         ghostsEatable = ghostsEatable || ghosts[i].isVunerable()
        //     }

        //     if (gY == uY) {
        //         ghostThere[0] = ghostThere[0] || between(gX, uX - 2, uX)
        //         ghostThere[2] = ghostThere[2] || between(gX, uX, uX + 2)
                
        //         ghostsEatable = ghostsEatable || ghosts[i].isVunerable()
        //     }
        // }


        // Orient around pacman so input is always ordered as [front, top, back, bottom]
        // let ghostOriented = []
        // for (let i = 0; i < 4; i++) { // 0, 1, 2, 3
        //     ghostOriented[i] = ghostThere[(4 + (i + due)) % 4] // TODO
        // }

        // ghostsInput = [ghostsEatable ? 1 : 0, ...ghostsInput] : Train without eatable ghosts first

        // console.log(uY, uX)
        // console.log(mapCopy)
        // console.log(mapCopy[uY][(uX - 1)], mapCopy[(uY - 1)][uX], mapCopy[uY][(uX + 1)], mapCopy[(uY + 1)][uX])
        // console.log(uY, uX, due, input)

        // console.log(ghostsInput, ghostsEatable)

        // 15 length
        // return [...input, ...ghostsInput, ghostsEatable ? 1 : 0]
        // return [...ghostsInput, ...input, ghostsEatable ? 1 : 0]
        // return [...input, ...ghostOriented.map((v) => v ? 1 : 0), ghostsEatable ? 1 : 0]
        return [...input, ghostsEatable ? 1 : 0, ...ghostsInput]
    }

    // map = copy of the current map state
    // dirTraversing = the direction vector of the current search
    // curLoc = {"x": x, "y": y} - current location of the search
    // ghostInfo = [[x, y, eatable], ...] for all ghosts
    // objDist = [pelDist, ghostDist, pillDist, eatableGhostsDist] - the travel distance from the start of our search to the nearest obj
    // depth = how many spaces we have traversed
    function traverseToObjects(map, visited, dirTraversing, curLoc, ghostInfo, objDist, depth) {
        if (depth > MAX_SEARCH_DISTANCE) return objDist

        // If we've already visited this spot from a shorter path then lets break
        let key = `${curLoc.x},${curLoc.y}`
        if (visited.has(key) && visited.get(key) <= depth) return objDist
        visited.set(key, depth)

        // 0 = Wall, 1 = Pellet, 2 = Empty, 3 = The ghost house, 4 = Power pill
        let curSpotValue = map?.[curLoc.y]?.[curLoc.x]

        // If a wall, stop searching in this direction
        if (curSpotValue == 0  
            || curSpotValue == undefined
            || curSpotValue == 3) {
                return objDist
            }

       let objDistCopy = [...objDist]

        // Update proximity to pellet or power pill
        switch (curSpotValue) {
            case 1:
                objDistCopy[0] = Math.min(objDist[0], depth)
                break
            case 4:
                objDistCopy[2] = Math.min(objDist[2], depth)
                break
        }
        
        // Update proximity to ghosts
        for (let i = 0; i < ghostInfo.length; i++) {
            let cG = ghostInfo[i]
            if (cG[0] == curLoc.x && cG[1] == curLoc.y) {
                if (cG[2]) {
                    objDistCopy[3] = Math.min(objDist[3], depth)
                } else if (cG[3]) {
                    objDistCopy[1] = Math.min(objDist[1], depth)
                }
            }
        }

        // left, up, right, down
        let dirVectors = [[-1, 0], [0, -1], [1, 0], [0, 1]]
        // search and then merge the results
        let mergedObjDist = objDistCopy
        for (let i = 0; i < dirVectors.length; i++) {
            // I don't want to navigate to space I just left
            if ((dirVectors[i][0] + dirTraversing[0]) == 0
                && (dirVectors[i][1] + dirTraversing[1]) == 0 ) {
                continue
            }
            let newLoc = {
                "x": curLoc.x + dirVectors[i][0],
                "y": curLoc.y + dirVectors[i][1]
            }
            let searchResults = traverseToObjects(map, visited, dirVectors[i], newLoc, ghostInfo, objDistCopy, depth + 1)

            for (let j = 0; j < searchResults.length; j++) {
                if (searchResults[j] < mergedObjDist[j]) {
                    mergedObjDist[j] = searchResults[j]
                }
            }
        }

        return mergedObjDist
    }

    // Breadth first version of traverseToObjects, cost grows with tiles reached rather than paths
    // map = copy of the current map state
    // start = {"x": x, "y": y} - the space next to pacman to start searching from
    // blocked = {"x": x, "y": y} - pacman's location, never searched through so we can't loop back behind him
    // ghostInfo = [[x, y, vulnerable, dangerous], ...] for all ghosts
    // maxDepth = how many spaces from start to search
    // Returns [pelDist, ghostDist, pillDist, eatableGhostsDist], Infinity if not found
    // Distances count start as 0, same as traverseToObjects
    function bfsToObjects(map, start, blocked, ghostInfo, maxDepth) {
        let objDist = [Infinity, Infinity, Infinity, Infinity]

        // left, up, right, down
        let dirVectors = [[-1, 0], [0, -1], [1, 0], [0, 1]]

        let visited = new Set([`${blocked.x},${blocked.y}`])
        let queue = [{ "x": start.x, "y": start.y, "depth": 0 }]

        // Read through the queue with an index instead of shift() so each dequeue is O(1)
        for (let q = 0; q < queue.length; q++) {
            let { x, y, depth } = queue[q]
            let key = `${x},${y}`

            if (depth > maxDepth || visited.has(key)) continue

            // 0 = Wall, 1 = Pellet, 2 = Empty, 3 = The ghost house, 4 = Power pill
            let curSpotValue = map?.[y]?.[x]

            // Walls, the ghost house and out of bounds can't be walked through
            if (curSpotValue == 0
                || curSpotValue == undefined
                || curSpotValue == 3) {
                continue
            }

            visited.add(key)

            // Spaces come out of the queue in order of distance, so the first find of each object is the nearest
            switch (curSpotValue) {
                case 1:
                    objDist[0] = Math.min(objDist[0], depth)
                    break
                case 4:
                    objDist[2] = Math.min(objDist[2], depth)
                    break
            }

            for (let i = 0; i < ghostInfo.length; i++) {
                let cG = ghostInfo[i]
                if (cG[0] == x && cG[1] == y) {
                    if (cG[2]) {
                        objDist[3] = Math.min(objDist[3], depth)
                    } else if (cG[3]) {
                        objDist[1] = Math.min(objDist[1], depth)
                    }
                }
            }

            for (let i = 0; i < dirVectors.length; i++) {
                queue.push({ "x": x + dirVectors[i][0], "y": y + dirVectors[i][1], "depth": depth + 1 })
            }
        }

        return objDist
    }


    // Returns nearest walkable distance from each direction for the following items:
    // pellets, ghosts, power pills, eatable ghosts.
    // And then 4 signals indicating if the there is an open space.
    // Order: left, up, right, down
    // Input size: 4 open signals + 4 per selected signal in inputSignals, see inputCount()
    // Each distance is normalized: 1 - d/maxD
    // [open, pellets, ghosts, pills, eatable], leaving out the signals not selected
    function getInput() {
        // Signals
        let pellets = [], ghostsSig = [], pills = [], vulGhosts = [], open = []

        // left, up, right, down
        let dirVectors = [[-1, 0], [0, -1], [1, 0], [0, 1]]

        let mapCopy = map.getMapClone(mapI)
        let curLoc = { "y": user.pointToCoord(userPos.y), "x": user.pointToCoord(userPos.x)}

        let norm = (v) => Math.max(0, (1 - (v/MAX_SEARCH_DISTANCE)))

        let due = user.getDirection()

        let spaceWalkable = (map, userLoc, dir) => {
            let val = map?.[userLoc.y + dir[1]]?.[userLoc.x + dir[0]]

            if (val == 1 || val == 2 || val == 4) {
                return 1
            }

            return 0
        }

         // Get ghosts info
         let ghostInfo = []
         for(let i = 0; i < ghosts.length; i++) {
            ghostInfo = [
                [ghosts[i].pointToCoord(ghostPos[i].old.x),
                ghosts[i].pointToCoord(ghostPos[i].old.y),
                ghosts[i].isVunerable(),
                ghosts[i].isDangerous(),
                ],
                ...ghostInfo
            ]
         }

        // Get item distances
        for (let i = 0; i < dirVectors.length; i++) {
            let visited = new Map([
                [`${curLoc.x},${curLoc.y}`, -1]
            ])
            let searchResults = traverseToObjects(
                mapCopy, 
                visited,
                dirVectors[i], 
                {"x": curLoc.x + dirVectors[i][0], "y": curLoc.y + dirVectors[i][1]}, 
                ghostInfo, 
                [Infinity, Infinity, Infinity, Infinity], 
                0)
            // let searchResults = bfsToObjects(
            //     mapCopy,
            //     {"x": curLoc.x + dirVectors[i][0], "y": curLoc.y + dirVectors[i][1]},
            //     curLoc,
            //     ghostInfo,
            //     MAX_SEARCH_DISTANCE)            
            
            let orientedI = (i - due + 4) % 4    
            pellets[orientedI] = norm(searchResults[0])
            ghostsSig[orientedI] = norm(searchResults[1])
            pills[orientedI] = norm(searchResults[2])
            vulGhosts[orientedI] = norm(searchResults[3])
            open[orientedI] = spaceWalkable(mapCopy, curLoc, dirVectors[i])
        }

        // Determine which headings are open
        

        let signals = { pellets, ghosts: ghostsSig, pills, vulnerableGhosts: vulGhosts }

        return [...open, ...INPUT_SIGNALS.filter(s => inputSignals?.[s]).flatMap(s => signals[s])]
    }

    // Front, back, top, bottom
    // (d, theta) of nearest pellet
    // (d, theta) of ghosts
    function getInput4() {
        let mapCopy = map.getMapClone(mapI)

        let getVal = (v) => {
            let cV = v != undefined ? v : 0
            switch (cV) {
                case 1:
                    return 2
                case 2:
                    return .5
                case 3:
                    return 0
                case 4:
                    return 5
            }
            return cV
        }

        let uY = user.pointToCoord(userPos.y)
        let uX = user.pointToCoord(userPos.x)
        let due = user.getDirection()

        // Just front/back + 1, up/down + 1
        var input = []
        let unoriented = []
        unoriented.push(getVal(mapCopy?.[uY]?.[(uX - 1)]))
        unoriented.push(getVal(mapCopy?.[(uY - 1)]?.[uX]))
        unoriented.push(getVal(mapCopy?.[uY]?.[(uX + 1)]))
        unoriented.push(getVal(mapCopy?.[(uY + 1)]?.[uX]))

        // Orient around pacman so input is always ordered as [front, top, back, bottom]
        for (let i = 0; i < 4; i++) { // 0, 1, 2, 3
            input[i] = unoriented[(4 + (i + due)) % 4] // TODO
        }

        let nearestPellet = [0, 0]
        let nearestD = 100
        for (let y = 0; y < mapCopy.length; y++){
            for (let x = 0; x < mapCopy[0].length; x++) {
                if (mapCopy[y][x] == 1) {
                    let dY = y - uY
                    let dX = x - uX
                    let d = Math.sqrt((dX * dX) + (dY * dY))

                    if (d < nearestD) {
                        // Adjust theta to ghost due direction
                        let theta = Math.atan2(dY, dX) - ((Math.PI / 2) * due)
                        if (theta <= -Math.PI) {
                            theta = (2 * Math.PI) + theta
                        }

                        nearestD = d
                        nearestPellet = [d, theta]
                    }
                }
            }
        }

        // OLD GHOST POS
        let ghostsInput = [0, 0, 0, 0, 0, 0, 0, 0]
        let ghostsEatable = false
        // The ghosts positions
        for(let i = 0; i < ghosts.length; i++)
        {
            let gY = ghosts[i].pointToCoord(ghostPos[i].old.y)
            let gX = ghosts[i].pointToCoord(ghostPos[i].old.x)
            let dY = uY - gY
            let dX = uX - gX
            
            let d = Math.sqrt((dX * dX) + (dY * dY))
            // Adjust theta to ghost due direction
            let theta = Math.atan2(dY, dX) - ((Math.PI / 2) * due)
            if (theta <= -Math.PI) {
                theta = (2 * Math.PI) + theta
            }

            ghostsEatable = ghostsEatable || ghosts[i].isVunerable()
            ghostsInput[i * 2] = d // 0, 2, 4, 6
            ghostsInput[(i * 2) + 1] = theta // 1, 3, 5, 7
        }

        return [...input, ...nearestPellet]//, ...ghostsInput, ghostsEatable ? 1 : 0] // 15
    }

    // Just the whole map (well 19x19)
    function getInput2() {
        let mapCopy = map.getMapClone(mapI)

        let uY = user.pointToCoord(userPos.y)
        let uX = user.pointToCoord(userPos.x)
        let due = user.getDirection()

        for (let i = 0; i < ghosts.length; i++) {
            let gY = ghosts[i].pointToCoord(ghostPos[i].old.y)
            let gX = ghosts[i].pointToCoord(ghostPos[i].old.x)
            let v = ghosts[i].isVunerable()

            mapCopy[gY][gX] = v ? 5 : -5
        }

        let xShiftD = Math.round(mapCopy[0].length / 2) - uX
        let yShiftD = Math.round(mapCopy.length / 2) - uY
        let mapCopy2 = map.getMapClone(mapI)
        for (let y = 0; y < mapCopy.length; y++) {
            for (let x = 0; x < mapCopy[y].length; x++) {
                let nX = x - xShiftD
                nX = nX < 0 ? mapCopy[y].length + nX : nX % mapCopy[y].length
                let nY = y - yShiftD
                nY = nY < 0 ? mapCopy.length + nY : nY % mapCopy.length

                mapCopy2[y][x] = mapCopy[nY][nX]
            }
        }

        mapCopy2 = mapCopy2.slice(1, 20)

        for (let i = 0; i < due; i++) {
            mapCopy2 = mapCopy2[0].map((val, index) => mapCopy2.map(row => row[index])).reverse()
        }

        let retInput = []
        for (let i = 0; i < mapCopy2.length; i++) {
            retInput.push(...mapCopy2[i])
        }

        return retInput
    }

    // Distance from wall and if pellet is on path for front, back, top, and bottom
    // (d, theta) of ghosts
    function getInput3() {
        let mapCopy = map.getMapClone(mapI)

        let getVal = (v) => {
            let cV = v != undefined ? v : 0
            switch (cV) {
                case 1:
                    return 2
                case 2:
                    return .1
                case 3:
                    return 0
                case 4:
                    return 4
            }
            return cV
        }

        let uY = user.pointToCoord(userPos.y)
        let uX = user.pointToCoord(userPos.x)
        let due = user.getDirection()
        let mapW = mapCopy[0].length
        let mapH = mapCopy.length

        // [front, top, back, bottom]
        let wallD = [0, 0, 0, 0]
        let pelletE = [0, 0, 0, 0]

        // Front
        for (let i = 1; i < uX; i++) {
            let v = getVal(mapCopy?.[uY]?.[uX - i])
            if (v == 0) {
                i = uX
            } else {
                wallD[0] = wallD[0] + 1
                pelletE[0] = pelletE[0] + (v/i)
            }
        }

        // Top
        for (let i = 1; i < uY; i++) {
            let v = getVal(mapCopy?.[uY - i]?.[uX])
            if (v == 0) {
                i = uY
            } else {
                wallD[1] = wallD[1] + 1
                pelletE[1] = pelletE[1] + (v/i)
            }
        }

        // Back
        for (let i = 1; i < (mapW - uX); i++) {
            let v = getVal(mapCopy?.[uY]?.[uX + i])
            if (v == 0) {
                i = mapW
            } else {
                wallD[2] = wallD[2] + 1
                pelletE[2] = pelletE[2] + (v/i)
            }
        }

        // Bottom
        for (let i = 1; i < (mapH - uY); i++) {
            let v = getVal(mapCopy?.[uY + i]?.[uX])
            if (v == 0) {
                i = mapH
            } else {
                wallD[3] = wallD[3] + 1
                pelletE[3] = pelletE[3] + (v/i)
            }
        }

        let orientedD = [0, 0, 0, 0]
        let orientedP = [0, 0, 0, 0]

        // Orient around pacman so input is always ordered as [front, top, back, bottom]
        for (let i = 0; i < 4; i++) { // 0, 1, 2, 3
            orientedD[i] = wallD[(4 + (i + due)) % 4]
            orientedP[i] = pelletE[(4 + (i + due)) % 4]
        }

        let ghostsInput = [0, 0, 0, 0, 0, 0, 0, 0]
        let ghostsEatable = false
        // The ghosts positions
        for(let i = 0; i < ghosts.length; i++)
        {
            let gY = ghosts[i].pointToCoord(ghostPos[i].old.y)
            let gX = ghosts[i].pointToCoord(ghostPos[i].old.x)
            let dY = uY - gY
            let dX = uX - gX
            
            let d = Math.sqrt((dX * dX) + (dY * dY))
            // Adjust theta to ghost due direction
            let theta = Math.atan2(dY, dX) - ((Math.PI / 2) * due)
            if (theta <= -Math.PI) {
                theta = (2 * Math.PI) + theta
            }

            ghostsEatable = ghostsEatable || ghosts[i].isVunerable()
            ghostsInput[i * 2] = d // 0, 2, 4, 6
            ghostsInput[(i * 2) + 1] = theta // 1, 3, 5, 7
        }

        // 17
        return [...orientedD, ...orientedP]//, ...ghostsInput, ghostsEatable ? 1 : 0]
    }

    function between (v, b1, b2) {
        return v >= b1 && v <= b2
    }

    function killPlayer() {
        setState(DYING)
    }

    function setMapI(i) {
        mapI = i
    }

    // Switch training mode, takes effect from the next startNewGame()
    function setMode(m) {
        mode = m
        ghosts = mode.ghosts
            ? GHOST_COLOURS.slice(0, ghostCount).map(colour => Ghost({"getTick":getTick}, map, colour, FPS, true))
            : []
        ghostPos = []
    }
    
    function isIdle() {
        return idle
    }
    
    return {
        "init" : init,
        "destroy" : destroy,
        "step" : step,
        "draw" : draw,
        "isIdle" : isIdle,
        "startNewGame" : startNewGame,
        "recordGeneration" : recordGeneration,
        "killPlayer" : killPlayer,
        "setMapI" : setMapI,
        "setMode" : setMode,
    };
    
}