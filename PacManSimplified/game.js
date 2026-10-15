import {WAITING, COUNTDOWN, PAUSE, EATEN_PAUSE, DYING, PLAYING, KEY, MAP } from "/objects/definitions.js"
import { User } from "/objects/user.js";
import { Map } from "/objects/map.js"
import { Ghost } from "/objects/ghost.js";

export const Game = function (fps, render, AI, id) {

    var state        = WAITING,
        ghosts       = [],
        ghostSpecs   = [],//"#00FFDE", "#FF0000", "#FFB8DE", "#FFB847"],// "#003300", "#9933FF"],
        eatenCount   = 0,
        level        = 0,
        tick         = 0,
        ghostPos, userPos, prevUserPos, prevUserDec,
        stateChanged = true,
        timerStart   = null,
        lastTime     = 0,
        ctx          = null,
        timer        = null,
        map          = null,
        mapI         = 1, 
        user         = null,
        stored       = null,
        networksaved = false,
        canvas,
        stats,
        rec,
        pacOld,
        wins = 0,
        FPS = fps;

    function getTick() { 
        return tick;
    };

    function drawScore(text, position) {
        ctx.fillStyle = "#FFFFFF";
        ctx.font      = "12px BDCartoonShoutRegular";
        ctx.fillText(text, 
                     (position["new"]["x"] / 10) * map.blockSize, 
                     ((position["new"]["y"] + 5) / 10) * map.blockSize);
    }
    
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
        AI.setScore(user.theScore(), id)      
        user.resetPosition();
        for (var i = 0; i < ghosts.length; i += 1) { 
            ghosts[i].reset();
         }
        timerStart = tick;
        setState(COUNTDOWN);
    }    

    function startNewGame() {
        setState(WAITING);
        level = 1;

        // Updating the stats
        stats.innerHTML = `Generation: ${AI.getCurrentGeneration()} - ${AI.getNetworkAt()}, Child: ${AI.getCurrentNetId(id)}, Population Size: ${AI.getPopulationSize()}, Highest Score: ${AI.getTopScore()}`//, Wins: ${wins}`
         
        user.reset(setState);
        map.reset(mapI);
        
        map.draw(ctx);

        startLevel();
    }

    function keyDown(e) {
        if (e.keyCode === KEY.N) {
            startNewGame();
        } else if (e.keyCode === KEY.S) {
            localStorage["soundDisabled"] = !soundDisabled();
        } else if (e.keyCode === KEY.P && state === PAUSE) {
            map.draw(ctx);
            setState(stored);
        } else if (e.keyCode === KEY.P) {
            stored = state;
            setState(PAUSE);
            map.draw(ctx);
            dialog("Paused");
        } else if (state !== PAUSE) {   
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
            AI.setScore(user.theScore(), id) // Setting the AI score
            AI.moveToNext(id) // Move to the next network
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

        ctx.fillStyle = !soundDisabled() ? "#00FF00" : "#FF0000";
        ctx.font = "bold 16px sans-serif";
        //ctx.fillText("♪", 10, textBase);
        ctx.fillText("s", 10, textBase);

        ctx.fillStyle = "#FFFF00";
        ctx.font      = "14px BDCartoonShoutRegular";
        ctx.fillText("Score: " + user.theScore(), 30, textBase);
        ctx.fillText("Level: " + level, 260, textBase);
    }

    function redrawBlock(pos) {
        map.drawBlock(Math.floor(pos.y/10), Math.floor(pos.x/10), ctx);
        map.drawBlock(Math.ceil(pos.y/10), Math.ceil(pos.x/10), ctx);
    }

    function mainDraw() { 

        var diff, u, i, len, nScore;
        
        ghostPos = [];

        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            ghostPos.push(ghosts[i].move(ctx, prevUserPos, i));
        }
        u = user.move(ctx, setState);
        
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            redrawBlock(ghostPos[i].old);
        }
        redrawBlock(u.old);
        
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            ghosts[i].draw(ctx);
        }                     
        user.draw(ctx);
        
        prevUserPos = userPos
        userPos = u["new"];
        
        // if (userPos == prevUserPos) {
        //     user.addScore(-.1)
        //     AI.setScore(user.theScore(), id)
        // }
        
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            if (collided(userPos, ghostPos[i]["new"])) {
                if (ghosts[i].isVunerable()) { 
                    ghosts[i].eat();
                    eatenCount += 1;
                    nScore = eatenCount * 50;
                    drawScore(nScore, ghostPos[i]);
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

    function mainLoop() {

        var diff;

        if(AI.getCurrentGeneration() < AI.getMaxGeneration())
        {

            if (state !== PAUSE) { 
                ++tick;
            }

            map.drawPills(ctx);

            if (state === PLAYING) {
                mainDraw();
                // Deciding which direction to go

                // 0 = straight, 1 = turn right, 2 = turn around, 3 = turn left
                let decision = (AI.execute(getInput(), id) + user.getDirection()) % 4
                // console.log(getInput())

                user.setDirection(decision);

                // if (prevUserDec != decision) {
                //     user.addScore(-.1)
                //     AI.setScore(user.theScore(), id)
                // }

                // prevUserDec = decision

            } else if (state === WAITING && stateChanged) {            
                stateChanged = false;
                map.draw(ctx);

                if (!AI.isGenerationOver()) {
                    startNewGame();
                } else {
                    if (rec && rec.state == "recording") {
                        rec.stop()
                    }
                }
                // dialog("Press N to start a New game");
            } else if (state === EATEN_PAUSE /*&& 
                    (tick - timerStart) > (FPS / 3)*/) {
                map.draw(ctx);
                setState(PLAYING);
            } else if (state === DYING) {
                redrawBlock(userPos);
                for (var i = 0, len = ghosts.length; i < len; i += 1) {
                    redrawBlock(ghostPos[i].old);
                    ghostPos.push(ghosts[i].draw(ctx));
                }  
                loseLife();
                // if (tick - timerStart > (FPS * 2)) { 
                //     loseLife();
                // } else { 
                //     redrawBlock(userPos);
                //     for (var i = 0, len = ghosts.length; i < len; i += 1) {
                //         redrawBlock(ghostPos[i].old);
                //         ghostPos.push(ghosts[i].draw(ctx));
                //     }                                   
                //     user.drawDead(ctx, (tick - timerStart) / (FPS * 2));
                // }
            } else if (state === COUNTDOWN) {
                map.draw(ctx);
                setState(PLAYING);
                // diff = 5 + Math.floor((timerStart - tick) / FPS);
                
                // if (diff === 0) {
                //     map.draw(ctx);
                //     setState(PLAYING);
                // } else {
                //     if (diff !== lastTime) { 
                //         lastTime = diff;
                //         map.draw(ctx);
                //         dialog("Starting in: " + diff);
                //     }
                // }
            } 

            drawFooter();
        }else
        {
            if(!networksaved)
            {
                // AI.saveTopNetwork(savename, 'text/plain')
                networksaved = !networksaved
            }
        }
    }

    function eatenPill() {
        timerStart = tick;
        eatenCount = 0;
        for (var i = 0; i < ghosts.length; i += 1) {
            ghosts[i].makeEatable(ctx);
        }        
    };
    
    function completedLevel() {
        for (let i = 0; i < user.getLives(); i++) {
            user.loseLife()
        }
        AI.setScore(user.theScore(), id)  
        wins += 1 
        setState(DYING);
        // level += 1;
        map.reset(mapI);
        // user.newLevel();
        // startLevel();
    };

    function keyPress(e) { 
        if (state !== WAITING && state !== PAUSE) { 
            e.preventDefault();
            e.stopPropagation();
        }
    };
    
    function init(wrapper) {
        
        var i, len, ghost,
            blockSize = 342 / 19;
        
        canvas = document.createElement("canvas")
        canvas.setAttribute("width", (blockSize * 19) + "px");
        canvas.setAttribute("height", (blockSize * 22) + 30 + "px");
        canvas.setAttribute("id", id)

        // var networkCanvas = document.createElement("canvas")
        // networkCanvas.setAttribute("height", (blockSize * 22) + 30 + "px")
        // AI.setCanvas(networkCanvas)

        var wrapperDiv = document.createElement("div");
        wrapperDiv.style.width = (blockSize * 19) + "px"
        wrapperDiv.appendChild(canvas)
        stats = document.createElement('p')
        wrapperDiv.appendChild(stats)

        wrapper.appendChild(wrapperDiv);

        ctx  = canvas.getContext('2d');

        map   = Map(blockSize, render);
        user  = User({ 
            "completedLevel" : completedLevel, 
            "eatenPill"      : eatenPill 
        }, map, render, setState);

        for (var i = 0, len = ghostSpecs.length; i < len; i += 1) {
            ghost = Ghost({"getTick":getTick}, map, ghostSpecs[i], FPS, render);
            ghosts.push(ghost);
        }
        
        map.draw(ctx);
        dialog("Loading ...");
        loaded();
    };

    // function load(arr, callback) { 
        
    //     if (arr.length === 0) { 
    //         callback();
    //     } else { 
    //         var x = arr.pop();
    //         audio.load(x[0], x[1], function() { load(arr, callback); });
    //     }
    // };
        
    function loaded() {

        startNewGame();
        // dialog("Press N to Start");
        
        document.addEventListener("keydown", keyDown, true);
        document.addEventListener("keypress", keyPress, true); 
        
        timer = window.setInterval(mainLoop, 1000 / FPS);
    };

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

    // Front, back, top, bottom
    // (d, theta) of nearest pellet
    // (d, theta) of ghosts
    function getInput() {
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
    
    return {
        "init" : init,
        "startNewGame" : startNewGame,
        "recordGeneration" : recordGeneration,
        "killPlayer" : killPlayer,
        "setMapI" : setMapI,
    };
    
}