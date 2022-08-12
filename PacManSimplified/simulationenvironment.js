import { Game } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"

export const m = "m"
var el = document.getElementById("sim_container")
var con_bar = document.getElementById("control_bar")

var NUM_SIM = 3

var FRAMERATE = 20000,
    POP_SZ = 10, 
    MAX_GEN = 3, 
    MUT_R = .01,  // Mutation rate
    MATE_PERC = .2, // Percentage of each generation that is the result of mating
    SEL_PERC = .1, // Percentile of generation that successfully reproduces
    AI = new Array(),
    GAMES = new Array();

var averageScores = new Array()

for (var i = 0; i < NUM_SIM; i++) {
    const ai = AITrainer(POP_SZ, MAX_GEN, MUT_R, `ai${i}`)
    var g = Game(FRAMERATE, true, ai, `net${i}.txt`)

    AI.push(ai)
    GAMES.push(g)
}

for (var i = 0; i < GAMES.length; i++) {
    GAMES[i].init(el)
}

// Merge sort networks
function sort(networks) {
    if (networks.length == 1) return networks
    var left = sort(networks.slice(0, networks.length / 2))
    var right = sort(networks.slice(networks.length / 2))

    var x1 = 0
    var x2 = 0
    var result = new Array()

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

var checkSims = () => {
    if (AI.reduce((curr, val) => curr && (val.getGenerationAt() >= val.getMaxGeneration()), true)) {
        console.log(averageScores)
        clearInterval(checkSimInterval)
    } else {
        if (AI.reduce((curr, val) => curr && val.isGenerationOver(), true)) {
            var pops = new Array()
            for (var i = 0; i < AI.length; i++) {
                pops.push(...AI[i].getPopulation())
            }

            var sorted = sort(pops)

            // Get avg score for gen
            var sum = sorted.reduce((curr, val) => curr + val.getScore(), 0)
            var avg = sum / sorted.length
            averageScores.push(avg)
            
            var pav = document.createElement('p')
            pav.innerHTML = `* Generation ${AI[0].getGenerationAt()} Avg: ${avg}`
            con_bar.appendChild(pav)

            var breedingSample = sorted.slice(0, sorted.length * SEL_PERC)


            var samp = document.createElement('p')
            samp.innerHTML = `-- Generation ${AI[0].getGenerationAt()} Reproducers --`
            con_bar.appendChild(samp)
            
            for (var i = 0; i < breedingSample.length; i++) {
                var samp = document.createElement('p')
                samp.innerHTML = `${breedingSample[i].getId()} : ${breedingSample[i].getScore()}`
                con_bar.appendChild(samp)
            }

            for (var i = 0; i < AI.length; i++) {
                AI[i].advanceGeneration(breedingSample, MATE_PERC)
            }

            for (var i = 0; i < GAMES.length; i++) {
                GAMES[i].startNewGame()
            }

            // Record one generation
            if (AI[0].getGenerationAt() == (AI[0].getMaxGeneration() - 1)) {
                GAMES[0].recordGeneration()
            }
        }
    }
}

var checkSimInterval = window.setInterval(checkSims, 60000)