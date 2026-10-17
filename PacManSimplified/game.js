/**
 *  game.js - one Pac-Man simulation used to evaluate NEAT networks.
 *
 *  Adapted from github.com/daleharvey/pacman. The original was a human playable game driven by
 *  timers; here it is a tick based simulation where a neural network chooses pacman's direction.
 *
 *  Big picture
 *      simulationenvironment.js creates config.SimNum of these Game objects, all sharing one AITrainer
 *      (ai/aiTrainer.js). Every tick it calls step() on each game, and when rendering it calls draw().
 *      Each game asks the trainer which network it is playing (by its id), feeds that network
 *      getInput() every decision, and reports the result of each finished game with AI.finishGame().
 *      The trainer decides when a game moves on to the next network and when the generation is over.
 *
 *  Units
 *      Positions (userPos, ghostPos) are in pixels on a 10px per tile grid, e.g. {x: 90, y: 120} is
 *      column 9, row 12. user.pointToCoord() / ghost.pointToCoord() round pixels to the nearest tile.
 *      Pacman moves 2px per tick (5 ticks per tile), ghosts move 1px per tick (10 ticks per tile).
 *      The map arrays are indexed map[row][column], i.e. map[y][x].
 *
 *  Directions
 *      The AI side uses its own numbering, clockwise from left: 0 LEFT, 1 UP, 2 RIGHT, 3 DOWN
 *      (user.getDirection() / user.setDirection()). The direction vectors used by the searches below
 *      are in the same order: [-1, 0] left, [0, -1] up, [1, 0] right, [0, 1] down (y grows downwards).
 */
import {WAITING, COUNTDOWN, EATEN_PAUSE, DYING, PLAYING, KEY, MAP, MAX_SEARCH_DISTANCE } from "/objects/definitions.js"
import { User } from "/objects/user.js";
import { GameMap } from "/objects/map.js"
import { Ghost } from "/objects/ghost.js";

// Pacman dies if it goes this long without eating. Without this a network that learns to hide in a
// corner (or bounce between two tiles) would survive forever and stall the generation.
// Converted to ticks below (starveTicks = STARVE_SECONDS * fps)
const STARVE_SECONDS = 3

// One colour per ghost, setMode() makes the first ghostCount of them
// NOTE: MAP is imported but not used in this file, the maps are loaded through GameMap (map.reset)
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

