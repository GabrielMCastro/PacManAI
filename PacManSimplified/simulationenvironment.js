import { Game } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"

export const m = "m"
let el = document.getElementById("sim_container")
let con_bar = document.getElementById("control_bar")

let FRAMERATE = 300,
    GAMES = new Array(),
    averageScores = new Array();

let config = {
    SimNum: 4,
    PopulationSize: 20,
    MaxGens: 4,
    WeightMutationR: .1,
    StructureMutationR: .7,
    StructureMutationSplit: .7,
    Inputs: 15,
    Outputs: 4,
    ReproductionPercentile: .75,
    Compatibility: {
        c1: 1,
        c2: 1,
        c3: 1,
        threshold: 1
    }
}
const AI = AITrainer(config)

for (let i = 0; i < config.SimNum; i++) {
    const g = Game(FRAMERATE, true, AI, i)
 
    GAMES.push(g)
}

for (let i = 0; i < GAMES.length; i++) {
    GAMES[i].init(el)
}

function saveGeneration() {
    let gI = AI.getGlobalInfo()
    let gID = `${gI.innovations}.${gI.inputs}.${gI.hidden}.${gI.outputs}.`

    let pop = AI.getPopulation()

    for (let i = 0; i < pop.length; i++) {
        var a = document.createElement("a");
        var content = JSON.stringify([gID, pop[i].getGenome()])
        var file = new Blob([content], {type: "text/plain"});
        a.href = URL.createObjectURL(file);
        a.download = `${pop[i].getId()}.txt`;
        a.click();
    }
}

let checkSims = () => {
    if (AI.getCurrentGeneration() >= AI.getMaxGeneration()) {
        saveGeneration()
        clearInterval(checkSimInterval)
        clearInterval(killPlayersInterval)
    } else {
        if (AI.isGenerationOver()) {
            let sorted = AI.getPopulation().sort((a,b) => a.getScore() - b.getScore())

            // Get avg score for gen
            let sum = sorted.reduce((curr, val) => curr + val.getScore(), 0)
            let avg = sum / sorted.length
            averageScores.push(avg)
            
            // Post average score of gen to sidebar
            let pav = document.createElement('p')
            pav.innerHTML = `* Generation ${AI.getCurrentGeneration()} Avg: ${avg}`
            pav.onclick = (e) => {
                console.log(`-- Generation ${AI.getCurrentGeneration()} Reproducers --`)
                console.log(sorted.map(nn => {
                    return {
                        id: nn.getId(),
                        score: nn.getScore(),
                        genome: nn.getGenome(),
                    }
                }))
            }
            con_bar.appendChild(pav)

            AI.advanceGeneration()

            let gen = AI.getCurrentGeneration()
            clearInterval(killPlayersInterval)
            for (let i = 0; i < GAMES.length; i++) {
                if (gen < (config.MaxGens * .33)) {
                    GAMES[i].setMapI(0)
                } else if (gen < (config.MaxGens * .66)) {
                    GAMES[i].setMapI(1)
                } else {
                    GAMES[i].setMapI(2)
                }
                GAMES[i].startNewGame()
            }
            killPlayersInterval = window.setInterval(killPlayers, 15000)

            // Record one generation
            if (AI.getCurrentGeneration() == (AI.getMaxGeneration() - 1)) {
                GAMES[0].recordGeneration()
            }
        }
    }
}

const killPlayers = () => {
    for (let i = 0; i < GAMES.length; i++) {
        GAMES[i].killPlayer()
    }
}

let checkSimInterval = window.setInterval(checkSims, 60000)
let killPlayersInterval = window.setInterval(killPlayers, 15000)