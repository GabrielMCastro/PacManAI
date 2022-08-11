import {WAITING, COUNTDOWN, PAUSE, EATEN_PAUSE, DYING, PLAYING, KEY } from "/objects/definitions.js"
import { User } from "/objects/user.js";
import { Map } from "/objects/map.js"
import { Ghost } from "/objects/ghost.js";

export const Game = function (fps, render, AI, savename) {

    var state        = WAITING,
        ghosts       = [],
        ghostSpecs   = ["#00FFDE", "#FF0000", "#FFB8DE", "#FFB847"],
        eatenCount   = 0,
        level        = 0,
        tick         = 0,
        ghostPos, userPos, 
        stateChanged = true,
        timerStart   = null,
        lastTime     = 0,
        ctx          = null,
        timer        = null,
        map          = null,
        user         = null,
        stored       = null,
        networksaved = false,
        stats,
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

        AI.setScore(user.theScore()) // Setting the AI score

        // Updating the stats
        stats.innerHTML = "Generation: " + AI.getGenerationAt() + ", " + "Child: " + (AI.getPopulationAt() + 1) + ", Population Size: " + AI.getPopulationSize() + ", Highest Score: " + AI.getTopScore()
         
        user.reset();
        map.reset();
        
        map.draw(ctx);

        AI.moveToNext() // Move to the next network

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
            ghostPos.push(ghosts[i].move(ctx));
        }
        u = user.move(ctx);
        
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            redrawBlock(ghostPos[i].old);
        }
        redrawBlock(u.old);
        
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            ghosts[i].draw(ctx);
        }                     
        user.draw(ctx);
        
        userPos = u["new"];
        
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

        if(AI.getGenerationAt() <= AI.getMaxGeneration())
        {

            if (state !== PAUSE) { 
                ++tick;
            }

            map.drawPills(ctx);

            if (state === PLAYING) {
                mainDraw();
                // Deciding which direction to go
                var temp = getInput();
                AI.execute(temp);
                user.setDirection(AI.getDecision());

            } else if (state === WAITING && stateChanged) {            
                stateChanged = false;
                map.draw(ctx);
                // dialog("Press N to start a New game");
                if (!AI.isGenerationOver()) {
                    startNewGame();
                }
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
                AI.saveTopNetwork(savename, 'text/plain')
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
        setState(WAITING);
        level += 1;
        map.reset();
        user.newLevel();
        startLevel();
    };

    function keyPress(e) { 
        if (state !== WAITING && state !== PAUSE) { 
            e.preventDefault();
            e.stopPropagation();
        }
    };
    
    function init(wrapper) {
        
        var i, len, ghost,
            blockSize = 342 / 19,
            canvas    = document.createElement("canvas");
        
        canvas.setAttribute("width", (blockSize * 19) + "px");
        canvas.setAttribute("height", (blockSize * 22) + 30 + "px");

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
        }, map, render);

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


    /** Gets the current state of the map and normalizes each input between 0 and 1
     *  Wall    = 0
     *  Buiscut = .1
     *  Empty   = .2
     *  Block   = .3
     *  Pill    = .4
     *  Enemy   = 1
     *  Pacman  = .5
     */
    function getInput()
    {
        var input = [];
        
        // The values in the map, pills walls etc
        for(var i = 0; i < 22; i++)
        {
            for(var j = 0; j < 19; j++)
            {
                input.push(map.map[i][j] / 10)
            }
        }

        // The player position
        for(var i = 0; i < 1; i++)
        {
            var ary = user.pointToCoord(userPos.y) * 19
            var arx = user.pointToCoord(userPos.x)
            input[ary + arx] = 1
        }

        // The ghosts positions
        for(var i = 0; i < 4; i++)
        {
            var ary = ghosts[i].pointToCoord(ghostPos[i].old.y) * 19
            var arx = ghosts[i].pointToCoord(ghostPos[i].old.x)
            input[ary + arx] = 2
        }

        return input
    }
    
    return {
        "init" : init,
        "startNewGame" : startNewGame
    };
    
}