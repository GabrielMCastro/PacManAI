// The training page's main script, loaded by index.html as a module. It owns the whole training run:
//
//   config ──> startTraining() ──> AITrainer (ai/aiTrainer.js) + SimNum Game instances (game.js)
//                                    │
//   clock worker (every 4ms) ──> onClock() ──┐            (rendering mode, TICKS_PER_SECOND x Speed ticks/s)
//   MessageChannel ──> runHeadlessBatch() ───┴─> stepAll() (headless mode, as fast as possible)
//                                                  │  every Game advances one tick, asking the trainer
//                                                  │  for moves and reporting scores to it
//                                                  └─> completeGeneration() once every network has played:
//                                                        log, advanceGeneration(), apply the requested mode,
//                                                        restart the games. After MaxGens it stops and
//                                                        saves the population to ai/seeds through the server
//   requestAnimationFrame ──> frame()   only paints (canvases or the headless progress bars), never steps
//
// The simulation and the rendering are deliberately separate: stepping is driven by timers that keep
// running in background tabs, painting is driven by requestAnimationFrame, which the browser pauses there.
// The page's buttons (pause, headless, mode, config, save) are wired up near the bottom of the file.

import { Game, MODES, INPUT_SIGNALS, inputCount } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"
import { NetworkVisualizer } from "/ai/networkVisualizer.js"
import { confirmDialog, editConfig, toast } from "./dialogs.js"
import { TICKS_PER_SECOND } from "/objects/definitions.js"

// NOTE: nothing in the project imports m, it looks unused
export const m = "m"
// Elements of index.html. All of them are assumed to exist, so this script only works on that page
// (see the NOTE in visualize.js about importing it from elsewhere)
const simEl = document.getElementById("sim_container")       // Holds one canvas per Game
const genListEl = document.getElementById("generation_list") // Sidebar list of finished generations
const visEl = document.getElementById("visbody")             // Holds the network diagrams of the current population
const headlessBtn = document.getElementById("headless_toggle")
const pauseBtn = document.getElementById("pause_toggle")
const modeInputs = document.querySelectorAll("input[name=mode]") // Training mode radios (pellets, ghosts, power)
const modeNote = document.getElementById("mode_note")             // "X starts next generation" note under the radios
const configBtn = document.getElementById("config_button")
const saveBtn = document.getElementById("save_button")
const statusEl = document.getElementById("status")
// Headless mode progress display (#headless_panel), only shown while body has the headless class
const genBar = document.getElementById("gen_progress")
const genLabel = document.getElementById("gen_progress_label")
const runBar = document.getElementById("run_progress")
const runLabel = document.getElementById("run_progress_label")
const speedLabel = document.getElementById("speed_label")
const speedSelect = document.getElementById("speed_select")
const chaseToggle = document.getElementById("chase_toggle")

// Every Game is given TICKS_PER_SECOND (objects/definitions.js) as its ticks per game second, so game timings
// (starvation, the survival bonus, ghost timers) are the same whether the run is rendered or headless, and
// whatever the playback speed. playbackSpeed only sets how many ticks run per real second while rendering
let playbackSpeed = 1,       // Speed control on the page: rendering runs TICKS_PER_SECOND * playbackSpeed ticks/s
    HEADLESS_BATCH_MS = 50,  // How long a headless batch runs before yielding to the page
    GAMES = new Array();     // The Game instances, one per simulation (SimNum of them)

