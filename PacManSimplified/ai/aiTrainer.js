import { NeuralNetwork } from "./neuralNetwork.js"

export const AITrainer = function (populationSize, maxGenerations, mutationR, id)
{
    var generations = 0        // Number of generations the algorithm has been running
    var currPop  = 0             // The current network being tested
    var maxScore = 0           // The max score of the current network
    var topNetwork             // The weights for the top network
    var generationOver = false
    var population = new Array()   // The population of Neural Networks
    var structure = [418, 150, 100, 50, 25, 12, 4]
    var activation = (x) => (1/(1 + Math.exp(-x)))
    
    // Gen networks
    for(var i = 0; i < populationSize; i++)
    {
        population.push(NeuralNetwork(structure, 1, activation, `${id}_${generations}_${i}`))
        population[i].generateWeights()
    }

    function moveToNext()
    {
        if(currPop < (populationSize - 1))
        {
            currPop += 1
        } else {
            generationOver = true
        }
    }


    function advanceGeneration(diversity, mateP) {
        // console.log('moving on')
        topNetwork = getTopNetwork()
        generations += 1
        currPop = 0
        maxScore = 0
        generationOver = false
        generateNewPopulation(diversity, mateP)
    }

    function getPopulationAt()
    {
        return currPop
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
        population[currPop].execute(input)
    }

    // Retrieves the decision made by the network
    function getDecision()
    {
        return population[currPop].getDecision()
    }

    function setScore(score)
    {
        (score > maxScore) ? maxScore = score : null
        population[currPop].setScore(score)
    }

    // Generate a new population from the breeding sample
    function generateNewPopulation(diversity, mateP)
    {
        var newpop = new Array()

        for (var i = 0; i < (populationSize * (1 - mateP)); i++) {
            var newNet = NeuralNetwork(structure, 1, activation, `${id}_${generations}_${i}`)
            newNet.setWeights(diversity[i % diversity.length].getWeights())
            newNet.mutateWeights(mutationR)
            newpop.push(newNet)
        }

        var nonMated = newpop.length
        
        for(var i = 0; i < (populationSize * mateP); i++)
        {
            var rand1 = Math.floor(Math.random() * (diversity.length - 1))
            var rand2 = Math.floor(Math.random() * (diversity.length - 1))
            var newNet = mate(diversity[rand1], diversity[rand2], nonMated + i)
            newNet.mutateWeights(mutationR)
            newpop.push(newNet)
        }

        population = newpop
    }

    // Half-half weights
    function mate(net1, net2, x) {
        var newNet = NeuralNetwork(structure, 1, activation, `${id}_${generations}_${x}*`)
        newNet.setWeights(net1.getWeights())

        for (var i = 0; i < newNet.getWeights().length; i++) {
            for (var j = 0; j < newNet.getWeights()[i].length; j++) {
                if (j >= (newNet.getWeights()[i].length / 2)) {
                    newNet.getWeights()[i][j] = net2.getWeights()[i][j]
                }
            }
        }

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
        var content = JSON.stringify(topNetwork.getWeights())
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
        "getDecision" : getDecision,
        "setScore" : setScore,
        "generateNewPopulation" : generateNewPopulation,
        "mate" : mate,
        "getTopScore" : getTopScore,
        "getPopulationSize" : getPopulationSize,
        "getTopNetwork" : getTopNetwork,
        "saveTopNetwork" : saveTopNetwork
    }
}