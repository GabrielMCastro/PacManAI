import { Game, MODES } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"
import { NetworkVisualizer } from "/ai/networkVisualizer.js"
import { confirmDialog, editConfig, toast } from "./dialogs.js"

export const m = "m"
const simEl = document.getElementById("sim_container")
const genListEl = document.getElementById("generation_list")
const visEl = document.getElementById("visbody")
const headlessBtn = document.getElementById("headless_toggle")
const pauseBtn = document.getElementById("pause_toggle")
const modeInputs = document.querySelectorAll("input[name=mode]")
const modeNote = document.getElementById("mode_note")
const configBtn = document.getElementById("config_button")
const saveBtn = document.getElementById("save_button")
const statusEl = document.getElementById("status")
const genBar = document.getElementById("gen_progress")
const genLabel = document.getElementById("gen_progress_label")
const runBar = document.getElementById("run_progress")
const runLabel = document.getElementById("run_progress_label")
const speedLabel = document.getElementById("speed_label")

let FRAMERATE = 150,         // Simulation ticks per second when rendering
    HEADLESS_BATCH_MS = 50,  // How long a headless batch runs before yielding to the page
    GAMES = new Array();

// What each option does is documented at the top of ai/aiTrainer.js
let config = {
    SimNum: 10,
    PopulationSize: 200,
    MaxGens: 40,
    WeightMutationR: .05,
    // SeedNumber: 200,
    // StructureMutationR: .8,
    DynamicSplitFactor: .8,
    // StructureMutationSplit: 0,
    // NewInputs: 5,
    // ProtectStructure: true,
    Inputs: 6, //17
    Outputs: 4,
    ReproductionPercentile: .8,
    Compatibility: {
        c1: 1,
        c2: 1,
        c3: .2,
        threshold: 1.8
    },
    FullyConnected: false,
}
let AI = null

export const getTrainer = () => AI

let headless = false,
    mode = "pellets",          // Training mode of the current generation
    modeRequested = "pellets", // Training mode to switch to at the start of the next generation
    paused = false,
    pausedAt = 0,
    finished = false,
    lastClock = performance.now(),
    pendingTicks = 0,
    genStartTime = performance.now(),
    genTicks = 0,
    genHeadlessTicks = 0,              // Ticks of this generation that ran headless
    speedStartTime = performance.now(), // Start of the current ticks/s measurement
    speedTicks = 0,
    bestAvg = 0

// (Re)start training from the first generation. Returns false and leaves the current run
// alone if the trainer can't be created (e.g. seed files missing)
function startTraining(newConfig) {
    let newAI
    try {
        newAI = AITrainer(newConfig)
    } catch (e) {
        console.error(e)
        toast(`Couldn't start training: ${e.message}`, true)
        return false
    }

    GAMES.forEach(g => g.destroy())
    simEl.innerHTML = ""
    genListEl.innerHTML = ""

    config = newConfig
    AI = newAI
    mode = modeRequested
    updateModeNote()

    GAMES = []
    for (let i = 0; i < config.SimNum; i++) {
        const g = Game(FRAMERATE, AI, i)
        g.init(simEl)
        g.setMode(MODES[mode])
        g.startNewGame()
        GAMES.push(g)
    }
    // GAMES[0].recordGeneration()

    finished = false
    pauseBtn.disabled = false
    setPaused(false)
    bestAvg = 0
    genStartTime = speedStartTime = lastClock = performance.now()
    genTicks = genHeadlessTicks = speedTicks = pendingTicks = 0

    if (!clock) startClock()
    if (headless) scheduleHeadless()
    scheduleVisualization()
    return true
}

// The current generation's networks in the seed file format: a header with the population's
// node counts (innovations.inputs.hidden.outputs.) and each network's genes
function snapshotNetworks() {
    let gI = AI.getGlobalInfo()
    return {
        header: `${gI.innovations}.${gI.inputs}.${gI.hidden}.${gI.outputs}.`,
        genomes: AI.getPopulation().map(n => [...n.getGenome()]),
    }
}

