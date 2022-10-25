import { Game } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"

export const m = "m"
let el = document.getElementById("sim_container")
let con_bar = document.getElementById("control_bar")

let FRAMERATE = 100,
    GAMES = new Array();
    // averageScores = new Array(),
    // generationSummaries = new Array();

let config = {
    SimNum: 10,
    PopulationSize: 100,
    MaxGens: 18,
    SeedNumber: 100,
    WeightMutationR: .1,
    StructureMutationR: .8,
    Inputs: 4,
    Outputs: 4,
    ReproductionPercentile: .80,
    Compatibility: {
        c1: 1,
        c2: 1,
        c3: 1,
        threshold: 2
    },
    FullyConnected: false,
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

    for (let i = 0; i < 100; i++) {
        var a = document.createElement("a");
        var content = JSON.stringify([gID, pop[i].getGenome()])
        var file = new Blob([content], {type: "text/plain"});
        a.href = URL.createObjectURL(file);
        a.download = `net_${i}.txt`;
        a.click();
    }
}

let checkSims = () => {
    if (AI.getCurrentGeneration() >= AI.getMaxGeneration()) {
        saveGeneration()
        clearInterval(checkSimInterval)
        // clearInterval(killPlayersInterval)
    } else {
        if (AI.isGenerationOver()) {
            let sorted = AI.getPopulation().sort((a,b) => a.getScore() - b.getScore())

            // Get avg score for gen
            let sum = sorted.reduce((curr, val) => curr + val.getScore(), 0)
            let avg = sum / sorted.length
            // averageScores.push(avg)
            
            // Post average score of gen to sidebar
            let pav = document.createElement('p')
            let gen = AI.getCurrentGeneration()
            pav.innerHTML = `* Generation ${gen} Avg: ${avg}`
            // pav.onclick = (e) => {
            //     console.log(`-- Generation ${gen} Reproducers --`)
            //     console.log(generationSummaries[gen])
            // }
            con_bar.appendChild(pav)

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
            
            // TESTING
            // console.log(`-- Generation ${gen} Reproducers --`)
            // console.log(generationSummaries[gen])

            AI.advanceGeneration()

            // clearInterval(killPlayersInterval)
            for (let i = 0; i < GAMES.length; i++) {
                GAMES[i].setMapI(3)
                // if (gen < (config.MaxGens * .33)) {
                //     GAMES[i].setMapI(0)
                // } else if (gen < (config.MaxGens * .66)) {
                //     GAMES[i].setMapI(1)
                // } else {
                //     GAMES[i].setMapI(2)
                // }
                GAMES[i].startNewGame()
            }
            // killPlayersInterval = window.setInterval(killPlayers, 15000)

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
// let killPlayersInterval = window.setInterval(killPlayers, 15000)