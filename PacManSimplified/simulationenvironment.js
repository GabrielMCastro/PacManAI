import { Game } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"
import { NetworkVisualizer } from "/ai/networkVisualizer.js"

export const m = "m"
const simEl = document.getElementById("sim_container")
const genListEl = document.getElementById("generation_list")
const visEl = document.getElementById("visbody")
const headlessBtn = document.getElementById("headless_toggle")
const statusEl = document.getElementById("status")
const genBar = document.getElementById("gen_progress")
const genLabel = document.getElementById("gen_progress_label")
const runBar = document.getElementById("run_progress")
const runLabel = document.getElementById("run_progress_label")
const speedLabel = document.getElementById("speed_label")

let FRAMERATE = 150,         // Simulation ticks per second when rendering
    HEADLESS_BATCH_MS = 50,  // How long a headless batch runs before yielding to the page
    GAMES = new Array();

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
const AI = AITrainer(config)

export const getTrainer = () => AI

for (let i = 0; i < config.SimNum; i++) {
    const g = Game(FRAMERATE, AI, i)
 
    GAMES.push(g)
}

for (let i = 0; i < GAMES.length; i++) {
    GAMES[i].init(simEl)
}

// GAMES[0].recordGeneration()

let headless = false,
    finished = false,
    lastClock = performance.now(),
    pendingTicks = 0,
    genStartTime = performance.now(),
    genTicks = 0,
    genHeadlessTicks = 0,              // Ticks of this generation that ran headless
    speedStartTime = performance.now(), // Start of the current ticks/s measurement
    speedTicks = 0,
    bestAvg = 0

function saveGeneration() {
    let gI = AI.getGlobalInfo()
    let gID = `${gI.innovations}.${gI.inputs}.${gI.hidden}.${gI.outputs}.`

    let pop = AI.getPopulation()

    for (let i = 0; i < pop.length; i++) {
        var a = document.createElement("a");
        var content = JSON.stringify([gID, pop[i].getGenome()])
        var file = new Blob([content], {type: "text/plain"});
        a.href = URL.createObjectURL(file);
        a.download = `net_${i}.txt`;
        a.click();
    }
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
    let mode = genHeadlessTicks == genTicks ? " · headless" : genHeadlessTicks > 0 ? " · part headless" : ""
    logGeneration(gen, avg, sorted[0], seconds, mode)

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
        clock.terminate()
        saveGeneration()
        return
    }

    for (let i = 0; i < GAMES.length; i++) {
        // GAMES[i].setMapI(3)
        GAMES[i].startNewGame()
    }

    // Record one generation
    if (!headless && AI.getCurrentGeneration() == (AI.getMaxGeneration() - 1)) {
        GAMES[0].recordGeneration()
    }
}

// Post the generation's scores to the sidebar, newest first
function logGeneration(gen, avg, top, seconds, mode) {
    bestAvg = Math.max(bestAvg, avg)

    let entry = document.createElement("li")
    entry.className = "gen-entry"
    entry.innerHTML = `
        <div class="gen-entry-head">
            <span class="gen-number">Gen ${gen}</span>
            <span class="gen-time">${seconds.toFixed(1)}s${mode}</span>
        </div>
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
const clock = new Worker(URL.createObjectURL(new Blob(
    ["setInterval(() => postMessage(0), 4)"], { type: "text/javascript" })))

clock.onmessage = () => {
    let now = performance.now()
    if (headless || finished) {
        lastClock = now
        return
    }

    pendingTicks += ((now - lastClock) / 1000) * FRAMERATE
    lastClock = now

    // Don't try to catch up on more than a quarter second of backlog
    pendingTicks = Math.min(pendingTicks, FRAMERATE / 4)
    while (pendingTicks >= 1 && !headless && !finished) {
        pendingTicks -= 1
        stepAll()
    }
}

// Headless mode runs batches back to back, yielding between them through a
// MessageChannel (which isn't throttled either) so the page stays responsive
const headlessChannel = new MessageChannel()
headlessChannel.port1.onmessage = runHeadlessBatch

function runHeadlessBatch() {
    let end = performance.now() + HEADLESS_BATCH_MS
    while (headless && !finished && performance.now() < end) {
        stepAll()
    }
    if (headless && !finished) {
        headlessChannel.port2.postMessage(0)
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
        headlessChannel.port2.postMessage(0)
    } else {
        lastClock = performance.now()
        pendingTicks = 0
    }
}

headlessBtn.addEventListener("click", () => setHeadless(!headless))

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
        : `Generation ${gen + 1} / ${maxGen} · ${done} / ${pop} networks · top score ${AI.getTopScore()}`

    if (headless) {
        let seconds = (performance.now() - speedStartTime) / 1000
        runBar.style.width = `${finished ? 100 : (done / pop) * 100}%`
        runLabel.textContent = finished ? "Done" : `${done} / ${pop} networks`
        genBar.style.width = `${(Math.min(gen, maxGen) / maxGen) * 100}%`
        genLabel.textContent = `${Math.min(gen, maxGen)} / ${maxGen} generations`
        speedLabel.textContent = !finished && seconds > 0 ? `${Math.round(speedTicks / seconds).toLocaleString()} ticks/s` : ""
    } else {
        for (let i = 0; i < GAMES.length; i++) {
            GAMES[i].draw()
        }
    }

    requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

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
scheduleVisualization()

const killPlayers = () => {
    for (let i = 0; i < GAMES.length; i++) {
        GAMES[i].killPlayer()
    }
}