// The config the first run starts with, and the base the config editor edits.
// What each option does is documented at the top of ai/aiTrainer.js (trainer options) and game.js
// (the Game options, see gameOptions() below). Options left out use the trainer's defaults.
//   SimNum                 - games played side by side, each plays one network at a time
//   PopulationSize         - networks per generation
//   MaxGens                - training stops (and saves to ai/seeds) after this many generations
//   WeightMutationR        - chance per gene that a child's weight mutates
//   SeedNumber             - networks to load from ai/seeds/net_N.txt into the first generation, 0 = from scratch
//   StructureMutationR     - chance per child of one structural mutation (add a node or a connection)
//   DynamicSplitFactor     - with the dynamic split, scales how soon nodes are preferred over connections
//   StructureMutationSplit - chance a structural mutation adds a node, -1 (the default) = dynamic
//   NewInputs              - extra inputs added after the seeded networks' inputs (for a later training stage)
//   ProtectStructure       - never split connections that came from the seeds
//   InputSignals           - which optional input groups the networks get, see below
//   Outputs                - output nodes, one per move (straight, right, back, left)
//   ReproductionPercentile - within a species, only networks at or above this percentile reproduce
//   GamesPerNetwork        - games each network plays per generation, fitness is the average
//   SurvivalBonus          - points per second alive
//   GhostCount             - ghosts in the ghost and power pill modes (Game option)
//   MapIndex               - which map is played (Game option)
//   DecideOnTileCenter     - only ask for a move on tile centers (Game option)
//   Compatibility          - speciation distance weights (c1 excess, c2 disjoint, c3 weight difference)
//                            and the threshold under which a network joins a species
//   FullyConnected         - first generation starts with every input connected to every output
//                            (otherwise with no connections)
let config = {
    SimNum: 10,
    PopulationSize: 200,
    MaxGens: 40,
    WeightMutationR: .65,
    // SeedNumber: 200,
    StructureMutationR: .2,
    DynamicSplitFactor: .8,
    // StructureMutationSplit: 0,
    // NewInputs: 5,
    // ProtectStructure: true,
    // Which optional inputs the networks see, the 4 open space inputs are always included.
    // Inputs (the node count the trainer needs) is worked out from this in startTraining()
    InputSignals: {
        pellets: true,
        ghosts: false,
        pills: false,
        vulnerableGhosts: false,
    },
    Outputs: 4,
    ReproductionPercentile: .8,
    GamesPerNetwork: 3,  // Fitness is the average of this many games
    SurvivalBonus: 10,   // Points per second alive, a pellet is 10
    GhostCount: 1,       // Ghosts in the ghost and power pill modes, 1 to 4
    MapIndex: 1,         // Which map in MAP (objects/definitions.js) is played
    DecideOnTileCenter: true, // Network only picks a move when pacman is centered on a tile, turn off to react every tick
    StarveSeconds: 3,    // Game seconds without eating before pacman starves
    Compatibility: {
        c1: 1,
        c2: 1,
        c3: .2,
        threshold: 1.8
    },
    FullyConnected: false,
}
let AI = null // The current AITrainer, replaced by startTraining() on every (re)start

// Lets other modules look at the current trainer. Only visualize.js uses it
export const getTrainer = () => AI

// Run state
let headless = false,          // true = no rendering, run as fast as possible (see runHeadlessBatch)
    mode = "pellets",          // Training mode of the current generation
    modeRequested = "pellets", // Training mode to switch to at the start of the next generation
    chase = false,             // Ghosts chase pacman (instead of wandering) in the current generation
    chaseRequested = false,    // The chasing checkbox, applied at the start of the next generation like the mode
    paused = false,
    pausedAt = 0,              // performance.now() when the pause started, to leave paused time out of timings
    finished = false,          // true once MaxGens generations are done, nothing steps after that
    lastClock = performance.now(), // Time of the previous clock tick, onClock() turns the gap into ticks to run
    pendingTicks = 0,          // Ticks owed by the clock that haven't run yet, can be fractional
    genStartTime = performance.now(), // When the current generation started (paused time excluded), for the sidebar
    genTicks = 0,              // Ticks run in the current generation
    genHeadlessTicks = 0,              // Ticks of this generation that ran headless
    speedStartTime = performance.now(), // Start of the current ticks/s measurement
    speedTicks = 0,            // Ticks run since speedStartTime, for the headless ticks/s display
    bestAvg = 0                // Best generation average of this run, the sidebar bars are relative to it

// The parts of the config each Game uses, see Game in game.js.
// Called by startTraining() for every Game it creates. The trainer gets the whole config.
function gameOptions(config) {
    return {
        inputSignals: config.InputSignals,
        ghostCount: config.GhostCount,
        mapIndex: config.MapIndex,
        decideOnTileCenter: config.DecideOnTileCenter,
        starveSeconds: config.StarveSeconds,
    }
}

