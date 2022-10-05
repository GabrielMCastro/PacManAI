import { NeuralNetwork } from "./neuralNetwork.js"

export const AITrainer = function (populationSize, maxGenerations, mutationR, id, seed, seedNum)
{
    var generations = 0        // Number of generations the algorithm has been running
    var currentNet  = 0             // The current network being tested
    var maxScore = 0           // The max score of the current network
    var topNetwork             // The weights for the top network
    var generationOver = false
    var population = new Array()   // The population of Neural Networks
    // var structure = [81, 150, 100, 50, 25, 12, 4]
    var hexRef = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f']
    var canvas
    // Activation Functions
    var sigmoid = (x) => (1/(1 + Math.exp(-x)))
    var tanh = (x) => ((Math.exp(x) - Math.exp(-x))/(Math.exp(x) + Math.exp(-x)))
    var softmax = (vect) => {
        var sumExp = vect.reduce((curr, val) => Math.exp(val) + curr, 0)
        var x = vect.map((x) => (Math.exp(x) / sumExp))

        return x
    }

    init()
    
    function init() {
        var seedGenes = []
        if (seed) {
            for (var i = 0; i < seedNum; i++) {
                var rawFile = new XMLHttpRequest()
                rawFile.open("GET", `http://localhost:8000/ai/seeds/net${i}.txt`, false)
                rawFile.onreadystatechange = () => {
                    if(rawFile.status === 200 || rawFile.status == 0)
                    {
                        var allText = rawFile.responseText;
                        var genome = allText.replace("[", "").replace("]", "")
                                            .replace(/\"/g, "").split(",")
                        seedGenes.push(genome)
                    }
                }
                rawFile.send(null)
            }
        }

        // console.log(seedGenes)

        // Gen networks
        for(var i = 0; i < populationSize; i++)
        {
            population.push(NeuralNetwork(seed ? seedGenes[i % seedNum] : generateGenome(200), 1, tanh, softmax, `${id}_${generations}_${i}`))
        }
        // population[currentNet].setCanvas(canvas)
    }

    function moveToNext()
    {
        if(currentNet < (populationSize - 1))
        {
            currentNet += 1
            // population[currentNet].setCanvas(canvas)
        } else {
            generationOver = true
        }
    }

    function generateGenome(geneNum) {
        var genes = []
        for (var i = 0; i < geneNum; i++) {
            var gene = ""
            for (var j = 0; j < 7; j++) {
                gene += hexRef[Math.floor(Math.random() * 16)]
            }
            genes.push(gene)
        }
        return genes
    }

    function setCanvas(ctx) {
        canvas = ctx
    }


    function advanceGeneration(diversity, mateP) {
        // console.log('moving on')
        topNetwork = getTopNetwork()
        generations += 1
        currentNet = 0
        maxScore = 0
        generationOver = false
        generateNewPopulation(diversity, mateP)
    }

    function getPopulationAt()
    {
        return currentNet
    }

    function getGenerationAt()
    {
        return generations
    }

    function getMaxGeneration()
    {
        return maxGenerations
    }

    function isGenerationOver() {
        return generationOver
    }

    // Executes the network currently being tested with the given input data
    function execute(input)
    {
       return population[currentNet].execute(input)
    }

    function setScore(score)
    {
        (score > maxScore) ? maxScore = score : null
        population[currentNet].setScore(score)
    }

    // Generate a new population from the breeding sample
    function generateNewPopulation(diversity, mateP)
    {
        var newpop = new Array()
        var newPopScores = new Array()

        for (var i = 0; i < (populationSize * (1 - mateP)); i++) {
            newPopScores.push(diversity[i % diversity.length].getScore())
            var newNet = NeuralNetwork(diversity[i % diversity.length].getGenome(), 1, tanh, softmax, `${id}_${generations}_${i}`)
            newNet.mutateGenome(mutationR)
            newpop.push(newNet)
        }

        var nonMated = newpop.length
        
        for(var i = 0; i < (populationSize * mateP); i++)
        {
            var rand1 = Math.floor(Math.random() * (diversity.length - 1))
            var rand2 = Math.floor(Math.random() * (diversity.length - 1))
            newPopScores.push([diversity[rand1].getScore(), diversity[rand2].getScore()])
            var newNet = crossover(diversity[rand1], diversity[rand2], nonMated + i)
            newNet.mutateGenome(mutationR)
            newpop.push(newNet)
        }

        // console.log(newPopScores)

        population = newpop
    }

    // Crossover Genome at midway point
    function crossover(net1, net2, x) {
        var g1 = net1.getGenome()
        var newGenome = [...g1.slice(0, (g1.length / 2)), ...net2.getGenome().slice(g1.length / 2)]
        var newNet = NeuralNetwork(newGenome, 1, tanh, softmax, `${id}_${generations}_${x}*`)

        // console.log(newNet.getGenome())

        return newNet
    }

    function getTopScore()
    {
        return maxScore
    }

    function getPopulationSize()
    {
        return populationSize
    }

    function getPopulation() {
        return population
    }

    function getCurrentNetId() {
        return population[currentNet].getId()
    }

    function getTopNetwork()
    {
        var maxScore = 0
        var topNetwork = 0
        for(var i = 0; i < population.length; i++)
        {
            if(population[i].getScore() > maxScore)
            {
                maxScore = population[i].getScore()
                topNetwork = i
            }
        }

        maxScore = maxScore
        return population[topNetwork]
    }

    function saveTopNetwork(fileName, contentType) {
        var a = document.createElement("a");
        var content = JSON.stringify(topNetwork.getGenome())
        var file = new Blob([content], {type: contentType});
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
    }

    return {
        "moveToNext" : moveToNext,
        "advanceGeneration" : advanceGeneration,
        "getPopulationAt" : getPopulationAt,
        "getPopulation" : getPopulation,
        "getGenerationAt" : getGenerationAt,
        "getMaxGeneration" : getMaxGeneration,
        "isGenerationOver" : isGenerationOver,
        "execute" : execute,
        "setScore" : setScore,
        "generateNewPopulation" : generateNewPopulation,
        "crossover" : crossover,
        "getTopScore" : getTopScore,
        "getPopulationSize" : getPopulationSize,
        "getTopNetwork" : getTopNetwork,
        "saveTopNetwork" : saveTopNetwork,
        "setCanvas" : setCanvas,
        "getCurrentNetId" : getCurrentNetId
    }
}