import { Game } from "./game.js";
import { AITrainer } from "/ai/aiTrainer.js"

export const m = "m"
var el = document.getElementById("sim_container");

var NUM_SIM = 6

var FRAMERATE = 20000,
    POP_SZ = 10, 
    MAX_GEN = 3, 
    MUT_R = .03, 
    SEL_R = .18,
    AI = new Array(),
    GAMES = new Array();


for (var i = 0; i < NUM_SIM; i++) {
    const ai = AITrainer(POP_SZ, MAX_GEN, MUT_R, SEL_R)
    var g = Game(FRAMERATE, true, ai, `net${i}.txt`)

    console.log(g)
    AI.push(ai)
    GAMES.push(g)
}

for (var i = 0; i < GAMES.length; i++) {
    GAMES[i].init(el)
}

// Generate a new breeding sample
function generateBreedingSample(populations, maxScore)
{
    console.log(populations)
    var pool = new Array()

    for(var i = 0; i < populations.length; i++)
    {
        for (var j = 0; j < populations[i].length; j++) {
            var normalizedfitness = (populations[i][j].getScore()/maxScore)
            var n = Math.floor(normalizedfitness * 100)
            for(var x = 0; x < n; x++)
            {
                pool.push(populations[i][j])
            }
        }
    }

    console.log(pool)

    var breedingSample = new Array()
    for (var i = 0; i < (POP_SZ * SEL_R * 4); i++) {
        breedingSample.push(pool[Math.floor(Math.random() * (pool.length - 1))])
    }

    return breedingSample
}


var checkSims = () => {
    if (AI.reduce((curr, val) => curr && (val.getGenerationAt() >= val.getMaxGeneration()), true)) {
        clearInterval(checkSimInterval)
    } else {
        if (AI.reduce((curr, val) => curr && val.isGenerationOver(), true)) {
            // temp reproduction algo
            var tops = new Array()
            for (var i = 0; i < AI.length; i++) {
                tops.push(AI[i].getTopNetwork().getScore())
            }
            var topScore = tops.reduce((curr, val) => val > curr ? val : curr, 0)

            console.log(topScore)

            var pops= new Array()
            for (var i = 0; i < AI.length; i++) {
                pops.push(AI[i].getPopulation())
            }

            var breedingSample = generateBreedingSample(pops, topScore)

            for (var i = 0; i < AI.length; i++) {
                AI[i].advanceGeneration(breedingSample)
            }

            for (var i = 0; i < GAMES.length; i++) {
                GAMES[i].startNewGame()
            }
        }
    }
}

var checkSimInterval = window.setInterval(checkSims, 60000)