// (Re)start training from the first generation. Returns false and leaves the current run
// alone if the trainer can't be created (e.g. seed files missing)
//   newConfig - the full config (as the `config` object above). Inputs is filled in here
// Called once at page load with the default config, and by the config button with the edited one.
// Everything that can fail is checked before the old run is touched, so a bad config never
// leaves the page without a run.
function startTraining(newConfig) {
    // Signals have to be the first N of INPUT_SIGNALS (the config editor only allows that), otherwise
    // a signal added later lands in the middle of the inputs instead of after them
    // gap = index of the first selected signal whose predecessor isn't selected, -1 if there is none
    let gap = INPUT_SIGNALS.findIndex((s, i) => newConfig.InputSignals?.[s] && i > 0 && !newConfig.InputSignals?.[INPUT_SIGNALS[i - 1]])
    if (gap != -1) {
        toast(`Couldn't start training: input signal "${INPUT_SIGNALS[gap]}" needs "${INPUT_SIGNALS[gap - 1]}" turned on too`, true)
        return false
    }
    // The trainer needs the input node count, the Games need the signal selection; derive one from the other
    // so they can't disagree
    newConfig = { ...newConfig, Inputs: inputCount(newConfig.InputSignals) }

    // AITrainer loads seed files synchronously when SeedNumber is set, so a bad seed setup shows up
    // as an exception here
    let newAI
    try {
        newAI = AITrainer(newConfig)
    } catch (e) {
        console.error(e)
        toast(`Couldn't start training: ${e.message}`, true)
        return false
    }

    // Seeded networks bring their own input count, which has to match what getInput() returns
    // (the trainer takes inputs from the seed header plus NewInputs, not from config.Inputs)
    let seededInputs = newAI.getGlobalInfo().inputs
    if (seededInputs != newConfig.Inputs) {
        toast(`Couldn't start training: the seeds (plus new inputs) have ${seededInputs} inputs but the selected input signals give ${newConfig.Inputs}`, true)
        return false
    }

    // From here on the new run replaces the old one: remove the old games' canvases and the sidebar log
    GAMES.forEach(g => g.destroy())
    simEl.innerHTML = ""
    genListEl.innerHTML = ""

    config = newConfig
    AI = newAI
    // A mode picked during the old run would otherwise wait for a generation that never comes
    mode = modeRequested
    chase = chaseRequested
    updateModeNote()

    // One Game per simulation, each with its own canvas. id i tells the trainer which network to play
    GAMES = []
    for (let i = 0; i < config.SimNum; i++) {
        const g = Game(TICKS_PER_SECOND, AI, i, gameOptions(config))
        g.init(simEl)
        g.setMode(currentMode())
        g.startNewGame()
        GAMES.push(g)
    }
    // GAMES[0].recordGeneration()

    // Reset the run state. setPaused(false) only does something if the old run was paused
    finished = false
    pauseBtn.disabled = false
    setPaused(false)
    bestAvg = 0
    genStartTime = speedStartTime = lastClock = performance.now()
    genTicks = genHeadlessTicks = speedTicks = pendingTicks = 0

    // The clock keeps running between runs, it's only stopped when a run finishes (completeGeneration)
    if (!clock) startClock()
    if (headless) scheduleHeadless()
    scheduleVisualization()
    return true
}