/**
 *  Number of inputs getInput() returns for a selection, the open space inputs are always included.
 *  Used by the trainer setup to size the networks (config.Inputs), so it has to agree with getInput().
 *      inputSignals - e.g. { pellets: true, ghosts: true }, missing or false entries are left out
 *      returns      - 4 + 4 per selected signal, e.g. pellets and ghosts selected -> 4 + 8 = 12
 */
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
 *
 *  Params:
 *      fps - ticks per "second" of game time. Only used for starvation (starveTicks) and to turn
 *            aliveTicksAtFood into seconds for the fitness. It does not control how often step() is called,
 *            simulationenvironment.js does that
 *      AI  - the shared AITrainer, see the hand-off section below
 *      id  - this simulation's index, used as the canvas id and to tell the trainer which sim is asking
 *
 *  Returns an object with init, destroy, step, draw, isIdle, startNewGame, recordGeneration,
 *  killPlayer, setMapI and setMode (see the bottom of this function).
 *
 *  Lifecycle (driven by simulationenvironment.js):
 *      Game(...) -> init(wrapper) builds the canvas, map and pacman and starts a game ->
 *      setMode(MODES[mode]) -> startNewGame() -> step() every tick, draw() every frame ->
 *      destroy() when training restarts.
 *
 *  State machine (the `state` variable, advanced by step()):
 *
 *      WAITING ---(AI.hasNetwork(id))---> startNewGame() -> startLevel() -> COUNTDOWN
 *         |
 *         +--(no network left)--> idle until the generation ends (simulationenvironment
 *                                 then calls setMode/startNewGame for the next generation)
 *
 *      COUNTDOWN ---(next tick)---> PLAYING
 *
 *      PLAYING: every tick update() moves everything, the network picks a direction, then
 *          - touching a vulnerable ghost      -> EATEN_PAUSE (ghost eaten, score added)
 *          - touching a dangerous ghost       -> DYING
 *          - eating the last pellet           -> DYING via completedLevel() (lives removed so the game ends)
 *          - no food for STARVE_SECONDS       -> DYING
 *
 *      EATEN_PAUSE ---(next tick)---> PLAYING
 *
 *      DYING ---(next tick)---> loseLife():
 *          - lives left -> startLevel() -> COUNTDOWN (same board, positions reset)
 *          - no lives   -> AI.finishGame(...) and stay in WAITING, where the next tick asks for a network
 *
 *  COUNTDOWN, EATEN_PAUSE and DYING each last exactly one tick. In the original game they were timed
 *  pauses (that is what timerStart was for); for training they are only kept as transitions.
 *
 *  Hand-off to the trainer:
 *      - AI.execute(getInput(), id) runs this sim's current network and returns its decision (0 to 3)
 *      - AI.finishGame(score, aliveTicksAtFood / FPS, id) reports a finished game. The trainer adds a
 *        survival bonus for the seconds, averages config.GamesPerNetwork games into the network's
 *        fitness, and only then moves this sim on to the next network. Until then hasNetwork(id) stays
 *        true and the same network plays again
 *      - AI.hasNetwork(id) is checked in WAITING. False means the population has been handed out, so this
 *        game goes idle. simulationenvironment ends the generation once the trainer says it is over and
 *        every game is idle
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
        level        = 0,              // Shown in the footer. NOTE: always 1 once a game starts, completing a level ends the game
        tick         = 0,              // Simulation time, everything is timed in ticks. Never reset, keeps counting across games
        ghostPos     = [],             // Each ghost's {new, old} pixel position from the last tick, same order as ghosts
        userPos, prevUserPos, prevUserDec, // Pacman's pixel position this tick and last tick (prevUserDec is unused)
        stateChanged = true,           // Set by setState(), lets WAITING run only once per wait
        timerStart   = null,           // Tick of the last timed event, only read by commented out code
        lastFoodTick = 0,              // Tick pacman last ate, for starvation
        aliveTicks   = 0,              // Ticks spent in PLAYING this game (reset by startNewGame, not per life)
        aliveTicksAtFood = 0,          // aliveTicks when pacman last ate. The survival bonus only counts up to here,
                                       // so wandering or stalling until starvation earns nothing
        ctx          = null,           // The canvas 2D context, also passed to move()/makeEatable() which ignore it here
        map          = null,           // The GameMap, holds the live board (pellets disappear as they are eaten)
        mapI         = mapIndex,       // Which map in MAP is played
        user         = null,           // Pacman
        idle         = false,          // True when this game is out of networks for the generation
        visible      = true,           // Whether the canvas is on screen, drawing is skipped if not
        canvas,
        stats,                         // Text under the canvas
        rec,                           // MediaRecorder when recording a generation
        observer,                      // Watches whether the canvas is on screen
        wins = 0,                      // Levels completed. NOTE: counted but never displayed or reported anywhere
        FPS = fps,
        starveTicks = STARVE_SECONDS * fps; // Ticks without food before pacman starves, see step()

    // Current tick. Handed to the ghosts (Ghost({"getTick": getTick}, ...)) so they can time how long
    // they stay eatable or eaten
    function getTick() { 
        return tick;
    };
    
    // Writes text centred just below the board, in the footer area. Only used for "Paused" by draw()
    function dialog(text) {
        ctx.fillStyle = "#FFFF00";
        ctx.font      = "14px BDCartoonShoutRegular";
        var width = ctx.measureText(text).width,
            x     = ((map.width * map.blockSize) - width) / 2;        
        ctx.fillText(text, x, (map.height * 10) + 8);
    }

    // Leftover from the original game's sound toggle (S key). There is no sound in this version,
    // the flag is only stored and read by keyDown()
    function soundDisabled() {
        return localStorage["soundDisabled"] === "true";
    };
    
    // Starts a life: puts pacman and the ghosts back at their starting spots and goes to COUNTDOWN.
    // The board is NOT reset, eaten pellets stay eaten. Called by startNewGame() and by loseLife()
    // when pacman has lives left.
    // lastFoodTick is reset so the starvation timer starts fresh for the new life
    function startLevel() {
        user.resetPosition();
        for (var i = 0; i < ghosts.length; i += 1) { 
            ghosts[i].reset();
         }
        timerStart = tick;
        lastFoodTick = tick;
        setState(COUNTDOWN);
    }    

    // Starts a whole new game for the network this sim is currently playing: fresh score and lives,
    // fresh board for the current map and mode, survival counters zeroed, then startLevel().
    // Called by:
    //      - step() in WAITING, when the trainer still has a network for this sim
    //      - loaded() (from init), and simulationenvironment.js at the start of training and of each generation
    //      - keyDown() on the N key
    // The setState(WAITING) at the top is immediately replaced by COUNTDOWN in startLevel(), so the
    // WAITING branch of step() does not run for it.
    // NOTE: starting a new game with N mid-game drops the unfinished game, the trainer never hears about it
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

    // Document keydown listener (added in loaded()). N starts a new game, S toggles the unused sound
    // flag, anything else goes to pacman (arrow keys set his direction, though the network overrides it
    // on its next decision). Returns user.keyDown()'s result for other keys (false for an arrow key,
    // which it also stops from scrolling the page), true otherwise.
    // NOTE: every sim registers its own listener, so N restarts every sim at once
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

    // Called by step() the tick after the state became DYING (ghost, starvation, completed level or
    // killPlayer). Takes a life; if any are left the same game carries on with startLevel(), otherwise
    // the game is over and its result goes to the trainer.
    // The state is left at WAITING on game over, and since setState() also sets stateChanged, the next
    // step() runs the WAITING branch once and either starts the next game or goes idle.
    // Fitness detail: the seconds reported are aliveTicksAtFood / FPS, i.e. time alive up to the last
    // pellet eaten, not up to death. Time spent wandering before starving earns nothing
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

    // Every state change goes through here. stateChanged lets the WAITING branch of step() act only
    // once per wait (it clears the flag) instead of every tick while idle.
    // Also handed to pacman (User(..., setState)), though user.js only keeps it in unused code
    function setState(nState) { 
        state = nState;
        stateChanged = true;
    };
    
    // True if pacman and a ghost are less than a tile (10px) apart, centre to centre.
    // user and ghost are pixel positions {x, y} (the parameter `user` shadows the pacman object here).
    // Ghosts move 1px and pacman 2px per tick, so they can't pass through each other between checks
    function collided(user, ghost) {
        return (Math.sqrt(Math.pow(ghost.x - user.x, 2) + 
                          Math.pow(ghost.y - user.y, 2))) < 10;
    };

    // Paints the strip under the board: one pacman icon per life, the score and the level.
    // Called by draw()
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

    // Move pacman and the ghosts, then resolve collisions. Called by step() once per PLAYING tick,
    // before the network decides.
    //  1. Expire each ghost's eatable/eaten timers (ghost.update) and move it 1px. Their {new, old}
    //     positions are kept in ghostPos, which getInput() reads afterwards
    //  2. Move pacman 2px (user.move). This is also where he eats: it can call ateFood(), eatenPill()
    //     and completedLevel() back in this file
    //  3. Check each ghost against pacman's new position: a vulnerable ghost is eaten
    //     (EATEN_PAUSE, 50 x ghosts eaten since the pill), a dangerous one kills him (DYING)
    // NOTE: the collision loop doesn't stop at the first hit, so a later ghost in the list overrides the
    // state set by an earlier one (e.g. DYING from a recovered ghost, then EATEN_PAUSE from a still
    // vulnerable one on the same tick means pacman survives). It also runs after completedLevel(), so
    // eating a ghost on the same tick as the last pellet replaces that DYING with EATEN_PAUSE
    function update() { 

        var u, nScore;
        
        ghostPos = [];

        // Step 1. prevUserPos is only used by the (disabled) chase behaviour in ghost.js
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            ghosts[i].update();
            ghostPos.push(ghosts[i].move(ctx, prevUserPos, i));
        }
        // Step 2
        u = user.move(ctx, setState);
        
        prevUserPos = userPos
        userPos = u["new"];
        
        // Step 3
        for (var i = 0, len = ghosts.length; i < len; i += 1) {
            if (collided(userPos, ghostPos[i]["new"])) {
                // Vulnerable is checked first because isDangerous() is also true while vulnerable.
                // A ghost that was recently eaten (grey, harmless for 3 "seconds") is neither, so touching it does nothing
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

    /**
     *  Advance the simulation by one tick. Called by simulationenvironment.js (stepAll) for every sim,
     *  many times per frame when training fast or headless. Never touches the canvas, see draw().
     *
     *  Each tick does exactly one of these, depending on the state (see the state machine above Game):
     *      PLAYING     - 1. count the tick towards survival (aliveTicks)
     *                    2. update(): move ghosts and pacman, eat, resolve collisions
     *                    3. ask the network for a direction (every tick, or only on tile centres)
     *                    4. check for starvation
     *      WAITING     - only on the first tick after entering it: start the next game if the trainer
     *                    has a network for this sim, otherwise go idle (and stop any recording)
     *      EATEN_PAUSE - back to PLAYING
     *      DYING       - loseLife()
     *      COUNTDOWN   - back to PLAYING
     *  Does nothing at all once the trainer has run its last generation.
     */
    function step() {

        if (AI.getCurrentGeneration() >= AI.getMaxGeneration()) {
            return;
        }

        ++tick;

        if (state === PLAYING) {
            // Step 1
            ++aliveTicks;
            // Step 2
            update();

            // Step 3. Deciding which direction to go, between decisions pacman keeps going the way it was.
            // The network's output is RELATIVE to pacman's heading, the same frame getInput() uses:
            // 0 = straight, 1 = turn right, 2 = turn around, 3 = turn left
            // Adding the current direction (0 LEFT, 1 UP, 2 RIGHT, 3 DOWN, clockwise) and wrapping turns it
            // into an absolute direction. Example: heading UP (1) and the network says turn right (1)
            // -> (1 + 1) % 4 = 2 = RIGHT. Heading LEFT (0) and it says turn left (3) -> 3 = DOWN.
            // user.setDirection() only requests the turn, user.move() takes it once that way is open.
            // Pacman is centred when both pixel coordinates are multiples of 10 (every 5 ticks while moving)
            // NOTE: user.getDirection() is the requested direction (`due` in user.js), not necessarily the
            // way pacman is actually moving, e.g. a turn requested into a wall stays requested until it opens
            // NOTE: this still runs when update() just changed the state (DYING, EATEN_PAUSE), it is harmless
            // since the next tick handles the new state first
            let centered = userPos.x % 10 === 0 && userPos.y % 10 === 0
            if (!decideOnTileCenter || centered) {
                let decision = (AI.execute(getInput(), id) + user.getDirection()) % 4

                user.setDirection(decision);
            }

            // Step 4. Starvation, lastFoodTick is updated by ateFood() and startLevel().
            // Checks state again because update() may already have ended this life
            if (state === PLAYING && (tick - lastFoodTick) > starveTicks) {
                setState(DYING);
            }

        } else if (state === WAITING && stateChanged) {            
            // Only act once per wait, setState() sets stateChanged again on the next change
            stateChanged = false;

            // Not isGenerationOver(): this game may still owe games for its network after the last one is handed out
            // hasNetwork(id) is true while this sim is partway through its current network's games, or has
            // just been given the next network by the trainer's finishGame()
            if (AI.hasNetwork(id)) {
                startNewGame();
            } else {
                // Out of networks. simulationenvironment ends the generation once every game is idle,
                // and startNewGame() clears this flag at the start of the next one
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

    // Paint the current state of the simulation. Called by simulationenvironment.js once per animation
    // frame when not headless (several step()s may have happened in between).
    //      paused - draw the "Paused" text over the footer
    // Skipped while the canvas is scrolled off screen, unless it is being recorded
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

        // Text under the canvas: which network this sim is playing and which of its games this is
        stats.textContent = idle ? "Waiting for generation to finish" : `Network ${AI.getCurrentNetId(id)} · game ${AI.getCurrentGameNumber(id)} / ${AI.getConfig().GamesPerNetwork}`
    }

    // Callback from user.move() when pacman eats a power pill (only on the board in the power mode).
    // Makes every ghost eatable (ghosts that are currently eaten included) and restarts the
    // 50/100/150... ghost scoring
    function eatenPill() {
        timerStart = tick;
        eatenCount = 0;
        for (var i = 0; i < ghosts.length; i += 1) {
            ghosts[i].makeEatable(ctx);
        }        
    };

    // Callback from user.move() whenever pacman eats a pellet or a power pill (after eatenPill/completedLevel).
    // Resets the starvation timer and marks how long he had survived at this point, which is what the
    // survival part of the fitness uses (see loseLife)
    function ateFood() {
        aliveTicksAtFood = aliveTicks;
        lastFoodTick = tick;
    };
    
    // Callback from user.move() when the last pellet/pill on the board is eaten.
    // Clearing the board ends the game rather than starting level 2: every life is removed and the state
    // goes to DYING, so next tick loseLife() reports the game to the trainer. The board is reset here
    // only so it isn't left empty; startNewGame() resets it again anyway.
    // The commented out lines are the original "next level" behaviour.
    // NOTE: the loop compares i against getLives() while lives go down, so it only removes about half of
    // them (3 lives -> 1 left, 2 -> 1, 1 -> 0). The extra loseLife() after DYING covers that for up to 3
    // lives, but with 4 or more (pacman starts with 1 and gains one at 10000 points) a life would be left and the game
    // would carry on with startLevel() on the fresh board
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

    // Document keypress listener (added in loaded()). Stops the page reacting to keys (e.g. scrolling
    // on space) while a game is running, except when typing in a form field
    function keyPress(e) { 
        if (state !== WAITING && !isTyping(e)) { 
            e.preventDefault();
            e.stopPropagation();
        }
    };
    
    // Builds this sim's card (title, canvas, stats line) inside `wrapper`, creates the map and pacman,
    // sets up the default mode and starts the first game. Called once by simulationenvironment.js
    // right after Game(...).
    // blockSize is the size of a tile on the canvas (18px for a 19 tile wide map). It only affects
    // drawing; the simulation itself always uses 10px tiles.
    // The canvas is 22 tiles tall plus 30px for the footer
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
        // Pacman calls back into this game when he eats (see ateFood, eatenPill and completedLevel)
        user  = User({ 
            "completedLevel" : completedLevel, 
            "eatenPill"      : eatenPill,
            "ateFood"        : ateFood
        }, map, true, setState);

        setMode(mode);
        loaded();
    };
        
    // Last part of init(): starts a game and hooks up the keyboard. The name is left over from the
    // original, where this ran after the font and sounds had loaded
    function loaded() {

        startNewGame();
        
        document.addEventListener("keydown", keyDown, true);
        document.addEventListener("keypress", keyPress, true); 
    };

    // Detach from the page before this game is thrown away (training restarts).
    // Called by simulationenvironment.js on every game before it builds new ones. Removes the key
    // listeners and the visibility observer, and stops a recording without downloading it
    // (rec.onstop is cleared first). The card itself is removed by the caller clearing its container
    function destroy() {
        document.removeEventListener("keydown", keyDown, true);
        document.removeEventListener("keypress", keyPress, true);
        observer.disconnect();
        if (rec && rec.state == "recording") {
            rec.onstop = null;
            rec.stop();
        }
    }

    // Records this sim's canvas to a video until the sim goes idle (step() stops the recorder in
    // WAITING when there are no networks left), then downloads it as pacAI.webm via exportVid().
    // Called from simulationenvironment.js on GAMES[0] at the start of the last generation (not when headless).
    // While recording, draw() keeps painting even if the canvas is off screen
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

    // Downloads the recorded video by clicking a temporary link. Called by the recorder's onstop.
    // NOTE: the object URL is never revoked, a small leak per recording
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


    /** OLD INPUT EXPERIMENT, no longer called (step() uses getInput()). Kept for reference.
     *  Fed the network 7 values: the 4 neighbouring tiles as weighted values (oriented to pacman's
     *  heading), whether the nearest ghost is eatable, and the (distance, angle) of the nearest ghost
     *  within 3.5 tiles (straight line, not walking distance).
     *
     *  Gets the current state of the map
     *  Tile    = map value = input value
     *  Wall    = 0 = 0
     *  Buiscut = 1 = 2
     *  Empty   = 2 = .5
     *  Block   = 3 = 0
     *  Pill    = 4 = 5
     *  Ghost   = -5 if dangerous, 5 if vulnerable
     *  Pacman  = empty = 0
     * 
     *  Orients the input around Pacman's perspective in a 3x3 box (9)
     *  (NOT YET) Also returns the distance (d,theta) of the ghosts (6)
     *  (The 3x3 box is the commented out version below; the live code only reads the 4 neighbours,
     *  and the ghost value rows above are not written into the map here, see getInput2 for that) */
    function getInput1()
    {
        // OLD: the 3x3 box around pacman, row by row
        // for (var i = 0; i < 3; i++) {
        //     var row = []
        //     for (var j = 0; j < 3; j++) {
        //         row.push(getVal(mapCopy?.[(uY - 1) + i]?.[(uX - 1) + j]))
        //     }
        //     input.push(...row)
        // }


        // NOTE: getMapClone() ignores its mapI argument, it always copies the live board. The copy is
        // only read here, so the clone isn't needed (same in the other input builders except getInput2)
        let mapCopy = map.getMapClone(mapI)

        // Map tile value -> input value, see the table above. Off the map (undefined) counts as a wall
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
        // The 4 neighbouring tiles in absolute order: left, up, right, down
        let unoriented = []
        unoriented.push(getVal(mapCopy?.[uY]?.[(uX - 1)]))
        unoriented.push(getVal(mapCopy?.[(uY - 1)]?.[uX]))
        unoriented.push(getVal(mapCopy?.[uY]?.[(uX + 1)]))
        unoriented.push(getVal(mapCopy?.[(uY + 1)]?.[uX]))

        // Orient around pacman so input is always ordered as [front, top, back, bottom]
        // ("top" and "bottom" here mean pacman's right and left: index (i + due) % 4 walks clockwise
        // from his heading, so the order is front, right, back, left, the same as getInput())
        for (let i = 0; i < 4; i++) { // 0, 1, 2, 3
            input[i] = unoriented[(4 + (i + due)) % 4] // TODO
        }

        // OLD GHOST POS
        // Nearest ghost within minDist tiles (straight line) as [distance, angle relative to heading]
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
            // (dX, dY) points from the ghost to pacman, so a ghost straight ahead of a left-facing
            // pacman (due 0) gives theta 0; subtracting 90 degrees per direction step rotates that to
            // pacman's heading. The if wraps it back into roughly (-pi, pi]
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

        // Earlier variant: a fixed distance and a random angle in place of a real ghost
        // let ghostsInput = []
        // let minDist = 3.5
        // let d = Math.PI * ((Math.random() * 2) - 1)
        // ghostsInput.push(minDist, d)

        // Earlier variant: 4 flags for a ghost within 2 tiles in a straight line in each direction
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
        // 7 values: 4 neighbour tiles, nearest ghost eatable flag, nearest ghost [d, theta]
        return [...input, ghostsEatable ? 1 : 0, ...ghostsInput]
    }

    /**
     *  Recursive depth first search for the walking distance to the nearest pellet, dangerous ghost,
     *  power pill and vulnerable ghost. This is the search getInput() uses, once per direction.
     *
     *  map = copy of the current map state
     *  visited = Map of "x,y" -> the shortest depth this tile has been reached at so far, shared by the
     *            whole search. getInput() pre-marks pacman's own tile with -1 so it is never entered
     *  dirTraversing = the direction vector of the current search (the step that brought us to curLoc)
     *  curLoc = {"x": x, "y": y} - current location of the search, in tiles
     *  ghostInfo = [[x, y, vulnerable, dangerous], ...] for all ghosts, in tiles
     *  objDist = [pelDist, ghostDist, pillDist, eatableGhostsDist] - the travel distance from the start of our search to the nearest obj
     *            (the best found so far by the caller, Infinity = not found)
     *  depth = how many spaces we have traversed (the starting tile, next to pacman, is depth 0)
     *  Returns objDist updated with anything found from here on, distances in tiles from the start tile
     *
     *  Steps:
     *      1. Stop if past MAX_SEARCH_DISTANCE
     *      2. Stop if this tile was already reached by a path at least as short. Otherwise record this depth
     *      3. Stop at walls, the ghost house and off the map
     *      4. Record a pellet, power pill or ghost on this tile (min with what we already had)
     *      5. Recurse into the neighbours (except straight back) and merge their results with a min
     *
     *  Why the visited Map stores depths rather than being a plain Set: depth first search can reach a
     *  tile by a long detour before it reaches it by the short way. With a Set, the detour would claim
     *  the tile and the short path would be cut off there, so anything beyond it would be reported too
     *  far away (or not at all if the detour hit MAX_SEARCH_DISTANCE). Re-exploring a tile whenever a
     *  strictly shorter path arrives fixes that, at the cost of visiting some tiles more than once.
     *
     *  Example, a 2x2 loop of open tiles with a pellet P below C, starting at A (everything else is wall):
     *          A B
     *          C D
     *          P
     *      Neighbours are tried left, up, right, down, so DFS goes A(0) -> B(1) -> D(2) -> C(3) -> P(4)
     *      first, recording the pellet at 4. Then A's own "down" branch reaches C at depth 1 < 3, so C is
     *      explored again and P is found at 2, and the min merge keeps 2. With a plain visited Set the
     *      second visit to C would be refused and the answer would stay 4.
     *
     *  NOTE: off the map counts as a wall, so the search does not follow the tunnel that wraps from one
     *  side of the board to the other, even though pacman can walk through it
     *  NOTE: an object at exactly MAX_SEARCH_DISTANCE is found, but getInput() normalizes that distance to 0,
     *  the same as not found
     *  bfsToObjects below is a breadth first version that gives the same results
     */
    function traverseToObjects(map, visited, dirTraversing, curLoc, ghostInfo, objDist, depth) {
        // Step 1
        if (depth > MAX_SEARCH_DISTANCE) return objDist

        // Step 2
        // If we've already visited this spot from a shorter path then lets break
        // (an equal depth is skipped too, it can't find anything closer than the first visit did)
        let key = `${curLoc.x},${curLoc.y}`
        if (visited.has(key) && visited.get(key) <= depth) return objDist
        visited.set(key, depth)

        // Step 3
        // 0 = Wall, 1 = Pellet, 2 = Empty, 3 = The ghost house, 4 = Power pill
        let curSpotValue = map?.[curLoc.y]?.[curLoc.x]

        // If a wall, stop searching in this direction
        // (the ghost house counts as a wall, so ghosts inside it are never seen)
        if (curSpotValue == 0  
            || curSpotValue == undefined
            || curSpotValue == 3) {
                return objDist
            }

       // Step 4. Work on a copy so the caller's array (which is also its merge result) isn't changed here
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
        // Vulnerable is checked first because a vulnerable ghost is also "dangerous" (isDangerous() only
        // means not eaten). Recently eaten ghosts are neither and are ignored
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

        // Step 5
        // left, up, right, down
        let dirVectors = [[-1, 0], [0, -1], [1, 0], [0, 1]]
        // search and then merge the results
        // NOTE: mergedObjDist is the same array as objDistCopy, not a copy, so later branches start from
        // the earlier branches' results. That's harmless since everything is merged with a min anyway
        let mergedObjDist = objDistCopy
        for (let i = 0; i < dirVectors.length; i++) {
            // I don't want to navigate to space I just left
            // (a direction is the reverse of dirTraversing when the two vectors add up to [0, 0]. The
            // visited depths would refuse that tile anyway, this just saves the call)
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
    // Not currently used, getInput() has a commented out call to it. It returns the same distances, and
    // is the faster choice if MAX_SEARCH_DISTANCE is raised a lot, since the depth first search can
    // revisit tiles many times while a breadth first search reaches each tile once, by its shortest path.
    //  1. Start with pacman's tile already visited and the start tile queued at depth 0
    //  2. Take the next queued tile; skip it if too deep, already visited, or not walkable
    //  3. Mark it visited and record any pellet, pill or ghost on it
    //  4. Queue its 4 neighbours at depth + 1 (they are filtered when they come out, in step 2)
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

        // Step 1. A plain Set is enough here (unlike traverseToObjects): tiles come out of the queue in
        // order of depth, so the first time a tile is visited is always by a shortest path
        let visited = new Set([`${blocked.x},${blocked.y}`])
        let queue = [{ "x": start.x, "y": start.y, "depth": 0 }]

        // Read through the queue with an index instead of shift() so each dequeue is O(1)
        for (let q = 0; q < queue.length; q++) {
            // Step 2
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

            // Step 3
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

            // Vulnerable first, as in traverseToObjects
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

            // Step 4
            for (let i = 0; i < dirVectors.length; i++) {
                queue.push({ "x": x + dirVectors[i][0], "y": y + dirVectors[i][1], "depth": depth + 1 })
            }
        }

        return objDist
    }


    // THE INPUT BUILDER IN USE, called by step() every time the network makes a decision.
    // Returns 4 signals indicating if there is an open space, then the nearest walkable distance from
    // each direction for the following items: pellets, ghosts, power pills, eatable ghosts.
    // Order within each group of 4: front, right, back, left, relative to pacman's heading (the same
    // order as the network's outputs, so "output 1 = turn right" lines up with "input 1 = right")
    // Input size: 4 open signals + 4 per selected signal in inputSignals, see inputCount()
    // Each distance is normalized: max(0, 1 - d/MAX_SEARCH_DISTANCE), so 1 = on the tile next to pacman,
    // 0 = none within range. Closer is bigger, which gives "nothing found" a natural value of 0
    // [open, pellets, ghosts, pills, eatable], leaving out the signals not selected
    //
    // Steps:
    //  1. Read pacman's tile and heading, and each ghost's tile and status
    //  2. For each of the 4 absolute directions (left, up, right, down):
    //      a. search from the neighbouring tile that way (traverseToObjects), with pacman's own tile
    //         pre-marked as visited so the search can't loop back behind him and report something
    //         that is really in another direction
    //      b. rotate the direction into pacman's frame and store the normalized distances and
    //         whether the neighbouring tile is walkable
    //  3. Return open + the selected signals in INPUT_SIGNALS order
    //
    // Example: pacman facing UP (due 1), a pellet 2 tiles to his left (on the 2nd tile, so search depth 1)
    //      i = 0 (LEFT) -> orientedI = (0 - 1 + 4) % 4 = 3 = left, pellets[3] = 1 - 1/10 = 0.9
    //
    // Each direction is searched separately, so the same pellet can show up in several directions
    // when paths lead to it both ways, each with its own distance.
    // NOTE: the searches are capped at MAX_SEARCH_DISTANCE tiles, so late in a level when the remaining
    // pellets are further away, every pellet input reads 0 and the network has nothing to steer by
    // NOTE: while pacman is passing through the side tunnel his tile can be off the map (column -1 or 19);
    // then only the direction back onto the board sees anything, the other inputs read 0
    function getInput() {
        // Signals
        let pellets = [], ghostsSig = [], pills = [], vulGhosts = [], open = []

        // left, up, right, down
        let dirVectors = [[-1, 0], [0, -1], [1, 0], [0, 1]]

        // Step 1
        // NOTE: this copies the whole board every decision, though the searches only read it
        let mapCopy = map.getMapClone(mapI)
        let curLoc = { "y": user.pointToCoord(userPos.y), "x": user.pointToCoord(userPos.x)}

        let norm = (v) => Math.max(0, (1 - (v/MAX_SEARCH_DISTANCE)))

        // Heading in the AI's numbering, 0 LEFT, 1 UP, 2 RIGHT, 3 DOWN (the requested direction, see step())
        let due = user.getDirection()

        // 1 if the tile next to pacman in direction dir is walkable (pellet, empty or power pill), else 0.
        // The ghost house (3), walls (0) and off the map count as not walkable
        let spaceWalkable = (map, userLoc, dir) => {
            let val = map?.[userLoc.y + dir[1]]?.[userLoc.x + dir[0]]

            if (val == 1 || val == 2 || val == 4) {
                return 1
            }

            return 0
        }

         // Get ghosts info
         // One row per ghost: [tile x, tile y, vulnerable, dangerous]. Uses the ghost's position from
         // before this tick's move ("old"), so it can be one pixel behind; rounded to tiles that rarely
         // matters. Rows are prepended, so they end up in reverse order, which doesn't matter either
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
        // Step 2, i is the absolute direction (0 LEFT, 1 UP, 2 RIGHT, 3 DOWN)
        for (let i = 0; i < dirVectors.length; i++) {
            // Step 2a. A fresh visited Map per direction. Pacman's tile gets depth -1, lower than any
            // real depth, so traverseToObjects always refuses to enter it
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
            // The breadth first alternative, gives the same results (swap with the call above)
            // let searchResults = bfsToObjects(
            //     mapCopy,
            //     {"x": curLoc.x + dirVectors[i][0], "y": curLoc.y + dirVectors[i][1]},
            //     curLoc,
            //     ghostInfo,
            //     MAX_SEARCH_DISTANCE)            
            
            // Step 2b. Rotate absolute direction i into pacman's frame: 0 front, 1 right, 2 back, 3 left.
            // Both numberings go clockwise, so it's just "how many quarter turns clockwise from the heading".
            // E.g. facing RIGHT (due 2): DOWN (i 3) -> 1 = right, LEFT (i 0) -> 2 = back.
            // The + 4 keeps the % from seeing a negative number
            let orientedI = (i - due + 4) % 4    
            pellets[orientedI] = norm(searchResults[0])
            ghostsSig[orientedI] = norm(searchResults[1])
            pills[orientedI] = norm(searchResults[2])
            vulGhosts[orientedI] = norm(searchResults[3])
            open[orientedI] = spaceWalkable(mapCopy, curLoc, dirVectors[i])
        }

        // Determine which headings are open
        // (done in the loop above, open[] is filled alongside the distances)
        

        // Step 3. Keys match INPUT_SIGNALS, which fixes the order; unselected signals are left out
        // e.g. pellets and ghosts selected -> [open x4, pellets x4, ghosts x4]
        let signals = { pellets, ghosts: ghostsSig, pills, vulnerableGhosts: vulGhosts }

        return [...open, ...INPUT_SIGNALS.filter(s => inputSignals?.[s]).flatMap(s => signals[s])]
    }

    // OLD INPUT EXPERIMENT, no longer called (step() uses getInput()). Kept for reference.
    // Fed the network 6 values: the 4 neighbouring tiles as weighted values (front, right, back, left,
    // as in getInput1) and the straight line (distance, angle) of the nearest pellet anywhere on the board.
    // The ghost (d, theta) values are still computed but were dropped from the return value.
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

        // Scan the whole board for the closest pellet in a straight line (ignores walls)
        // NOTE: here (dX, dY) points from pacman to the pellet, the opposite of the ghost angles below,
        // so "straight ahead" is theta = pi for pellets but 0 for ghosts
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
        // [d, theta] for each of up to 4 ghosts, and whether any is eatable. Computed but not returned
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

        // 6 values as written ("15" was the count with the ghost inputs included)
        return [...input, ...nearestPellet]//, ...ghostsInput, ghostsEatable ? 1 : 0] // 15
    }

    // OLD INPUT EXPERIMENT, no longer called (step() uses getInput()). Kept for reference.
    // Fed the network the whole board as raw tile values (361 inputs for a 19 wide map), with ghosts
    // written in as 5 (vulnerable) or -5 (anything else, eaten ghosts included), re-centred on pacman
    // and rotated to his heading.
    //  1. Copy the board and write the ghosts into it (this is the one builder that really needs the clone)
    //  2. Shift every tile so pacman lands in the middle, wrapping around the edges
    //  3. Keep 19 rows (1 to 19) so the grid is square
    //  4. Rotate the grid a quarter turn `due` times so pacman's heading always points the same way
    //  5. Flatten row by row
    // Just the whole map (well 19x19)
    function getInput2() {
        // Step 1
        let mapCopy = map.getMapClone(mapI)

        let uY = user.pointToCoord(userPos.y)
        let uX = user.pointToCoord(userPos.x)
        let due = user.getDirection()

        // NOTE: a ghost off the board in the tunnel (column -1 or 19) would be written outside the row here
        for (let i = 0; i < ghosts.length; i++) {
            let gY = ghosts[i].pointToCoord(ghostPos[i].old.y)
            let gX = ghosts[i].pointToCoord(ghostPos[i].old.x)
            let v = ghosts[i].isVunerable()

            mapCopy[gY][gX] = v ? 5 : -5
        }

        // Step 2. How far each tile moves so pacman ends up at the centre; the source tile wraps around
        // when the shifted index goes off either edge
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

        // Step 3
        mapCopy2 = mapCopy2.slice(1, 20)

        // Step 4. Transpose then reverse the rows = rotate the grid a quarter turn anticlockwise
        for (let i = 0; i < due; i++) {
            mapCopy2 = mapCopy2[0].map((val, index) => mapCopy2.map(row => row[index])).reverse()
        }

        // Step 5
        let retInput = []
        for (let i = 0; i < mapCopy2.length; i++) {
            retInput.push(...mapCopy2[i])
        }

        return retInput
    }

    // OLD INPUT EXPERIMENT, no longer called (step() uses getInput()). Kept for reference.
    // Fed the network 8 values, looking in a straight line in each direction until a wall:
    //      wallD   - how many open tiles before the wall
    //      pelletE - the tile values along the way, each divided by its distance, so nearby pellets
    //                (2) and pills (4) count most and empty tiles (.1) barely count
    // Both rotated into pacman's frame (front, right, back, left). The ghost (d, theta) values are
    // still computed but were dropped from the return value.
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
        // (before the rotation below these are really absolute: left, up, right, down, which is what
        // the "Front", "Top", "Back" and "Bottom" loops below scan)
        let wallD = [0, 0, 0, 0]
        let pelletE = [0, 0, 0, 0]

        // Front
        // Each loop ends early by setting i to the loop limit when it reaches a wall
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
        // (i.e. front, right, back, left, see getInput1)
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
        // (17 was the count with the ghost inputs included, 8 values as written)
        return [...orientedD, ...orientedP]//, ...ghostsInput, ghostsEatable ? 1 : 0]
    }

    // True if v is in [b1, b2]. Only used by commented out code in getInput1
    function between (v, b1, b2) {
        return v >= b1 && v <= b2
    }

    // Ends the current life on the next tick (as if a ghost caught pacman). With 1 life that ends the
    // game and reports it to the trainer. Only referenced by killPlayers() in simulationenvironment.js,
    // which nothing calls (a debugging helper)
    function killPlayer() {
        setState(DYING)
    }

    // Switch to map i (an index into MAP), takes effect from the next startNewGame().
    // Only called from commented out code; the map normally comes from options.mapIndex
    function setMapI(i) {
        mapI = i
    }

    // Switch training mode, takes effect from the next startNewGame()
    // m is one of MODES. Rebuilds the ghosts (the first ghostCount colours, none in the pellets mode);
    // whether power pills are placed is read from mode by map.reset() in startNewGame().
    // Called by init() with the default mode, and by simulationenvironment.js at the start of training
    // and of each generation (the mode can be changed between generations)
    // NOTE: the new ghosts have no position until ghost.reset() runs in the next startNewGame() /
    // startLevel(), so call that right after (simulationenvironment.js does)
    function setMode(m) {
        mode = m
        ghosts = mode.ghosts
            ? GHOST_COLOURS.slice(0, ghostCount).map(colour => Ghost({"getTick":getTick}, map, colour, FPS, true))
            : []
        ghostPos = []
    }
    
    // True once this game has run out of networks for the current generation (set in step()'s WAITING
    // branch). simulationenvironment.js ends the generation when every game is idle
    function isIdle() {
        return idle
    }
    
    // The public interface, everything else stays private to this simulation
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