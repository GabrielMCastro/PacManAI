import { Game } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"

export const m = "m"
var el = document.getElementById("sim_container")
var con_bar = document.getElementById("control_bar")

var NUM_SIM = 10

var FRAMERATE = 300,
    POP_SZ = 30, 
    MAX_GEN = 100, 
    MUT_R = .10,  // Mutation rate
    MATE_PERC = .5, // Percentage of each generation that is the result of mating
    SEL_PERC = .2, // Percentile of a generation that successfully reproduces
    AI = new Array(),
    GAMES = new Array();

var averageScores = new Array()

var recentBreeders

for (var i = 0; i < NUM_SIM; i++) {
    const ai = AITrainer(POP_SZ, MAX_GEN, MUT_R, `ai${i}`, true, 10)
    const g = Game(FRAMERATE, true, ai, `net${i}.txt`, i)

    AI.push(ai)
    GAMES.push(g)
}

for (var i = 0; i < GAMES.length; i++) {
    GAMES[i].init(el)
}

// Merge sort networks
function sort(networks) {
    if (networks.length == 1) return networks
    let left = sort(networks.slice(0, networks.length / 2))
    let right = sort(networks.slice(networks.length / 2))

    let x1 = 0
    let x2 = 0
    let result = new Array()

    while ((x1 < left.length) && (x2 < right.length)) {
        if (left[x1].getScore() > right[x2].getScore()) {
            result.push(left[x1])
            x1++
        } else {
            result.push(right[x2])
            x2++
        }
    }

    if (x1 < left.length) {
        result.push(...left.slice(x1))
    }

    if (x2 < right.length) {
        result.push(...right.slice(x2))
    }

    return result
}

function saveBreeders() {
    for (var i = 0; i < recentBreeders.length; i++) {
        var a = document.createElement("a");
        var content = JSON.stringify(recentBreeders[i].genes)
        var file = new Blob([content], {type: 'text/plain'});
        a.href = URL.createObjectURL(file);
        a.download = `ai${i}.txt`;
        a.click();
    }
}

var checkSims = () => {
    if (AI.reduce((curr, val) => curr && (val.getGenerationAt() >= val.getMaxGeneration()), true)) {
        console.log(averageScores)
        // saveBreeders()
        clearInterval(checkSimInterval)
        clearInterval(killPlayersInterval)
    } else {
        if (AI.reduce((curr, val) => curr && val.isGenerationOver(), true)) {
            let pops = new Array()
            for (var i = 0; i < AI.length; i++) {
                pops.push(...AI[i].getPopulation())
            }

            let sorted = sort(pops)
            let breedingSample = sorted.slice(0, sorted.length * SEL_PERC)
            // recentBreeders = [...breedingSample]

            // Get avg score for gen
            let sum = sorted.reduce((curr, val) => curr + val.getScore(), 0)
            let avg = sum / sorted.length
            averageScores.push(avg)
            
            // Post average score of gen to sidebar
            var pav = document.createElement('p')
            pav.innerHTML = `* Generation ${AI[0].getGenerationAt()} Avg: ${avg}`
            pav.onclick = (e) => {
                console.log(`-- Generation ${AI[0].getGenerationAt()} Reproducers --`)
                console.log(breedingSample.map(nn => {
                    return {
                        id: nn.getId(),
                        score: nn.getScore(),
                        paths: nn.getUpstreamPaths(),
                        vis: nn.getVisualization(),
                        genes: nn.getGenome(),
                    }
                }))
            }
            con_bar.appendChild(pav)

            // var samp = document.createElement('p')
            // samp.innerHTML = `-- Generation ${AI[0].getGenerationAt()} Reproducers --`
            // samp.onclick = (e) => {
            //     console.log(breedingSample.map(nn => {
            //         return {
            //             id: nn.getId(),
            //             score: nn.getScore(),
            //             paths: nn.getUpstreamPaths(),
            //             vis: nn.getVisualization(),
            //             genes: nn.getGenome(),
            //         }
            //     }))
            // }
            // con_bar.appendChild(samp)
            
            // for (var i = 0; i < breedingSample.length; i++) {
            //     let x = document.createElement('p')
            //     x.innerHTML = `${breedingSample[i].getId()} : ${breedingSample[i].getScore()}`
            //     con_bar.appendChild(x)
            // }

            for (let i = 0; i < AI.length; i++) {
                AI[i].advanceGeneration(breedingSample, MATE_PERC)
            }

            let gen = AI[0].getGenerationAt()
            for (let i = 0; i < GAMES.length; i++) {
                if (gen < (MAX_GEN * .33)) {
                    GAMES[i].setMapI(0)
                } else if (gen < (MAX_GEN * .66)) {
                    GAMES[i].setMapI(1)
                } else {
                    GAMES[i].setMapI(2)
                }
                GAMES[i].startNewGame()
            }

            // Record one generation
            if (AI[0].getGenerationAt() == (AI[0].getMaxGeneration() - 1)) {
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

var checkSimInterval = window.setInterval(checkSims, 60000)
var killPlayersInterval = window.setInterval(killPlayers, 15000)