// The networks to save, in the seed file format: a header with the population's node counts
// (innovations.inputs.hidden.outputs.) and each network's genes, plus each network's fitness.
// Saves the last FINISHED generation (AI.getLastGeneration()), sorted best fitness first, so net_0 is the best
// network and seeding with SeedNumber = N loads the top N. The population being played right now hasn't been
// scored yet. During generation 0 nothing has finished, so it falls back to the current, unscored population
// (fitnesses and generation are null then).
// Returns { header, genomes: [[gene, ...], ...], fitnesses: [number, ...] | null, generation: number | null }.
// The counts are shared by the whole population (the trainer's global info), so one header covers every network
function snapshotNetworks() {
    let gI = AI.getGlobalInfo()
    let header = `${gI.innovations}.${gI.inputs}.${gI.hidden}.${gI.outputs}.`
    let last = AI.getLastGeneration()
    if (!last) {
        return { header, genomes: AI.getPopulation().map(n => [...n.getGenome()]), fitnesses: null, generation: null }
    }
    let ranked = last.species.flatMap(s => s.networks).sort((a, b) => b.fitness - a.fitness)
    return {
        header,
        genomes: ranked.map(n => [...n.network.getGenome()]),
        fitnesses: ranked.map(n => n.fitness),
        generation: last.generation,
    }
}

// Writes the networks to ai/seeds through the server (see entry.js), replacing the ones there.
// Returns the number saved
//   snapshot - from snapshotNetworks()
// Throws an Error with a message fit for a toast if the server can't be reached or refuses.
// Used by saveGeneration() (end of training) and the save button.
async function saveNetworks(snapshot) {
    let res
    try {
        res = await fetch("/api/seeds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ header: snapshot.header, genomes: snapshot.genomes, fitnesses: snapshot.fitnesses }),
        })
    } catch (e) {
        throw new Error("Couldn't reach the server")
    }
    let data = await res.json().catch(() => null)
    if (res.status == 404) {
        // Server started before saving was added
        throw new Error("The server can't save networks yet, restart it with: deno task start")
    }
    if (!res.ok || !data) {
        throw new Error(data?.error ?? `Server error ${res.status}`)
    }
    return data.saved
}

// Number of networks saved in ai/seeds, null if the server can't tell
// (e.g. an old server without the /api/seeds route). Shown in the config editor and the save confirmation.
async function getSeedCount() {
    try {
        let res = await fetch("/api/seeds")
        return res.ok ? (await res.json()).count : null
    } catch (e) {
        return null
    }
}

// Saves the population automatically when training completes, called by completeGeneration().
// This runs after advanceGeneration(), so the last finished generation is the final one played, and
// snapshotNetworks() saves those scored networks best first (not the unplayed children bred from them)
function saveGeneration() {
    saveNetworks(snapshotNetworks())
        .then(saved => toast(`Training complete, saved ${saved} networks to ai/seeds`))
        .catch(e => toast(`Training complete, but saving failed: ${e.message}`, true))
}

// Advance every simulation one tick, returns true if that finished the generation
// The single place the simulation moves forward, called by onClock() (rendering) and runHeadlessBatch()
// (headless). Each Game's step() asks the trainer for moves and, when its game ends, reports the score and
// picks up its next network.
function stepAll() {
    for (let i = 0; i < GAMES.length; i++) {
        GAMES[i].step()
    }
    genTicks += 1
    speedTicks += 1
    if (headless) genHeadlessTicks += 1

    // isGenerationOver() only means every network has been handed out; games still playing the last
    // networks have to finish too, so also wait until every Game has gone idle
    if (AI.isGenerationOver() && GAMES.every(g => g.isIdle())) {
        completeGeneration()
        return true
    }
    return false
}

