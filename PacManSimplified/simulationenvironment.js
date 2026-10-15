import { Game } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"
import { NetworkVisualizer } from "/ai/networkVisualizer.js"

export const m = "m"
let el = document.getElementById("sim_container")
let con_bar = document.getElementById("control_bar")

let FRAMERATE = 150,
    GAMES = new Array();
    // averageScores = new Array(),
    // generationSummaries = new Array();

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
    const g = Game(FRAMERATE, true, AI, i)
 
    GAMES.push(g)
}

for (let i = 0; i < GAMES.length; i++) {
    GAMES[i].init(el)
}

// GAMES[0].recordGeneration()

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

let checkSims = () => {
    if (AI.getCurrentGeneration() >= AI.getMaxGeneration()) {
        saveGeneration()
        clearInterval(checkSimInterval)
        // clearInterval(killPlayersInterval)
    } else {
        if (AI.isGenerationOver()) {
            let sorted = AI.getPopulation().sort((a,b) => b.getScore() - a.getScore())

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

            // Save top 50
            // if (AI.getCurrentGeneration() == (AI.getMaxGeneration() - 1)) {
            //     let gI = AI.getGlobalInfo()
            //     let gID = `${gI.innovations}.${gI.inputs}.${gI.hidden}.${gI.outputs}.`

            //     for (let i = 0; i < 50; i++) {
            //         var a = document.createElement("a");
            //         var content = JSON.stringify([gID, sorted[i].getGenome()])
            //         var file = new Blob([content], {type: "text/plain"});
            //         a.href = URL.createObjectURL(file);
            //         a.download = `topnet_${i}_${sorted[i].getScore()}.txt`;
            //         a.click();
            //     }
            // }
            
            // TESTING
            // console.log(`-- Generation ${gen} Reproducers --`)
            // console.log(generationSummaries[gen])

            AI.advanceGeneration()
            let pop = AI.getPopulation()

            document.getElementById("visbody").innerHTML = ""
            for (let i = 0; i < AI.getPopulation().length; i++) {
                let visualizer = NetworkVisualizer(pop[i].getGenome(), AI.getGlobalInfo())

                visualizer.init()
                visualizer.visualize(337, 267)
            }

            // clearInterval(killPlayersInterval)
            for (let i = 0; i < GAMES.length; i++) {
                // GAMES[i].setMapI(3)
                // if ((gen % 3) == 0) {
                //     GAMES[i].setMapI(2)
                // } else if ((gen % 2) == 0) {
                //     GAMES[i].setMapI(1)
                // } else {
                //     GAMES[i].setMapI(0)
                // }
                // if (gen > 19 && gen < 40) {
                //     GAMES[i].setMapI(1)
                // } else {
                //     GAMES[i].setMapI(0)
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

let checkSimInterval = window.setInterval(checkSims, 15000)
// let killPlayersInterval = window.setInterval(killPlayers, 15000)