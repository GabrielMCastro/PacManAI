import { NeuralNetwork } from "./neuralNetwork.js"

export const AITrainer = function (populationSize, maxGenerations, mutationR, selRate)
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
        population.push(NeuralNetwork(structure, 1, activation))
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


    function advanceGeneration(diversity) {
        console.log('moving on')
        topNetwork = getTopNetwork()
        generateNewPopulation(diversity)
        generations += 1
        currPop = 0
        maxScore = 0
        generationOver = false
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
    function generateNewPopulation(diversity)
    {
        var newpop = new Array()
        
        for(var i = 0; i < populationSize; i++)
        {
            var newNetwork = mate(diversity[Math.floor(Math.random() * (diversity.length - 1))], diversity[Math.floor(Math.random() * (diversity.length - 1))])
            newNetwork.mutateWeights(mutationRate)
            newpop.push(newNetwork)
        }

        population = newpop
    }

    function mate(net1, net2) {
        var newNet = NeuralNetwork(structure, 1, activation)
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