// Ends the current generation: logs it, has the trainer breed the next one, and restarts every Game.
// After the last generation it stops the clock and saves the networks instead.
// Called by stepAll() once every network has played its games.
function completeGeneration() {
    // getPopulation() returns a copy, so sorting it doesn't reorder the trainer's population
    let sorted = AI.getPopulation().sort((a,b) => b.getScore() - a.getScore())

    // Get avg score for gen
    let sum = sorted.reduce((curr, val) => curr + val.getScore(), 0)
    let avg = sum / sorted.length
    let gen = AI.getCurrentGeneration()
    let seconds = (performance.now() - genStartTime) / 1000
    // Tag generations that ran (partly) headless, their times aren't comparable with rendered ones
    let runTag = genHeadlessTicks == genTicks ? " · headless" : genHeadlessTicks > 0 ? " · part headless" : ""
    logGeneration(gen, avg, sorted[0], seconds, runTag)

    // Generation summary
    console.log(`-- Generation ${gen} Reproducers --`)
    console.log({
        species: AI.getSpecies(),
        networks: sorted.map(nn => {
        return {
            id: nn.getId(),
            score: nn.getScore(),
            genome: nn.getGenome(),
            matrices: nn.getMatrices()
        }
    })})

    // Speciate, cull and breed the next population (see ai/aiTrainer.js), then restart the timings
    AI.advanceGeneration()
    genStartTime = performance.now()
    genTicks = 0
    genHeadlessTicks = 0
    speedStartTime = genStartTime
    speedTicks = 0
    scheduleVisualization()

    // Training is done: stop stepping for good and save. The clock is restarted by startTraining() if the
    // config editor starts a new run
    if (AI.getCurrentGeneration() >= AI.getMaxGeneration()) {
        finished = true
        pauseBtn.disabled = true
        clock.terminate()
        clock = null
        saveGeneration()
        return
    }

    // Apply a requested mode change, every network in a generation plays the same mode
    mode = modeRequested
    chase = chaseRequested
    updateModeNote()

    for (let i = 0; i < GAMES.length; i++) {
        // GAMES[i].setMapI(3)
        GAMES[i].setMode(currentMode())
        GAMES[i].startNewGame()
    }

    // Record one generation
    // Game 0 records its canvas through the last generation and downloads the video when it goes idle
    // (see recordGeneration in game.js). Skipped when headless, nothing is drawn then
    if (!headless && AI.getCurrentGeneration() == (AI.getMaxGeneration() - 1)) {
        GAMES[0].recordGeneration()
    }
}

// Post the generation's scores to the sidebar, newest first
//   gen     - the trainer's generation number (0-based)
//   avg     - the population's average fitness
//   top     - the best network, its score and id are shown
//   seconds - how long the generation took, paused time excluded
//   runTag  - " · headless" / " · part headless" / "" from completeGeneration()
// The bar under each entry is the average relative to the best average so far.
// NOTE: the entry says "Gen ${gen}" with the 0-based number, while the status line shows gen + 1,
// so the first generation is "Generation 1" in the status and "Gen 0" in the sidebar
function logGeneration(gen, avg, top, seconds, runTag) {
    bestAvg = Math.max(bestAvg, avg)

    let entry = document.createElement("li")
    entry.className = "gen-entry"
    entry.innerHTML = `
        <div class="gen-entry-head">
            <span class="gen-number">Gen ${gen}</span>
            <span class="gen-time">${seconds.toFixed(1)}s${runTag}</span>
        </div>
        <div class="gen-mode gen-mode-${mode}">${MODES[mode].label}${chase && MODES[mode].ghosts ? " · chasing" : ""}</div>
        <div class="gen-stats">
            <span>Avg <b>${avg.toFixed(1)}</b></span>
            <span>Top <b>${top?.getScore() ?? 0}</b></span>
        </div>
        <div class="gen-bar"><div style="width: ${bestAvg > 0 ? (avg / bestAvg) * 100 : 0}%"></div></div>`
    entry.title = `Top network: ${top?.getId()}`
    genListEl.prepend(entry)
}

// ---- Scheduling ------------------------------------------------------------
// Timers on the page are throttled in background tabs, timers inside a worker are not.
// The worker acts as a clock that paces the simulation while rendering.
// It only says "time has passed", onClock() measures how much and runs that many ticks, so the speed
// is TICKS_PER_SECOND * playbackSpeed ticks/s no matter how often the worker actually fires.
let clock = null // The clock Worker, null when not running

// Creates the clock: a Worker built from an inline script (a Blob URL, so no separate file is needed)
// that posts a message every 4ms. Called by startTraining() when there's no clock.
function startClock() {
    clock = new Worker(URL.createObjectURL(new Blob(
        ["setInterval(() => postMessage(0), 4)"], { type: "text/javascript" })))
    clock.onmessage = onClock
}