// Writes the networks to ai/seeds through the server (see entry.js), replacing the ones there.
// Returns the number saved
async function saveNetworks(snapshot) {
    let res
    try {
        res = await fetch("/api/seeds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(snapshot),
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
async function getSeedCount() {
    try {
        let res = await fetch("/api/seeds")
        return res.ok ? (await res.json()).count : null
    } catch (e) {
        return null
    }
}

function saveGeneration() {
    saveNetworks(snapshotNetworks())
        .then(saved => toast(`Training complete, saved ${saved} networks to ai/seeds`))
        .catch(e => toast(`Training complete, but saving failed: ${e.message}`, true))
}

// Advance every simulation one tick, returns true if that finished the generation
function stepAll() {
    for (let i = 0; i < GAMES.length; i++) {
        GAMES[i].step()
    }
    genTicks += 1
    speedTicks += 1
    if (headless) genHeadlessTicks += 1

    if (AI.isGenerationOver() && GAMES.every(g => g.isIdle())) {
        completeGeneration()
        return true
    }
    return false
}

function completeGeneration() {
    let sorted = AI.getPopulation().sort((a,b) => b.getScore() - a.getScore())

    // Get avg score for gen
    let sum = sorted.reduce((curr, val) => curr + val.getScore(), 0)
    let avg = sum / sorted.length
    let gen = AI.getCurrentGeneration()
    let seconds = (performance.now() - genStartTime) / 1000
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

    AI.advanceGeneration()
    genStartTime = performance.now()
    genTicks = 0
    genHeadlessTicks = 0
    speedStartTime = genStartTime
    speedTicks = 0
    scheduleVisualization()

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
    updateModeNote()

    for (let i = 0; i < GAMES.length; i++) {
        // GAMES[i].setMapI(3)
        GAMES[i].setMode(MODES[mode])
        GAMES[i].startNewGame()
    }

    // Record one generation
    if (!headless && AI.getCurrentGeneration() == (AI.getMaxGeneration() - 1)) {
        GAMES[0].recordGeneration()
    }
}

// Post the generation's scores to the sidebar, newest first
function logGeneration(gen, avg, top, seconds, runTag) {
    bestAvg = Math.max(bestAvg, avg)

    let entry = document.createElement("li")
    entry.className = "gen-entry"
    entry.innerHTML = `
        <div class="gen-entry-head">
            <span class="gen-number">Gen ${gen}</span>
            <span class="gen-time">${seconds.toFixed(1)}s${runTag}</span>
        </div>
        <div class="gen-mode gen-mode-${mode}">${MODES[mode].label}</div>
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
let clock = null

function startClock() {
    clock = new Worker(URL.createObjectURL(new Blob(
        ["setInterval(() => postMessage(0), 4)"], { type: "text/javascript" })))
    clock.onmessage = onClock
}

function onClock() {
    let now = performance.now()
    if (headless || paused || finished) {
        lastClock = now
        return
    }

    pendingTicks += ((now - lastClock) / 1000) * FRAMERATE
    lastClock = now

    // Don't try to catch up on more than a quarter second of backlog
    pendingTicks = Math.min(pendingTicks, FRAMERATE / 4)
    while (pendingTicks >= 1 && !headless && !paused && !finished) {
        pendingTicks -= 1
        stepAll()
    }
}

// Headless mode runs batches back to back, yielding between them through a
// MessageChannel (which isn't throttled either) so the page stays responsive
const headlessChannel = new MessageChannel()
headlessChannel.port1.onmessage = runHeadlessBatch
let headlessScheduled = false // Only one batch is ever queued, so there's only one loop

function scheduleHeadless() {
    if (!headlessScheduled) {
        headlessScheduled = true
        headlessChannel.port2.postMessage(0)
    }
}

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
        lastClock = performance.now()
        pendingTicks = 0
    }
}

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
        let pausedFor = performance.now() - pausedAt
        genStartTime += pausedFor
        speedStartTime += pausedFor
        lastClock = performance.now()
        pendingTicks = 0
        if (headless) scheduleHeadless()
    }
}

headlessBtn.addEventListener("click", () => setHeadless(!headless))

function updateModeNote() {
    modeNote.textContent = modeRequested === mode ? "" : `${MODES[modeRequested].label} starts next generation`
}

// Browsers can restore a stale radio selection on reload
modeInputs.forEach(input => input.checked = input.value === modeRequested)
modeInputs.forEach(input => input.addEventListener("change", () => {
    modeRequested = input.value
    updateModeNote()
}))
pauseBtn.addEventListener("click", () => setPaused(!paused))

configBtn.addEventListener("click", async () => {
    let edited = await editConfig(AI.getConfig(), await getSeedCount())
    // Keep options the editor doesn't show (e.g. Outputs, activation functions)
    if (edited && startTraining({ ...config, ...edited })) {
        toast("Training restarted with the new config")
    }
})

saveBtn.addEventListener("click", async () => {
    // Snapshot first, the generation could finish while the dialog is open
    let snapshot = snapshotNetworks()
    let which = finished ? "the final population" : `generation ${AI.getCurrentGeneration() + 1}`
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
document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select, dialog") || document.querySelector("dialog[open]")) return
    if (e.key.toLowerCase() === "p" && !e.repeat && !e.metaKey && !e.ctrlKey) {
        pauseBtn.click()
    }
})

// Ask before leaving the page while training is still running
window.addEventListener("beforeunload", (e) => {
    if (!finished) {
        e.preventDefault()
        e.returnValue = ""
    }
})

// ---- Rendering -------------------------------------------------------------
// Only paints, never advances the simulation. Pauses by itself in background tabs.
function frame() {
    let gen = AI.getCurrentGeneration(), maxGen = AI.getMaxGeneration()
    let done = AI.getCompletedCount(), pop = AI.getPopulationSize()

    statusEl.textContent = finished
        ? `Training complete · ${maxGen} generations`
        : `${paused ? "Paused · " : ""}Generation ${gen + 1} / ${maxGen} · ${done} / ${pop} networks · top score ${AI.getTopScore()}`

    if (headless) {
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

// Redraw the network visualizations for the current population. Deferred to an
// animation frame so skipped generations (e.g. headless in a background tab) cost nothing.
let visFrame = null
function scheduleVisualization() {
    cancelAnimationFrame(visFrame)
    visFrame = requestAnimationFrame(() => {
        let pop = AI.getPopulation()
        let globalInfo = AI.getGlobalInfo()

        visEl.innerHTML = ""
        for (let i = 0; i < pop.length; i++) {
            let visualizer = NetworkVisualizer(pop[i].getGenome(), globalInfo, pop[i].getId())

            visualizer.init()
            visualizer.visualize(visEl, 337, 267)
        }
    })
}

startTraining(config)
requestAnimationFrame(frame)

const killPlayers = () => {
    for (let i = 0; i < GAMES.length; i++) {
        GAMES[i].killPlayer()
    }
}