// Runs on every clock message. Turns the time since the last message into ticks owed (TICKS_PER_SECOND *
// playbackSpeed per second) and runs the whole ones, keeping the fraction for next time.
// While headless, paused or finished it only moves lastClock forward, so no backlog builds up
function onClock() {
    let now = performance.now()
    if (headless || paused || finished) {
        lastClock = now
        return
    }

    let ticksPerSecond = TICKS_PER_SECOND * playbackSpeed
    pendingTicks += ((now - lastClock) / 1000) * ticksPerSecond
    lastClock = now

    // Don't try to catch up on more than a quarter second of backlog
    // (e.g. after the machine slept), otherwise the page would freeze running ticks to catch up
    pendingTicks = Math.min(pendingTicks, ticksPerSecond / 4)
    // The flags are rechecked because stepAll() can finish the run partway through
    while (pendingTicks >= 1 && !headless && !paused && !finished) {
        pendingTicks -= 1
        stepAll()
    }
}

// Headless mode runs batches back to back, yielding between them through a
// MessageChannel (which isn't throttled either) so the page stays responsive
// (setTimeout(0) would be clamped to 4ms or more, and to 1s in background tabs)
const headlessChannel = new MessageChannel()
headlessChannel.port1.onmessage = runHeadlessBatch
let headlessScheduled = false // Only one batch is ever queued, so there's only one loop

// Queues a headless batch unless one already is. Called when headless is turned on, on resume,
// on a (re)start, and by each batch to queue the next
function scheduleHeadless() {
    if (!headlessScheduled) {
        headlessScheduled = true
        headlessChannel.port2.postMessage(0)
    }
}

// Steps as fast as possible for HEADLESS_BATCH_MS, then yields to the page and queues the next batch.
// The loop simply stops when headless is turned off, the run is paused or training finishes;
// whatever turns it back on calls scheduleHeadless() again
function runHeadlessBatch() {
    headlessScheduled = false
    let end = performance.now() + HEADLESS_BATCH_MS
    while (headless && !paused && !finished && performance.now() < end) {
        stepAll()
    }
    if (headless && !paused && !finished) {
        scheduleHeadless()
    }
}

// Turns headless mode on or off (the headless button). The body class hides the canvases and shows the
// progress bars (see index.html). The ticks/s measurement restarts, it means something different in each mode
function setHeadless(value) {
    if (value === headless) return

    headless = value
    document.body.classList.toggle("headless", headless)
    headlessBtn.setAttribute("aria-pressed", headless)
    headlessBtn.classList.toggle("on", headless)
    headlessBtn.querySelector(".toggle-label").textContent = `Headless ${headless ? "on" : "off"}`
    speedStartTime = performance.now()
    speedTicks = 0

    if (headless) {
        if (!paused) scheduleHeadless()
    } else {
        // Back to the clock: start counting from now, otherwise the time spent headless would be owed as ticks
        lastClock = performance.now()
        pendingTicks = 0
    }
}

// Pauses or resumes the run (pause button and the P key). Does nothing once training has finished.
// Pausing just sets the flag: onClock() and runHeadlessBatch() check it and stop stepping
function setPaused(value) {
    if (value === paused || finished) return

    paused = value
    pauseBtn.setAttribute("aria-pressed", paused)
    pauseBtn.classList.toggle("on", paused)
    pauseBtn.querySelector(".btn-label").textContent = paused ? "Resume" : "Pause"

    if (paused) {
        pausedAt = performance.now()
    } else {
        // Leave the paused time out of the generation time and ticks/s
        // Shifting the start times forward by the pause length is the same as the pause never happening
        let pausedFor = performance.now() - pausedAt
        genStartTime += pausedFor
        speedStartTime += pausedFor
        lastClock = performance.now()
        pendingTicks = 0
        if (headless) scheduleHeadless()
    }
}

headlessBtn.addEventListener("click", () => setHeadless(!headless))

// Playback speed, takes effect on the next clock message. Doesn't restart anything or change training
speedSelect.value = String(playbackSpeed) // Browsers can restore a stale selection on reload
speedSelect.addEventListener("change", () => playbackSpeed = Number(speedSelect.value))

// Shows which mode is waiting to start, mode changes only apply at the start of a generation
function updateModeNote() {
    let changes = []
    if (modeRequested !== mode) changes.push(`${MODES[modeRequested].label} starts next generation`)
    if (chaseRequested !== chase) changes.push(`Chasing ghosts ${chaseRequested ? "on" : "off"} next generation`)
    modeNote.textContent = changes.join(" · ")
}

// The mode every game plays this generation: the training mode plus whether ghosts chase
function currentMode() {
    return { ...MODES[mode], chase }
}

// Chasing ghosts checkbox. Like the mode it takes effect at the next generation, so every network
// in a generation is scored against the same kind of ghosts
chaseToggle.checked = chaseRequested // Browsers can restore a stale checkbox on reload
chaseToggle.addEventListener("change", () => {
    chaseRequested = chaseToggle.checked
    updateModeNote()
})

// Browsers can restore a stale radio selection on reload
modeInputs.forEach(input => input.checked = input.value === modeRequested)
// Picking a mode only requests it, completeGeneration() switches at the start of the next generation
modeInputs.forEach(input => input.addEventListener("change", () => {
    modeRequested = input.value
    updateModeNote()
}))
pauseBtn.addEventListener("click", () => setPaused(!paused))

// Config button: open the editor with the running config and restart training with the result.
// The run keeps going while the editor is open; it's only replaced if the edit is saved and confirmed
// and startTraining() accepts it
configBtn.addEventListener("click", async () => {
    // The trainer doesn't know about the game options, so add them for the editor
    let { InputSignals, GhostCount, MapIndex, DecideOnTileCenter, StarveSeconds } = config
    let edited = await editConfig({ ...AI.getConfig(), InputSignals: { ...InputSignals }, GhostCount, MapIndex, DecideOnTileCenter, StarveSeconds }, await getSeedCount())
    // Keep options the editor doesn't show (e.g. Outputs, activation functions)
    if (edited && startTraining({ ...config, ...edited })) {
        toast("Training restarted with the new config")
    }
})

// Save button: save the current population to ai/seeds after a confirmation, at any point in the run
saveBtn.addEventListener("click", async () => {
    // Snapshot first, the generation could finish while the dialog is open
    let snapshot = snapshotNetworks()
    let which = snapshot.generation == null
        ? "generation 1 (nothing has finished yet, so they're unscored and unsorted)"
        : `Gen ${snapshot.generation}, the last finished generation, best first (top fitness ${snapshot.fitnesses[0]})`
    let count = await getSeedCount()
    let message = `Save the ${snapshot.genomes.length} networks of ${which} to ai/seeds?` +
        (count ? ` This replaces the ${count} networks saved there.` : "")
    if (!await confirmDialog("Save networks", message, "Save")) return

    try {
        toast(`Saved ${await saveNetworks(snapshot)} networks to ai/seeds`)
    } catch (e) {
        toast(`Saving failed: ${e.message}`, true)
    }
})

// P toggles the pause button
// Ignored while typing in a field or while a dialog is open
document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select, dialog") || document.querySelector("dialog[open]")) return
    if (e.key.toLowerCase() === "p" && !e.repeat && !e.metaKey && !e.ctrlKey) {
        pauseBtn.click()
    }
})

// Ask before leaving the page while training is still running
// (the run lives only in this page, reloading loses it; only finished runs are saved automatically)
window.addEventListener("beforeunload", (e) => {
    if (!finished) {
        e.preventDefault()
        e.returnValue = ""
    }
})

// ---- Rendering -------------------------------------------------------------
// Only paints, never advances the simulation. Pauses by itself in background tabs.
// Runs every animation frame for the life of the page: updates the status line, then either the
// headless progress bars and ticks/s, or every Game's canvas
function frame() {
    let gen = AI.getCurrentGeneration(), maxGen = AI.getMaxGeneration()
    let done = AI.getCompletedCount(), pop = AI.getPopulationSize()

    statusEl.textContent = finished
        ? `Training complete · ${maxGen} generations`
        : `${paused ? "Paused · " : ""}Generation ${gen + 1} / ${maxGen} · ${done} / ${pop} networks · top score ${AI.getTopScore()}`

    if (headless) {
        // While paused, measure up to the pause so ticks/s doesn't sink
        let seconds = ((paused ? pausedAt : performance.now()) - speedStartTime) / 1000
        runBar.style.width = `${finished ? 100 : (done / pop) * 100}%`
        runLabel.textContent = finished ? "Done" : `${done} / ${pop} networks`
        genBar.style.width = `${(Math.min(gen, maxGen) / maxGen) * 100}%`
        genLabel.textContent = `${Math.min(gen, maxGen)} / ${maxGen} generations`
        speedLabel.textContent = !finished && seconds > 0 ? `${Math.round(speedTicks / seconds).toLocaleString()} ticks/s` : ""
    } else {
        for (let i = 0; i < GAMES.length; i++) {
            GAMES[i].draw(paused)
        }
    }

    requestAnimationFrame(frame)
}

// Redraw the network diagrams. Deferred to an animation frame so skipped generations (e.g. headless in a
// background tab) cost nothing. Called after every generation and on a (re)start. Cancelling the pending frame
// means only the latest generation is ever drawn, however many generations finish before the next frame.
//
// Shows the generation that just finished, split into the species the trainer grouped it into when breeding
// (AI.getLastGeneration()), because that's the one with fitness and species. The networks being played right
// now haven't been scored or speciated yet. Each species is a row with its own horizontal scroll, species ordered
// best average first and networks best first. During generation 0 there's no finished generation, so the current
// population is shown in a single row instead. Diagrams are drawn with ai/networkVisualizer.js
let visFrame = null
function scheduleVisualization() {
    cancelAnimationFrame(visFrame)
    visFrame = requestAnimationFrame(() => {
        let last = AI.getLastGeneration()
        let globalInfo = AI.getGlobalInfo()
        let round = (v) => (Math.round(v * 10) / 10).toLocaleString()

        // One row: a header line, then a horizontal strip of network cards
        let addGroup = (title, stats, networks) => {
            let group = document.createElement("div")
            group.className = "species-group"
            group.innerHTML = `<div class="species-head"><span class="species-name"></span><span class="species-stats"></span></div>`
            group.querySelector(".species-name").textContent = title
            group.querySelector(".species-stats").textContent = stats
            let strip = document.createElement("div")
            strip.className = "strip"
            group.append(strip)
            visEl.append(group)

            networks.forEach(({ network, fitness, elite }) => {
                let visualizer = NetworkVisualizer(network.getGenome(), globalInfo, network.getId())
                visualizer.init()
                visualizer.visualize(strip, 337, 267, { fitness, elite })
            })
        }

        visEl.innerHTML = ""
        let summary = document.createElement("div")
        summary.className = "vis-summary"
        visEl.append(summary)

        if (!last) {
            summary.textContent = "Generation 1 is playing. Networks are split into species once it finishes"
            addGroup("Generation 1", `${AI.getPopulationSize()} networks, not scored yet`,
                AI.getPopulation().map(network => ({ network })))
            return
        }

        summary.textContent = `Gen ${last.generation}, the generation that bred the one playing now · ` +
            `${last.species.length} species, best average first`
        last.species.forEach((sp, i) => {
            let elite = sp.networks.some(n => n.elite)
            addGroup(`Species ${i + 1}`,
                `${sp.networks.length} network${sp.networks.length == 1 ? "" : "s"} · avg ${round(sp.average)} · ` +
                `best ${round(sp.best)} · next gen ${sp.children} children${elite ? " + elite" : ""}`,
                sp.networks)
        })
    })
}

startTraining(config)
requestAnimationFrame(frame)

// Kills pacman in every game.
// NOTE: killPlayers is unused (not exported, never called), possibly kept for debugging from the console
// (though as a module-scoped const it isn't reachable from there)
const killPlayers = () => {
    for (let i = 0; i < GAMES.length; i++) {
        GAMES[i].killPlayer()
    }
}
